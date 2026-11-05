import { describe, expect, it } from "vitest";
import { FERRAMENTAS } from "../src/agente";
import { CAMPOS, camposEmFalta, validar, verificarCoerencia, type Ficha } from "../src/ficha";

const ANEXOS_COMPLETOS = new Set(["quadro_aberto", "local_carregador", "fatura_eletricidade"]);

/** Ficha com todos os campos obrigatórios preenchidos e coerentes (moradia). */
function fichaCompleta(extra: Ficha = {}): Ficha {
  return {
    tipo_imovel: "moradia",
    tipo_estacionamento: "garagem_propria_moradia",
    rede: "monofasica",
    andar_quadro: 0,
    piso_estacionamento: 0,
    distancia_declarada_m: 10,
    percurso_descricao: "Pela parede da garagem",
    ...extra,
  };
}

describe("CAMPOS (limites do strict tool use)", () => {
  it("não usa minimum/maximum no esquema", () => {
    for (const esquema of Object.values(CAMPOS)) {
      expect(esquema).not.toHaveProperty("minimum");
      expect(esquema).not.toHaveProperty("maximum");
    }
  });

  it("não passa de 24 parâmetros opcionais no total das ferramentas strict", () => {
    let opcionais = 0;
    for (const f of FERRAMENTAS) {
      if (!f.strict) continue;
      const esquema = f.input_schema as { properties: object; required?: readonly string[] };
      opcionais += Object.keys(esquema.properties).length - (esquema.required?.length ?? 0);
    }
    expect(opcionais).toBeLessThanOrEqual(24);
  });
});

describe("validar", () => {
  it("aceita valores válidos de todos os tipos", () => {
    const { validos, erros } = validar({
      tipo_imovel: "moradia",
      potencia_contratada_kva: 6.9,
      andar_quadro: -1,
      percurso_descricao: "  pelo teto da cave  ",
    });
    expect(erros).toEqual([]);
    expect(validos).toEqual({
      tipo_imovel: "moradia",
      potencia_contratada_kva: 6.9,
      andar_quadro: -1,
      percurso_descricao: "pelo teto da cave",
    });
  });

  it("rejeita campos desconhecidos", () => {
    const { validos, erros } = validar({ cliente_id: "123" });
    expect(validos).toEqual({});
    expect(erros).toEqual(["cliente_id: campo desconhecido"]);
  });

  it("normaliza maiúsculas nos enums e rejeita valores fora da lista", () => {
    expect(validar({ rede: "Trifasica" }).validos).toEqual({ rede: "trifasica" });
    const { validos, erros } = validar({ rede: "bifasica" });
    expect(validos).toEqual({});
    expect(erros[0]).toContain("rede");
  });

  it("ignora texto vazio ou só com espaços, sem erro", () => {
    expect(validar({ observacoes: "   " })).toEqual({ validos: {}, erros: [] });
  });

  it("corta texto livre a 1000 caracteres", () => {
    const { validos } = validar({ observacoes: "a".repeat(1500) });
    expect(String(validos.observacoes).length).toBe(1000);
  });

  it("rejeita números como texto, NaN e infinito", () => {
    for (const bruto of ["6", NaN, Infinity]) {
      const { validos, erros } = validar({ distancia_declarada_m: bruto });
      expect(validos).toEqual({});
      expect(erros[0]).toContain("tem de ser um número");
    }
  });

  it("rejeita decimais em campos inteiros", () => {
    const { validos, erros } = validar({ andar_quadro: 1.5 });
    expect(validos).toEqual({});
    expect(erros[0]).toContain("inteiro");
  });

  it("aplica os LIMITES, incluindo os extremos", () => {
    expect(validar({ andar_quadro: -6 }).validos).toEqual({ andar_quadro: -6 });
    expect(validar({ andar_quadro: 60 }).validos).toEqual({ andar_quadro: 60 });
    expect(validar({ andar_quadro: -7 }).erros[0]).toContain("fora do intervalo");
    expect(validar({ distancia_declarada_m: 301 }).erros[0]).toContain("fora do intervalo");
    expect(validar({ potencia_contratada_kva: 0.5 }).erros[0]).toContain("fora do intervalo");
  });

  it("guarda os válidos mesmo quando outros falham", () => {
    const { validos, erros } = validar({ rede: "monofasica", andar_quadro: 100 });
    expect(validos).toEqual({ rede: "monofasica" });
    expect(erros).toHaveLength(1);
  });
});

