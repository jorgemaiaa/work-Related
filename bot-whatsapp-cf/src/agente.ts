/** Um turno da conversa: monta o pedido ao Claude, executa as ferramentas e devolve a resposta. */
import * as F from "./ficha";
import { MENSAGEM_FALHA, PROMPT_SISTEMA, contextoDinamico } from "./prompts";
import { registar, type Env, type Estado, type LinhaMensagem } from "./tipos";

const MAX_ITERACOES = 8;
const TIPOS_IMAGEM = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_BYTES_IMAGEM = 3_750_000; // ~5 MB depois de codificado em base64

// Nenhuma ferramenta recebe IDs de cliente ou do Zoho: tudo fica preso a esta
// conversa (este Durable Object). O modelo não consegue tocar noutros clientes.
export const FERRAMENTAS = [
  {
    name: "atualizar_ficha",
    description:
      "Guarda na ficha técnica os dados indicados pelo cliente ou lidos claramente num anexo. Enviar só os campos novos ou corrigidos.",
    strict: true,
    input_schema: { type: "object", properties: F.CAMPOS, additionalProperties: false },
  },
  {
    name: "registar_anexo",
    description: "Classifica uma foto ou PDF recebido ([anexo id=N]) e indica se é utilizável.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        anexo_id: { type: "integer" },
        categoria: { type: "string", enum: F.CATEGORIAS_ANEXO },
        utilizavel: { type: "boolean" },
        nota: { type: "string", description: "O que se vê, ou porque não é utilizável." },
      },
      required: ["anexo_id", "categoria", "utilizavel", "nota"],
      additionalProperties: false,
    },
  },
  {
    name: "concluir_recolha",
    description: "Termina a recolha quando nada falta. É recusada se ainda faltar informação.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        resumo: { type: "string", description: "Resumo objetivo para a equipa técnica." },
        alertas: { type: "array", items: { type: "string" } },
      },
      required: ["resumo", "alertas"],
      additionalProperties: false,
    },
  },
  {
    name: "passar_a_humano",
    description: "Passa a conversa para a equipa.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { motivo: { type: "string" } },
      required: ["motivo"],
      additionalProperties: false,
    },
  },
];

export interface ContextoTurno {
  env: Env;
  estado: Estado; // alterado pelas ferramentas
  sql: SqlStorage;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bloco = { type: string; [k: string]: any };
type MensagemClaude = { role: "user" | "assistant"; content: Bloco[] };

function paraBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function anexosValidos(sql: SqlStorage): Set<string> {
  const linhas = sql
    .exec<{ anexo_categoria: string | null }>("SELECT DISTINCT anexo_categoria FROM mensagens WHERE anexo_utilizavel = 1")
    .toArray();
  return new Set(linhas.map((l) => l.anexo_categoria).filter((c): c is string => !!c));
}

async function conteudoCliente(m: LinhaMensagem, comFicheiro: boolean, anexos: R2Bucket): Promise<Bloco[]> {
  if (m.tipo !== "imagem" && m.tipo !== "pdf") return [{ type: "text", text: m.texto || "[mensagem vazia]" }];

  let rotulo = `[anexo id=${m.id}, ${m.tipo === "imagem" ? "foto" : "PDF"}]`;
  if (m.texto) rotulo += ` Legenda: ${m.texto}`;
  if (m.anexo_categoria) rotulo += ` (já registado como ${m.anexo_categoria}, utilizável: ${m.anexo_utilizavel ? "sim" : "não"})`;
  if (!comFicheiro) return [{ type: "text", text: rotulo }]; // anexos antigos só como texto, para poupar tokens

  const objeto = m.media_chave ? await anexos.get(m.media_chave) : null;
  if (!objeto) return [{ type: "text", text: `${rotulo} [não foi possível descarregar o ficheiro]` }];
  const mime = (m.media_mime ?? "").split(";")[0].trim();

  if (m.tipo === "imagem") {
    if (!TIPOS_IMAGEM.has(mime)) return [{ type: "text", text: `${rotulo} [formato de imagem não suportado: ${mime}]` }];
    if (objeto.size > MAX_BYTES_IMAGEM) return [{ type: "text", text: `${rotulo} [imagem demasiado grande]` }];
    const dados = paraBase64(await objeto.arrayBuffer());
    return [{ type: "text", text: rotulo }, { type: "image", source: { type: "base64", media_type: mime, data: dados } }];
  }
  const dados = paraBase64(await objeto.arrayBuffer());
  return [
    { type: "text", text: rotulo },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: dados } },
  ];
}

