// Conversa com o bot no terminal, sem WhatsApp. Precisa de `npm run dev` a correr noutro terminal.
//
// Uso: npm run simular [-- telefone]
// Contra o staging: BOT_URL=https://... DEV_TOKEN=... npm run simular
// Comandos:
//   /foto caminho.jpg [legenda]   envia uma foto (ou um PDF)
//   + texto                       acumula a mensagem sem responder (várias mensagens seguidas)
//   /ficha                        mostra o estado da ficha
//   /reset                        apaga esta conversa e recomeça
//   /sair
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";

const BASE = process.env.BOT_URL ?? "http://localhost:8787";
const telefone = process.argv[2] ?? "351900000000";
const DEV_TOKEN = process.env.DEV_TOKEN ?? "";
const rl = createInterface({ input: process.stdin, output: process.stdout });

async function pedir(caminho, corpo) {
  const cabecalhos = { "content-type": "application/json", ...(DEV_TOKEN && { "X-Dev-Token": DEV_TOKEN }) };
  const r = await fetch(`${BASE}${caminho}`, corpo
    ? { method: "POST", headers: cabecalhos, body: JSON.stringify(corpo) }
    : { headers: cabecalhos });
  const dados = await r.json();
  if (!r.ok) throw new Error(dados.erro ?? JSON.stringify(dados));
  return dados;
}

console.log(`Simulador ligado a ${BASE}, cliente ${telefone}. Escreva /sair para terminar.\n`);
while (true) {
  let linha;
  try {
    linha = (await rl.question("\x1b[33mCLIENTE:\x1b[0m ")).trim();
  } catch {
    break;
  }
  if (!linha) continue;
  if (linha === "/sair") break;
  try {
    if (linha === "/ficha") {
      console.log(JSON.stringify(await pedir(`/dev/ficha?telefone=${telefone}`), null, 2));
      continue;
    }
    if (linha === "/reset") {
      await pedir("/dev/reset", { telefone });
      console.log("(conversa apagada)");
      continue;
    }
    const acumular = linha.startsWith("+ ");
    if (acumular) linha = linha.slice(2);
    const corpo = { telefone, acumular, texto: linha };
    if (linha.startsWith("/foto ")) {
      const [, caminho, ...legenda] = linha.split(" ");
      corpo.ficheiroBase64 = (await readFile(caminho)).toString("base64");
      corpo.nomeFicheiro = basename(caminho);
      corpo.texto = legenda.join(" ") || null;
    }
    const { respostas } = await pedir("/dev/mensagem", corpo);
    for (const t of respostas) console.log(`\n\x1b[36mBOT:\x1b[0m ${t}\n`);
  } catch (erro) {
    console.error(`\x1b[31mERRO:\x1b[0m ${erro.message}`);
  }
}
rl.close();