describe("camposEmFalta", () => {
  it("lista todos os obrigatórios e anexos numa ficha vazia", () => {
    expect(camposEmFalta({}, new Set())).toEqual([
      "tipo_imovel",
      "tipo_estacionamento",
      "rede",
      "andar_quadro",
      "piso_estacionamento",
      "distancia_declarada_m",
      "percurso_descricao",
      "anexo:quadro_aberto",
      "anexo:local_carregador",
      "anexo:fatura_eletricidade",
    ]);
  });

  it("não falta nada numa moradia completa", () => {
    expect(camposEmFalta(fichaCompleta(), ANEXOS_COMPLETOS)).toEqual([]);
  });

  it("aceita 0 como valor preenchido (rés-do-chão)", () => {
    const falta = camposEmFalta(fichaCompleta({ andar_quadro: 0 }), ANEXOS_COMPLETOS);
    expect(falta).not.toContain("andar_quadro");
  });

  it("exige quadro_servicos_comuns em estacionamento de condomínio", () => {
    for (const tipo of ["box_fechada_condominio", "lugar_aberto_condominio"]) {
      const ficha = fichaCompleta({ tipo_imovel: "apartamento", tipo_estacionamento: tipo });
      expect(camposEmFalta(ficha, ANEXOS_COMPLETOS)).toEqual(["quadro_servicos_comuns"]);
      expect(camposEmFalta({ ...ficha, quadro_servicos_comuns: "nao_sabe" }, ANEXOS_COMPLETOS)).toEqual([]);
    }
  });

  it("lista só os anexos obrigatórios em falta", () => {
    const anexos = new Set(["quadro_aberto", "percurso"]);
    expect(camposEmFalta(fichaCompleta(), anexos)).toEqual([
      "anexo:local_carregador",
      "anexo:fatura_eletricidade",
    ]);
  });
});

describe("verificarCoerencia", () => {
  it("caso de referência: quadro no piso 5, carro no piso -1 e 6 m declarados gera alerta", () => {
    const alertas = verificarCoerencia({ andar_quadro: 5, piso_estacionamento: -1, distancia_declarada_m: 6 });
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toContain("6 m");
    expect(alertas[0]).toContain("18 m");
  });

  it("não gera alerta quando a distância cobre o desnível", () => {
    expect(verificarCoerencia({ andar_quadro: 5, piso_estacionamento: -1, distancia_declarada_m: 18 })).toEqual([]);
    expect(verificarCoerencia({ andar_quadro: 0, piso_estacionamento: 0, distancia_declarada_m: 0 })).toEqual([]);
  });

  it("não avalia a distância sem os três valores", () => {
    expect(verificarCoerencia({ andar_quadro: 5, piso_estacionamento: -1 })).toEqual([]);
  });

  it("deteta apartamento com garagem de moradia", () => {
    const alertas = verificarCoerencia({ tipo_imovel: "apartamento", tipo_estacionamento: "garagem_propria_moradia" });
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toContain("apartamento");
  });

  it("deteta potência pretendida inferior à atual", () => {
    expect(verificarCoerencia({ potencia_contratada_kva: 6.9, potencia_pretendida_kva: 3.45 })).toHaveLength(1);
    expect(verificarCoerencia({ potencia_contratada_kva: 6.9, potencia_pretendida_kva: 10.35 })).toEqual([]);
  });

  it("acumula vários alertas", () => {
    const alertas = verificarCoerencia({
      tipo_imovel: "apartamento",
      tipo_estacionamento: "garagem_propria_moradia",
      andar_quadro: 3,
      piso_estacionamento: -2,
      distancia_declarada_m: 5,
    });
    expect(alertas).toHaveLength(2);
  });

  it("ficha completa e coerente não tem alertas", () => {
    expect(verificarCoerencia(fichaCompleta())).toEqual([]);
  });
});
