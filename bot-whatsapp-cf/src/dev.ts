/** Proteção das rotas /dev/* e página do simulador web. Só usados com MODO_DEV=true. */
import type { Env } from "./tipos";

const TAMANHO_MINIMO_TOKEN = 16;

async function resumo(texto: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
}

/**
 * Com DEV_TOKEN definido, exige o cabeçalho X-Dev-Token igual (comparação em tempo constante).
 * Sem DEV_TOKEN, só aceita pedidos para localhost: um Worker publicado nunca fica aberto por esquecimento.
 */
export async function acessoDevPermitido(request: Request, env: Env, url: URL): Promise<boolean> {
  const esperado = env.DEV_TOKEN ?? "";
  if (!esperado) return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (esperado.length < TAMANHO_MINIMO_TOKEN) return false; // token fraco: tratar como mal configurado
  const recebido = request.headers.get("X-Dev-Token") ?? "";
  return crypto.subtle.timingSafeEqual(await resumo(recebido), await resumo(esperado));
}

/** Página estática: não contém dados. Todas as ações passam por /dev/* com o token. */
export const PAGINA_DEV = `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Simulador do bot</title>
<style>
  :root { color-scheme: light dark; --borda: #8884; --cliente: #dcf8c6; --bot: #eee; --texto-bolha: #111; }
  @media (prefers-color-scheme: dark) { :root { --cliente: #1f4d2b; --bot: #2a2a2a; --texto-bolha: #eee; } }
  *, *::before, *::after { box-sizing: border-box; }
  body { font: 15px/1.4 system-ui, sans-serif; margin: 0 auto; max-width: 720px; padding: 16px; }
  fieldset { border: 1px solid var(--borda); border-radius: 8px; margin: 0 0 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  input[type=text], input[type=password] { flex: 1 1 160px; padding: 6px; }
  #conversa { border: 1px solid var(--borda); border-radius: 8px; padding: 8px; min-height: 240px; display: flex; flex-direction: column; gap: 6px; }
  .bolha { padding: 6px 10px; border-radius: 8px; max-width: 85%; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--texto-bolha); }
  .cliente { align-self: flex-end; background: var(--cliente); }
  .bot { align-self: flex-start; background: var(--bot); }
  .erro { align-self: center; color: #c00; max-width: 100%; }
  form { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  #texto { flex: 1 1 100%; min-height: 60px; padding: 6px; }
  pre { overflow-x: auto; border: 1px solid var(--borda); border-radius: 8px; padding: 8px; font-size: 13px; }
</style>
</head>
<body>
<h1>Simulador do bot</h1>
<fieldset>
  <input id="token" type="password" placeholder="DEV_TOKEN" autocomplete="off" aria-label="DEV_TOKEN">
  <input id="telefone" type="text" value="351900000000" aria-label="Telefone de teste">
  <button type="button" id="verFicha">Ver ficha</button>
  <button type="button" id="reset">Recomeçar</button>
</fieldset>
<div id="conversa" aria-live="polite"></div>
<form id="envio">
  <textarea id="texto" placeholder="Mensagem do cliente (ou legenda da foto)"></textarea>
  <input id="ficheiro" type="file" accept="image/jpeg,image/png,image/webp,application/pdf">
  <label><input id="acumular" type="checkbox"> acumular sem responder</label>
  <button type="submit">Enviar</button>
</form>
<pre id="ficha" hidden></pre>
<script>
const $ = (id) => document.getElementById(id);
try { $("token").value = sessionStorage.getItem("devToken") || ""; } catch {}
$("token").addEventListener("change", () => { try { sessionStorage.setItem("devToken", $("token").value); } catch {} });

function bolha(classe, texto) {
  const div = document.createElement("div");
  div.className = "bolha " + classe;
  div.textContent = texto;
  $("conversa").append(div);
  div.scrollIntoView({ block: "end" });
}

async function pedir(caminho, corpo) {
  const r = await fetch(caminho, {
    method: corpo ? "POST" : "GET",
    headers: { "content-type": "application/json", "X-Dev-Token": $("token").value },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({ erro: "resposta inválida (" + r.status + ")" }));
  if (!r.ok) throw new Error(dados.erro || r.status);
  return dados;
}

function base64(ficheiro) {
  return new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result).split(",")[1]);
    leitor.onerror = falha;
    leitor.readAsDataURL(ficheiro);
  });
}

$("envio").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const botao = ev.submitter; botao.disabled = true;
  const texto = $("texto").value.trim();
  const ficheiro = $("ficheiro").files[0];
  if (!texto && !ficheiro) { botao.disabled = false; return; }
  const corpo = { telefone: $("telefone").value, acumular: $("acumular").checked, texto: texto || null };
  try {
    if (ficheiro) { corpo.ficheiroBase64 = await base64(ficheiro); corpo.nomeFicheiro = ficheiro.name; }
    bolha("cliente", (ficheiro ? "[" + ficheiro.name + "] " : "") + texto);
    $("texto").value = ""; $("ficheiro").value = "";
    const { respostas } = await pedir("/dev/mensagem", corpo);
    for (const t of respostas) bolha("bot", t);
  } catch (e) { bolha("erro", "Erro: " + e.message); }
  botao.disabled = false;
});

$("verFicha").addEventListener("click", async () => {
  try {
    $("ficha").textContent = JSON.stringify(await pedir("/dev/ficha?telefone=" + encodeURIComponent($("telefone").value)), null, 2);
    $("ficha").hidden = false;
  } catch (e) { bolha("erro", "Erro: " + e.message); }
});

$("reset").addEventListener("click", async () => {
  try { await pedir("/dev/reset", { telefone: $("telefone").value }); $("conversa").replaceChildren(); $("ficha").hidden = true; bolha("erro", "(conversa apagada)"); }
  catch (e) { bolha("erro", "Erro: " + e.message); }
});
</script>
</body>
</html>`;
