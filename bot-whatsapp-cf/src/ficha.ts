/**
 * Ficha técnica: o ÚNICO sítio onde se definem os campos a recolher.
 *
 * Os campos são um exemplo. Quando o módulo do Zoho estiver redesenhado, ajustar
 * aqui e em zoho-mapa.ts. A ferramenta atualizar_ficha é gerada a partir de CAMPOS.
 */
export type Ficha = Record<string, string | number>;

interface EsquemaCampo {
  type: "string" | "number" | "integer";
  enum?: string[];
  description: string;
}

// Limites do strict tool use: até 24 parâmetros opcionais no total e sem
// minimum/maximum no esquema (os limites numéricos ficam em LIMITES).
export const CAMPOS: Record<string, EsquemaCampo> = {
  tipo_imovel: {
    type: "string",
    enum: ["moradia", "apartamento", "empresa", "outro"],
    description: "Tipo de imóvel onde fica o contador do cliente.",
  },
  tipo_estacionamento: {
    type: "string",
    enum: ["garagem_propria_moradia", "box_fechada_condominio", "lugar_aberto_condominio", "exterior", "outro"],
    description: "Onde o carro fica estacionado e onde ficará o carregador.",
  },
  rede: {
    type: "string",
    enum: ["monofasica", "trifasica", "nao_sabe"],
    description: "Tipo de alimentação da instalação do cliente (a fatura costuma indicar).",
  },
  potencia_contratada_kva: {
    type: "number",
    description: "Potência contratada atual em kVA (ex.: 3.45, 6.9). Lida da fatura ou indicada pelo cliente.",
  },
  potencia_pretendida_kva: {
    type: "number",
    description: "Potência que o cliente pensa contratar, se mencionar um aumento.",
  },
  andar_quadro: {
    type: "integer",
    description: "Piso onde está o quadro elétrico da habitação. 0 = rés-do-chão, -1 = primeira cave.",
  },
  piso_estacionamento: {
    type: "integer",
    description: "Piso do lugar do carro. 0 = rés-do-chão, -1 = primeira cave.",
  },
  distancia_declarada_m: {
    type: "number",
    description: "Distância em metros indicada pelo cliente entre o quadro e o local do carregador.",
  },
  percurso_descricao: {
    type: "string",
    description: "Descrição, nas palavras do cliente, de por onde o cabo poderá passar.",
  },
  quadro_servicos_comuns: {
    type: "string",
    enum: ["sim", "nao", "nao_sabe"],
    description: "Se existe quadro dos serviços comuns do condomínio perto do lugar.",
  },
  prazo: {
    type: "string",
    description: "Prazo ou urgência indicada pelo cliente (ex.: 'tem de ficar instalado em 2026').",
  },
  observacoes: {
    type: "string",
    description: "Outra informação relevante para a equipa técnica.",
  },
};

const LIMITES: Record<string, [number, number]> = {
  potencia_contratada_kva: [1, 50],
  potencia_pretendida_kva: [1, 50],
  andar_quadro: [-6, 60],
  piso_estacionamento: [-6, 60],
  distancia_declarada_m: [0, 300],
};

const OBRIGATORIOS = [
  "tipo_imovel",
  "tipo_estacionamento",
  "rede",
  "andar_quadro",
  "piso_estacionamento",
  "distancia_declarada_m",
  "percurso_descricao",
];

const ESTACIONAMENTO_CONDOMINIO = new Set(["box_fechada_condominio", "lugar_aberto_condominio"]);

export const CATEGORIAS_ANEXO = [
  "quadro_aberto",
  "disjuntor_entrada",
  "local_carregador",
  "percurso",
  "fatura_eletricidade",
  "quadro_servicos_comuns",
  "outra",
];
const ANEXOS_OBRIGATORIOS = ["quadro_aberto", "local_carregador", "fatura_eletricidade"];

const ALTURA_PISO_M = 3;

/** Separa os valores válidos dos inválidos. */
export function validar(dados: Record<string, unknown>): { validos: Ficha; erros: string[] } {
  const validos: Ficha = {};
  const erros: string[] = [];
  for (const [nome, bruto] of Object.entries(dados)) {
    const esquema = CAMPOS[nome];
    if (!esquema) {
      erros.push(`${nome}: campo desconhecido`);
      continue;
    }
    if (esquema.type === "string") {
      let valor = String(bruto ?? "").trim();
      if (!valor) continue;
      if (esquema.enum) {
        valor = valor.toLowerCase(); // o modelo pode variar maiúsculas
        if (!esquema.enum.includes(valor)) {
          erros.push(`${nome}: valor '${valor}' não permitido`);
          continue;
        }
      }
      validos[nome] = valor.slice(0, 1000);
    } else {
      if (typeof bruto !== "number" || !Number.isFinite(bruto)) {
        erros.push(`${nome}: tem de ser um número`);
        continue;
      }
      if (esquema.type === "integer" && !Number.isInteger(bruto)) {
        erros.push(`${nome}: tem de ser um número inteiro`);
        continue;
      }
      const [minimo, maximo] = LIMITES[nome] ?? [-Infinity, Infinity];
      if (bruto < minimo || bruto > maximo) {
        erros.push(`${nome}: ${bruto} fora do intervalo plausível (${minimo} a ${maximo})`);
        continue;
      }
      validos[nome] = bruto;
    }
  }
  return { validos, erros };
}

export function camposEmFalta(ficha: Ficha, anexosValidos: Set<string>): string[] {
  const falta = OBRIGATORIOS.filter((c) => ficha[c] === undefined || ficha[c] === "");
  if (ESTACIONAMENTO_CONDOMINIO.has(String(ficha.tipo_estacionamento)) && !ficha.quadro_servicos_comuns) {
    falta.push("quadro_servicos_comuns");
  }
  for (const a of ANEXOS_OBRIGATORIOS) if (!anexosValidos.has(a)) falta.push(`anexo:${a}`);
  return falta;
}

/** Regras que detetam respostas incoerentes. Acrescentar aqui os casos aprendidos. */
export function verificarCoerencia(ficha: Ficha): string[] {
  const alertas: string[] = [];
  const andar = ficha.andar_quadro as number | undefined;
  const piso = ficha.piso_estacionamento as number | undefined;
  const dist = ficha.distancia_declarada_m as number | undefined;
  if (andar !== undefined && piso !== undefined && dist !== undefined) {
    const minimo = Math.abs(andar - piso) * ALTURA_PISO_M;
    if (dist < minimo) {
      alertas.push(
        `Distância declarada (${dist} m) inferior ao mínimo vertical estimado (${minimo} m) entre o piso ${andar} e o piso ${piso}.`,
      );
    }
  }
  if (ficha.tipo_imovel === "apartamento" && ficha.tipo_estacionamento === "garagem_propria_moradia") {
    alertas.push("Imóvel indicado como apartamento mas estacionamento como garagem de moradia.");
  }
  const pot = ficha.potencia_contratada_kva as number | undefined;
  const pretendida = ficha.potencia_pretendida_kva as number | undefined;
  if (pot && pretendida && pretendida < pot) {
    alertas.push(`Potência pretendida (${pretendida} kVA) inferior à atual (${pot} kVA).`);
  }
  return alertas;
}
