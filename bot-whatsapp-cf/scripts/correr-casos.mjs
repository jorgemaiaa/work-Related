// Bateria de conversas de regressão: envia as mensagens de cada caso (casos/*.json) ao bot e
// compara o estado final da ficha com as expectativas. Fala com o Claude real: cada corrida custa.
//
// Uso (com `npm run dev` a correr noutro terminal):
//   npm run casos                         todos os casos
//   npm run casos -- referencia pedido    só os casos cujo nome contém estas palavras
//   npm run casos -- --repeticoes 3       corre cada caso 3 vezes (o modelo varia entre corridas)
// Contra o staging: BOT_URL=https://... DEV_TOKEN=... npm run casos
//
// Formato de um caso: ver casos/LEIA-ME.md.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { devToken } from "./dev-token.mjs";

const BASE = process.env.BOT_URL ?? "http://localhost:8787";
const DEV_TOKEN = devToken(); // do ambiente ou do .dev.vars
const PASTA = process.env.CASOS_PASTA ?? "casos";

const args = process.argv.slice(2);
let repeticoes = 1;
const filtros = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--repeticoes") repeticoes = Math.max(1, Number(args[++i]) || 1);
  else filtros.push(args[i]);
}

const cor = (n, t) => (process.stdout.isTTY ? `\x1b[${n}m${t}\x1b[0m` : t);
const verde = (t) => cor(32, t);
const vermelho = (t) => cor(31, t);
const amarelo = (t) => cor(33, t);

async function pedir(caminho, corpo) {
  const cabecalhos = { "content-type": "application/json", ...(DEV_TOKEN && { "X-Dev-Token": DEV_TOKEN }) };
  const r = await fetch(`${BASE}${caminho}`, corpo
    ? { method: "POST", headers: cabecalhos, body: JSON.stringify(corpo) }
    : { headers: cabecalhos });
  const dados = await r.json().catch(() => ({ erro: `resposta inválida (${r.status})` }));
  if (!r.ok) throw new Error(dados.erro ?? JSON.stringify(dados));
  return dados;
}

/** Telefone fixo por caso, para não misturar conversas. */
function telefoneDe(nome) {
  let h = 0;
  for (const c of nome) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `3519${String(h % 1e8).padStart(8, "0")}`;
}

const igual = (a, b) => (typeof b === "string" && typeof a === "string" ? a.toLowerCase() === b.toLowerCase() : a === b);
const mostrar = (v) => (v === undefined ? "(vazio)" : JSON.stringify(v));

/** Devolve a lista de falhas (vazia se tudo bate certo). */
function comparar(esperado, final) {
  const falhas = [];
  if (esperado.estado !== undefined) {
    const aceites = [].concat(esperado.estado);
    if (!aceites.includes(final.estado)) falhas.push(`estado: esperado ${aceites.join(" ou ")}, obtido ${final.estado}`);
  }
  for (const [campo, valor] of Object.entries(esperado.ficha ?? {})) {
    const aceites = [].concat(valor);
    if (!aceites.some((v) => igual(final.ficha[campo], v))) {
      falhas.push(`ficha.${campo}: esperado ${aceites.map(mostrar).join(" ou ")}, obtido ${mostrar(final.ficha[campo])}`);
    }
  }
  for (const campo of esperado.preenchidos ?? []) {
    if (final.ficha[campo] === undefined || final.ficha[campo] === "") falhas.push(`ficha.${campo}: devia estar preenchido`);
  }
  for (const campo of esperado.vazios ?? []) {
    if (final.ficha[campo] !== undefined) falhas.push(`ficha.${campo}: devia estar vazio, obtido ${mostrar(final.ficha[campo])}`);
  }
  for (const texto of esperado.alertas_contem ?? []) {
    if (!final.alertas.some((a) => a.toLowerCase().includes(texto.toLowerCase()))) {
      falhas.push(`alertas: nenhum contém "${texto}" (obtidos: ${mostrar(final.alertas)})`);
    }
  }
  if (esperado.sem_alertas && final.alertas.length) falhas.push(`alertas: esperado nenhum, obtidos ${mostrar(final.alertas)}`);
  for (const c of esperado.em_falta_contem ?? []) {
    if (!final.emFalta.includes(c)) falhas.push(`em falta: devia incluir ${c} (obtido ${mostrar(final.emFalta)})`);
  }
  for (const c of esperado.em_falta_nao_contem ?? []) {
    if (final.emFalta.includes(c)) falhas.push(`em falta: não devia incluir ${c}`);
  }
  for (const c of esperado.anexos_validos ?? []) {
    if (!final.anexosValidos.includes(c)) falhas.push(`anexos: falta anexo válido ${c} (obtidos ${mostrar(final.anexosValidos)})`);
  }
  return falhas;
}

async function correrCaso(nome, caso) {
  const telefone = caso.telefone ?? telefoneDe(nome);
  await pedir("/dev/reset", { telefone });
  for (const m of caso.mensagens) {
    const corpo = { telefone, acumular: !!m.acumular, texto: m.texto ?? null };
    if (m.ficheiro) {
      corpo.ficheiroBase64 = (await readFile(m.ficheiro)).toString("base64");
      corpo.nomeFicheiro = basename(m.ficheiro);
    }
    await pedir("/dev/mensagem", corpo);
  }
  const final = await pedir(`/dev/ficha?telefone=${telefone}`);
  return { falhas: comparar(caso.esperado ?? {}, final), final, telefone };
}

const ficheiros = (await readdir(PASTA)).filter((f) => f.endsWith(".json")).sort();
const escolhidos = ficheiros.filter((f) => !filtros.length || filtros.some((p) => f.includes(p)));
if (!escolhidos.length) {
  console.error("Nenhum caso encontrado.");
  process.exit(1);
}

console.log(`Bot em ${BASE}. ${escolhidos.length} caso(s), ${repeticoes} repetição(ões) cada.\n`);
let falhados = 0;
let ignorados = 0;
for (const f of escolhidos) {
  const nome = f.replace(/\.json$/, "");
  const caso = JSON.parse(await readFile(join(PASTA, f), "utf8"));
  const emFalta = caso.mensagens.map((m) => m.ficheiro).filter((c) => c && !existsSync(c));
  if (emFalta.length) {
    ignorados++;
    console.log(`${amarelo("○")} ${nome}: ignorado, faltam ficheiros (${emFalta.join(", ")})`);
    continue;
  }
  let certos = 0;
  const detalhes = [];
  for (let r = 1; r <= repeticoes; r++) {
    try {
      const { falhas, telefone } = await correrCaso(nome, caso);
      if (!falhas.length) certos++;
      else detalhes.push(`corrida ${r} (telefone ${telefone}, ver com /ficha no simulador ou na página /dev):`, ...falhas.map((x) => `  - ${x}`));
    } catch (erro) {
      detalhes.push(`corrida ${r}: erro: ${erro.message}`);
    }
  }
  const ok = certos === repeticoes;
  if (!ok) falhados++;
  const placar = repeticoes > 1 ? ` (${certos}/${repeticoes})` : "";
  console.log(`${ok ? verde("✓") : vermelho("✗")} ${nome}${placar}${caso.descricao ? `: ${caso.descricao}` : ""}`);
  for (const d of detalhes) console.log(`    ${d}`);
}

const corridos = escolhidos.length - ignorados;
console.log(`\n${corridos - falhados}/${corridos} caso(s) passaram${ignorados ? `, ${ignorados} ignorado(s)` : ""}.`);
process.exit(falhados ? 1 : 0);
