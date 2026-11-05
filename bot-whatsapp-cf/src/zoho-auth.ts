/**
 * Guarda o access token do Zoho num único Durable Object partilhado.
 * Evita que cada conversa renove o token por conta própria: o Zoho limita
 * quantos tokens se podem gerar por refresh token num curto espaço de tempo.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./tipos";

interface TokenGuardado {
  token: string;
  expira: number;
}

export class ZohoAuth extends DurableObject<Env> {
  private token: string | null = null;
  private expira = 0;
  private pendente: Promise<string> | null = null;

  async obterToken(forcar = false): Promise<string> {
    if (!this.token) {
      const guardado = await this.ctx.storage.get<TokenGuardado>("token");
      if (guardado) ({ token: this.token, expira: this.expira } = guardado);
    }
    if (!forcar && this.token && Date.now() < this.expira - 60_000) return this.token;
    // Pedidos simultâneos partilham a mesma renovação
    this.pendente ??= this.renovar().finally(() => {
      this.pendente = null;
    });
    return this.pendente;
  }

  private async renovar(): Promise<string> {
    const r = await fetch(`${this.env.ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.env.ZOHO_REFRESH_TOKEN,
        client_id: this.env.ZOHO_CLIENT_ID,
        client_secret: this.env.ZOHO_CLIENT_SECRET,
      }),
    });
    const dados = await r.json<{ access_token?: string; expires_in?: number }>();
    if (!r.ok || !dados.access_token) throw new Error(`Falha ao renovar token do Zoho: ${JSON.stringify(dados)}`);
    this.token = dados.access_token;
    this.expira = Date.now() + Number(dados.expires_in ?? 3600) * 1000;
    await this.ctx.storage.put<TokenGuardado>("token", { token: this.token, expira: this.expira });
    return this.token;
  }
}
