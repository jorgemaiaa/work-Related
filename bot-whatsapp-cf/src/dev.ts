/** Proteção das rotas /dev/* e página do banco de testes (src/pagina-dev.html). Só usados com MODO_DEV=true. */
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

/** Página estática do banco de testes: não contém dados. Todas as ações passam por /dev/* com o token. */
export { default as PAGINA_DEV } from "./pagina-dev.html";
