import type { Conversa } from "./conversa";
import type { ZohoAuth } from "./zoho-auth";

/** Bindings, variáveis (wrangler.jsonc) e segredos (wrangler secret put / .dev.vars). */
export interface Env {
  CONVERSAS: DurableObjectNamespace<Conversa>;
  ZOHO_AUTH: DurableObjectNamespace<ZohoAuth>;
  ANEXOS: R2Bucket;

  // Variáveis
  WA_GRAPH_VERSION: string;
  CLAUDE_MODEL: string;
  CLAUDE_MAX_TOKENS: string;
  ANTHROPIC_API_URL: string;
  ZOHO_ENABLED: string;
  ZOHO_ACCOUNTS_URL: string;
  ZOHO_API_URL: string;
  ZOHO_MODULE: string;
  DEBOUNCE_MS: string;
  HISTORY_MESSAGES: string;
  JURISDICAO: string; // "eu" em produção; vazio em desenvolvimento local
  MODO_DEV: string; // "true" só em desenvolvimento: ativa /dev/* e não envia WhatsApp

  // Segredos
  WA_VERIFY_TOKEN: string;
  WA_APP_SECRET: string;
  WA_ACCESS_TOKEN: string;
  WA_PHONE_NUMBER_ID: string;
  ANTHROPIC_API_KEY: string;
  ZOHO_CLIENT_ID: string;
  ZOHO_CLIENT_SECRET: string;
  ZOHO_REFRESH_TOKEN: string;
}

export type TipoMensagem = "texto" | "imagem" | "pdf" | "outro" | "boas_vindas";

export interface MensagemRecebida {
  waId: string;
  telefone: string;
  nome: string | null;
  tipo: TipoMensagem;
  texto: string | null;
  mediaId: string | null;
  mime: string | null;
  mediaChave?: string | null; // já guardado no R2 (usado pelo simulador)
}

export type LinhaMensagem = {
  id: number;
  wa_id: string | null;
  direcao: string; // "in" | "out"
  tipo: string;
  texto: string | null;
  media_id: string | null;
  media_chave: string | null;
  media_mime: string | null;
  processada: number;
  anexo_categoria: string | null;
  anexo_utilizavel: number | null;
  anexo_nota: string | null;
  zoho_anexo_enviado: number;
  criado_em: string;
};

export type EstadoConversa = "em_recolha" | "concluida" | "humano";

export interface Estado {
  telefone: string;
  nomePerfil: string | null;
  estado: EstadoConversa;
  ficha: Record<string, string | number>;
  resumo: string | null;
  alertas: string[];
  boasVindasEnviadas: boolean;
  zohoContactoId: string | null;
  zohoRegistoId: string | null;
  zohoPorSincronizar: boolean;
}

export function estadoInicial(telefone = ""): Estado {
  return {
    telefone,
    nomePerfil: null,
    estado: "em_recolha",
    ficha: {},
    resumo: null,
    alertas: [],
    boasVindasEnviadas: false,
    zohoContactoId: null,
    zohoRegistoId: null,
    zohoPorSincronizar: false,
  };
}

/** Aplica a jurisdição (ex.: "eu") para os dados ficarem guardados na UE. */
export function comJurisdicao<T extends Rpc.DurableObjectBranded | undefined>(
  env: Env,
  ns: DurableObjectNamespace<T>,
): DurableObjectNamespace<T> {
  return env.JURISDICAO ? ns.jurisdiction(env.JURISDICAO as DurableObjectJurisdiction) : ns;
}

/** Um Durable Object por número de telefone: cada cliente tem a sua "gaveta". */
export function conversaDe(env: Env, telefone: string) {
  return comJurisdicao(env, env.CONVERSAS).getByName(telefone);
}

export function registar(evento: string, dados: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ evento, ...dados }));
}