/** Junta mensagens seguidas do mesmo lado; a API exige alternância user/assistant. */
async function montarMensagens(historico: LinhaMensagem[], novas: LinhaMensagem[], anexos: R2Bucket): Promise<MensagemClaude[]> {
  const idsNovas = new Set(novas.map((m) => m.id));
  const msgs: MensagemClaude[] = [];
  for (const m of [...historico, ...novas].sort((a, b) => a.id - b.id)) {
    let papel: "user" | "assistant";
    let conteudo: Bloco[];
    if (m.direcao === "in") {
      papel = "user";
      conteudo = await conteudoCliente(m, idsNovas.has(m.id), anexos);
    } else if (m.texto) {
      papel = "assistant";
      conteudo = [{ type: "text", text: m.texto }];
    } else continue;
    const ultima = msgs[msgs.length - 1];
    if (ultima?.role === papel) ultima.content.push(...conteudo);
    else msgs.push({ role: papel, content: conteudo });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

function executarFerramenta(ctx: ContextoTurno, nome: string, dados: Record<string, unknown>): Record<string, unknown> {
  const e = ctx.estado;

  if (nome === "atualizar_ficha") {
    const { validos, erros } = F.validar(dados);
    if (Object.keys(validos).length) {
      e.ficha = { ...e.ficha, ...validos };
      e.alertas = F.verificarCoerencia(e.ficha); // visíveis no Zoho durante a recolha
      e.zohoPorSincronizar = true;
    }
    return {
      guardado: Object.keys(validos).sort(),
      erros,
      alertas_coerencia: F.verificarCoerencia(e.ficha),
      em_falta: F.camposEmFalta(e.ficha, anexosValidos(ctx.sql)),
    };
  }

  if (nome === "registar_anexo") {
    const id = Number(dados.anexo_id);
    const m = ctx.sql
      .exec<{ tipo: string }>("SELECT tipo FROM mensagens WHERE id = ? AND direcao = 'in'", id)
      .toArray()[0];
    if (!m || (m.tipo !== "imagem" && m.tipo !== "pdf")) return { erro: "anexo_id não existe nesta conversa" };
    const categoria = String(dados.categoria).toLowerCase();
    if (!F.CATEGORIAS_ANEXO.includes(categoria)) return { erro: `categoria '${categoria}' inválida` };
    ctx.sql.exec(
      "UPDATE mensagens SET anexo_categoria = ?, anexo_utilizavel = ?, anexo_nota = ? WHERE id = ?",
      categoria,
      dados.utilizavel ? 1 : 0,
      String(dados.nota ?? "").slice(0, 1000),
      id,
    );
    e.zohoPorSincronizar = true;
    return { registado: true, em_falta: F.camposEmFalta(e.ficha, anexosValidos(ctx.sql)) };
  }

  if (nome === "concluir_recolha") {
    const falta = F.camposEmFalta(e.ficha, anexosValidos(ctx.sql));
    if (falta.length) return { aceite: false, em_falta: falta, nota: "Ainda falta informação; continua a recolha." };
    e.estado = "concluida";
    e.resumo = String(dados.resumo ?? "").slice(0, 5000);
    const alertasModelo = Array.isArray(dados.alertas) ? dados.alertas.slice(0, 20).map((a) => String(a).slice(0, 500)) : [];
    e.alertas = [...F.verificarCoerencia(e.ficha), ...alertasModelo];
    e.zohoPorSincronizar = true;
    return { aceite: true };
  }

  if (nome === "passar_a_humano") {
    e.estado = "humano";
    e.resumo = `Passagem para a equipa. Motivo: ${String(dados.motivo ?? "").slice(0, 1000)}`;
    e.zohoPorSincronizar = true;
    return { ok: true };
  }

  return { erro: `ferramenta desconhecida: ${nome}` };
}

async function chamarClaude(env: Env, corpo: Record<string, unknown>): Promise<{ content: Bloco[]; stop_reason: string }> {
  const r = await fetch(`${env.ANTHROPIC_API_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
  return r.json();
}

/** Devolve o texto a enviar ao cliente, ou null se não houver nada a enviar. */
export async function executarTurno(ctx: ContextoTurno, novas: LinhaMensagem[]): Promise<string | null> {
  const { env, sql } = ctx;
  const historico = sql
    .exec<LinhaMensagem>(
      "SELECT * FROM mensagens WHERE processada = 1 AND tipo != 'boas_vindas' ORDER BY id DESC LIMIT ?",
      Number(env.HISTORY_MESSAGES || 30),
    )
    .toArray();
  const mensagens = await montarMensagens(historico, novas, env.ANEXOS);
  if (!mensagens.length) return null;

  for (let i = 0; i < MAX_ITERACOES; i++) {
    const anexos = anexosValidos(sql);
    const ficha = ctx.estado.ficha;
    const sistema = [
      // Parte fixa: fica em cache entre chamadas (mais barato e mais rápido)
      { type: "text", text: PROMPT_SISTEMA, cache_control: { type: "ephemeral" } },
      // Parte variável: estado da ficha neste momento
      {
        type: "text",
        text: contextoDinamico(ctx.estado.nomePerfil, ficha, anexos, F.camposEmFalta(ficha, anexos), F.verificarCoerencia(ficha)),
      },
    ];
    const resp = await chamarClaude(env, {
      model: env.CLAUDE_MODEL,
      max_tokens: Number(env.CLAUDE_MAX_TOKENS || 1024),
      system: sistema,
      tools: FERRAMENTAS,
      messages: mensagens,
    });
    mensagens.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason !== "tool_use") {
      if (resp.stop_reason !== "end_turn") registar("stop_reason_inesperado", { telefone: ctx.estado.telefone, stop_reason: resp.stop_reason });
      const texto = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      return texto || null;
    }

    const resultados: Bloco[] = [];
    for (const bloco of resp.content) {
      if (bloco.type !== "tool_use") continue;
      let resultado: Record<string, unknown>;
      try {
        resultado = executarFerramenta(ctx, bloco.name, bloco.input ?? {});
      } catch (erro) {
        registar("erro_ferramenta", { ferramenta: bloco.name, erro: String(erro) });
        resultado = { erro: "falha interna ao executar a ferramenta" };
      }
      registar("ferramenta", { telefone: ctx.estado.telefone, nome: bloco.name, entrada: bloco.input, resultado });
      resultados.push({ type: "tool_result", tool_use_id: bloco.id, content: JSON.stringify(resultado) });
    }
    mensagens.push({ role: "user", content: resultados });
  }

  registar("limite_iteracoes", { telefone: ctx.estado.telefone });
  ctx.estado.estado = "humano";
  ctx.estado.resumo = "Passagem automática para a equipa: o bot não conseguiu concluir o turno.";
  ctx.estado.zohoPorSincronizar = true;
  return MENSAGEM_FALHA;
}
