/** Ligação à WhatsApp Cloud API (Meta). */
import { registar, type Env, type MensagemRecebida } from "./tipos";

const LIMITE_TEXTO = 4000; // a Meta aceita até 4096 caracteres por mensagem

/** Confirma que o pedido veio da Meta (cabeçalho X-Hub-Signature-256). */
export async function assinaturaValida(segredo: string, corpo: ArrayBuffer, cabecalho: string | null): Promise<boolean> {
  if (!segredo || !cabecalho?.startsWith("sha256=")) return false;
  const hex = cabecalho.slice(7);
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const assinatura = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", chave, assinatura, corpo); // comparação em tempo constante
}

/** Converte o webhook da Meta numa lista simples de mensagens. Estados (entregue, lida) são ignorados. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extrairMensagens(payload: any): MensagemRecebida[] {
  const resultado: MensagemRecebida[] = [];
  for (const entrada of payload?.entry ?? []) {
    for (const alteracao of entrada?.changes ?? []) {
      const valor = alteracao?.value ?? {};
      const nomes = new Map<string, string>();
      for (const c of valor.contacts ?? []) if (c?.wa_id) nomes.set(c.wa_id, c.profile?.name);
      for (const m of valor.messages ?? []) {
        const msg: MensagemRecebida = {
          waId: m.id,
          telefone: m.from,
          nome: nomes.get(m.from) ?? null,
          tipo: "outro",
          texto: null,
          mediaId: null,
          mime: null,
        };
        if (m.type === "text") {
          Object.assign(msg, { tipo: "texto", texto: m.text?.body ?? "" });
        } else if (m.type === "image") {
          Object.assign(msg, { tipo: "imagem", texto: m.image?.caption ?? null, mediaId: m.image?.id, mime: m.image?.mime_type ?? null });
        } else if (m.type === "document" && m.document?.mime_type === "application/pdf") {
          Object.assign(msg, {
            tipo: "pdf",
            texto: m.document.caption ?? m.document.filename ?? null,
            mediaId: m.document.id,
            mime: "application/pdf",
          });
        } else if (m.type === "interactive") {
          const r = m.interactive?.button_reply ?? m.interactive?.list_reply ?? {};
          Object.assign(msg, { tipo: "texto", texto: r.title ?? null });
        } else if (m.type === "button") {
          Object.assign(msg, { tipo: "texto", texto: m.button?.text ?? null });
        } else {
          msg.texto = `[o cliente enviou uma mensagem do tipo '${m.type}', que não é suportada]`;
        }
        resultado.push(msg);
      }
    }
  }
  return resultado;
}

export class WhatsApp {
  constructor(private env: Env) {}

  private get base(): string {
    return `https://graph.facebook.com/${this.env.WA_GRAPH_VERSION}`;
  }

  private get cabecalhos(): Record<string, string> {
    return { Authorization: `Bearer ${this.env.WA_ACCESS_TOKEN}` };
  }

  async enviarTexto(para: string, texto: string): Promise<void> {
    // No simulador as respostas são devolvidas por HTTP; o staging com a Meta liga o envio à parte
    if (this.env.MODO_DEV === "true" && this.env.ENVIAR_WHATSAPP_EM_DEV !== "true") return;
    for (let i = 0; i < texto.length; i += LIMITE_TEXTO) {
      const r = await fetch(`${this.base}/${this.env.WA_PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: { ...this.cabecalhos, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: para,
          type: "text",
          text: { body: texto.slice(i, i + LIMITE_TEXTO), preview_url: false },
        }),
      });
      if (!r.ok) {
        const detalhe = await r.text();
        registar("erro_envio_whatsapp", { estado: r.status, detalhe });
        throw new Error(`WhatsApp ${r.status}: ${detalhe}`);
      }
    }
  }

  /** Obtém o URL temporário do ficheiro e descarrega-o logo (o URL expira em minutos). */
  async descarregarMedia(mediaId: string): Promise<{ dados: ArrayBuffer; mime: string }> {
    const r = await fetch(`${this.base}/${mediaId}`, { headers: this.cabecalhos });
    if (!r.ok) throw new Error(`Media ${mediaId}: ${r.status}`);
    const info = await r.json<{ url: string; mime_type?: string }>();
    const f = await fetch(info.url, { headers: this.cabecalhos });
    if (!f.ok) throw new Error(`Download ${mediaId}: ${f.status}`);
    return { dados: await f.arrayBuffer(), mime: info.mime_type ?? f.headers.get("content-type") ?? "application/octet-stream" };
  }
}
