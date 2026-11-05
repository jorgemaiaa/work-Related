/**
 * Mapeamento ficha -> campos do módulo no Zoho.
 *
 * TODOS os nomes são exemplos: substituir pelos API names reais
 * (Definições > Desenvolvimento > APIs > Nomes de API, ou GET /crm/v8/settings/fields?module=...).
 */
import type { Estado } from "./tipos";

const CAMPO_NOME = "Name"; // nome do registo (obrigatório em módulos personalizados)
const CAMPO_CONTACTO = "Contacto"; // campo lookup para Contacts
const CAMPO_ESTADO = "Estado"; // picklist
const CAMPO_TELEFONE = "Telefone_WhatsApp";
const CAMPO_RESUMO = "Resumo_Bot"; // multi-linha
const CAMPO_ALERTAS = "Alertas_Bot"; // multi-linha

const ESTADOS: Record<string, string> = {
  em_recolha: "Em recolha",
  concluida: "Pronta para proposta",
  humano: "Requer contacto humano",
};

/** Campo da ficha -> API name no Zoho. */
const MAPA_FICHA: Record<string, string> = {
  tipo_imovel: "Tipo_de_Imovel",
  tipo_estacionamento: "Tipo_de_Estacionamento",
  rede: "Rede_de_Potencia",
  potencia_contratada_kva: "Potencia_Contratada",
  potencia_pretendida_kva: "Potencia_Pretendida",
  andar_quadro: "Piso_Quadro",
  piso_estacionamento: "Piso_Estacionamento",
  distancia_declarada_m: "Distancia_ao_Quadro",
  percurso_descricao: "Percurso_do_Cabo",
  quadro_servicos_comuns: "Quadro_Servicos_Comuns",
  quadro_no_estacionamento: "Quadro_no_Estacionamento",
  distancia_quadro_estacionamento_m: "Distancia_Quadro_Estacionamento",
  prazo: "Prazo",
  observacoes: "Observacoes",
};

/** Valores internos -> opções das picklists no Zoho (têm de coincidir exatamente). */
const VALORES_PICKLIST: Record<string, string> = {
  moradia: "Moradia",
  apartamento: "Apartamento",
  empresa: "Empresa",
  outro: "Outro",
  garagem_propria_moradia: "Garagem própria (moradia)",
  box_fechada_condominio: "Box fechada em condomínio",
  lugar_aberto_condominio: "Lugar aberto em condomínio",
  exterior: "Exterior",
  monofasica: "Monofásica",
  trifasica: "Trifásica",
  nao_sabe: "Não sabe",
  sim: "Sim",
  nao: "Não",
};

export function montarDados(e: Estado): Record<string, unknown> {
  const dados: Record<string, unknown> = {
    [CAMPO_NOME]: `Análise ${e.nomePerfil ?? "+" + e.telefone}`,
    [CAMPO_ESTADO]: ESTADOS[e.estado] ?? e.estado,
    [CAMPO_TELEFONE]: `+${e.telefone}`,
    [CAMPO_RESUMO]: e.resumo ?? "",
    [CAMPO_ALERTAS]: e.alertas.join("\n"),
  };
  if (e.zohoContactoId) dados[CAMPO_CONTACTO] = { id: e.zohoContactoId };
  for (const [campo, valor] of Object.entries(e.ficha)) {
    const api = MAPA_FICHA[campo];
    if (api) dados[api] = typeof valor === "string" ? (VALORES_PICKLIST[valor] ?? valor) : valor;
  }
  return dados;
}
