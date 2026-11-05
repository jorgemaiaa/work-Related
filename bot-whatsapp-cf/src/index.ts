/** Worker: recebe o webhook da Meta e entrega cada mensagem ao Durable Object do cliente. */
import { conversaDe, registar, type Env, type MensagemRecebida } from "./tipos";
import { assinaturaValida, extrairMensagens } from "./whatsapp";

export { Conversa } from "./conversa";
export { ZohoAuth } from "./zoho-auth";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // A Meta chama este endpoint uma vez, ao configurar o webhook
    if (url.pathname === "/webhook" && request.method === "GET") {
      const p = url.searchParams;
      if (p.get("hub.mode") === "subscribe" && env.WA_VERIFY_TOKEN && p.get("hub.verify_token") === env.WA_VERIFY_TOKEN) {
        return new Response(p.get("hub.challenge") ?? "");
      }
      return new Response("Proibido", { status: 403 });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      const corpo = await request.arrayBuffer();
      if (!(await assinaturaValida(env.WA_APP_SECRET, corpo, request.headers.get("X-Hub-Signature-256")))) {
        registar("assinatura_invalida");
        return new Response("Proibido", { status: 403 });
      }
      const payload = JSON.parse(new TextDecoder().decode(corpo));
      for (const msg of extrairMensagens(payload)) {
        await conversaDe(env, msg.telefone).receber(msg); // rápido: só guarda e agenda
      }
      return Response.json({ ok: true }); // responder logo; o processamento corre no alarm
    }

    if (url.pathname === "/saude") return Response.json({ ok: true });

    if (url.pathname.startsWith("/dev/") && env.MODO_DEV === "true") return rotasDev(request, env, url);

    return new Response("Não encontrado", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/** Rotas usadas pelo simulador (scripts/simulador.mjs). Só existem com MODO_DEV=true. */
async function rotasDev(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    if (url.pathname === "/dev/mensagem" && request.method === "POST") {
      const corpo = await request.json<{
        telefone: string;
        texto?: string;
        ficheiroBase64?: string;
        nomeFicheiro?: string;
        acumular?: boolean;
      }>();
      const id = crypto.randomUUID();
      const msg: MensagemRecebida = {
        waId: `dev-${id}`,
        telefone: corpo.telefone,
        nome: "Cliente Teste",
        tipo: "texto",
        texto: corpo.texto ?? null,
        mediaId: null,
        mime: null,
      };
      if (corpo.ficheiroBase64) {
        const pdf = (corpo.nomeFicheiro ?? "").toLowerCase().endsWith(".pdf");
        const extensao = (corpo.nomeFicheiro ?? "").toLowerCase().split(".").pop();
        const mime = pdf ? "application/pdf" : extensao === "png" ? "image/png" : extensao === "webp" ? "image/webp" : "image/jpeg";
        const bytes = Uint8Array.from(atob(corpo.ficheiroBase64), (c) => c.charCodeAt(0));
        const chave = `${corpo.telefone}/dev-${id}.${pdf ? "pdf" : extensao}`;
        await env.ANEXOS.put(chave, bytes, { httpMetadata: { contentType: mime } });
        Object.assign(msg, { tipo: pdf ? "pdf" : "imagem", mime, mediaChave: chave });
      }
      const conversa = conversaDe(env, corpo.telefone);
      await conversa.receber(msg, false);
      const respostas = corpo.acumular ? [] : await conversa.processarAgora();
      return Response.json({ respostas });
    }
    if (url.pathname === "/dev/ficha") {
      return Response.json(await conversaDe(env, url.searchParams.get("telefone") ?? "").verFicha());
    }
    if (url.pathname === "/dev/reset" && request.method === "POST") {
      const { telefone } = await request.json<{ telefone: string }>();
      await conversaDe(env, telefone).apagar();
      return Response.json({ ok: true });
    }
    return new Response("Não encontrado", { status: 404 });
  } catch (erro) {
    return Response.json({ erro: String(erro) }, { status: 500 });
  }
}
