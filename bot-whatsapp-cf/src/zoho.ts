/** Ligação à API REST do Zoho CRM (v8). O token vem do Durable Object ZohoAuth. */
import { comJurisdicao, type Env } from "./tipos";

export class ZohoErro extends Error {}

/** O WhatsApp entrega '351965402252'; no Zoho pode estar com ou sem indicativo. */
export function variantesTelefone(telefone: string): string[] {
  const variantes = [`+${telefone}`];
  if (telefone.startsWith("351")) variantes.push(telefone.slice(3));
  return variantes;
}

interface OpcoesPedido {
  params?: Record<string, string>;
  json?: unknown;
  form?: FormData;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RespostaZoho = { data?: any[] } | null;

export class ZohoCliente {
  constructor(private env: Env) {}

  private async token(forcar: boolean): Promise<string> {
    return comJurisdicao(this.env, this.env.ZOHO_AUTH).getByName("global").obterToken(forcar);
  }

  private async pedido(metodo: string, caminho: string, opcoes: OpcoesPedido = {}): Promise<RespostaZoho> {
    const url = new URL(`${this.env.ZOHO_API_URL}/crm/v8/${caminho}`);
    for (const [k, v] of Object.entries(opcoes.params ?? {})) url.searchParams.set(k, v);
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${await this.token(tentativa > 0)}` };
      let body: BodyInit | undefined;
      if (opcoes.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opcoes.json);
      } else if (opcoes.form) {
        body = opcoes.form;
      }
      const r = await fetch(url, { method: metodo, headers, body });
      if (r.status === 401 && tentativa === 0) continue; // token revogado ou expirado: renova e repete
      if (r.status === 204) return null; // pesquisa sem resultados
      if (!r.ok) throw new ZohoErro(`${metodo} ${caminho} -> ${r.status}: ${await r.text()}`);
      return r.json();
    }
    throw new ZohoErro("Autenticação recusada após renovar o token");
  }

  private static idDoResultado(resposta: RespostaZoho): string {
    const item = resposta?.data?.[0] ?? {};
    if (item.code !== "SUCCESS") throw new ZohoErro(`Operação recusada: ${JSON.stringify(item)}`);
    return String(item.details.id);
  }

  async procurarContacto(telefone: string): Promise<string | null> {
    for (const variante of variantesTelefone(telefone)) {
      const d = await this.pedido("GET", "Contacts/search", { params: { phone: variante } });
      if (d?.data?.length) return String(d.data[0].id);
    }
    return null;
  }

  async criarContacto(nome: string | null, telefone: string): Promise<string> {
    const partes = (nome ?? "").split(/\s+/).filter(Boolean);
    const dados: Record<string, string> = {
      Last_Name: partes.length ? partes[partes.length - 1] : `WhatsApp ${telefone}`,
      Mobile: `+${telefone}`,
    };
    if (partes.length > 1) dados.First_Name = partes.slice(0, -1).join(" ");
    return ZohoCliente.idDoResultado(await this.pedido("POST", "Contacts", { json: { data: [dados] } }));
  }

  async criarRegisto(dados: Record<string, unknown>): Promise<string> {
    return ZohoCliente.idDoResultado(await this.pedido("POST", this.env.ZOHO_MODULE, { json: { data: [dados] } }));
  }

  async atualizarRegisto(registoId: string, dados: Record<string, unknown>): Promise<void> {
    ZohoCliente.idDoResultado(
      await this.pedido("PUT", `${this.env.ZOHO_MODULE}/${registoId}`, { json: { data: [dados] } }),
    );
  }

  async anexar(registoId: string, nome: string, conteudo: ArrayBuffer, mime: string): Promise<void> {
    const form = new FormData();
    form.append("file", new Blob([conteudo], { type: mime }), nome);
    await this.pedido("POST", `${this.env.ZOHO_MODULE}/${registoId}/Attachments`, { form });
  }
}
