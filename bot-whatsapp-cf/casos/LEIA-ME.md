# Casos de regressão

Cada ficheiro `*.json` é uma conversa de teste. O script `scripts/correr-casos.mjs` apaga a conversa, envia as mensagens ao bot pelas rotas `/dev/*` e compara o estado final da ficha com as expectativas. As respostas do modelo variam, por isso as expectativas são sobre a ficha, nunca sobre o texto.

```bash
npm run dev                            # terminal 1
npm run casos                          # terminal 2: todos os casos
npm run casos -- referencia            # só os casos cujo nome contém "referencia"
npm run casos -- --repeticoes 3        # 3 corridas por caso, para ver a estabilidade
```

Cada caso chama o Claude real várias vezes: correr a bateria completa tem custo. Cada caso usa um telefone próprio; depois de uma falha, a conversa fica guardada e pode ser vista na página `/dev` (o telefone aparece na mensagem de erro).

## Formato

```jsonc
{
  "descricao": "Uma frase sobre o que o caso verifica",
  "telefone": "351900000123",           // opcional; por omissão, derivado do nome do ficheiro
  "mensagens": [
    { "texto": "Olá" },
    { "texto": "várias seguidas", "acumular": true },   // guarda sem o bot responder
    { "ficheiro": "fotos/quadro.jpg", "texto": "legenda opcional" }
  ],
  "esperado": {
    "estado": "em_recolha",                  // ou uma lista: ["em_recolha", "humano"]
    "ficha": { "andar_quadro": 5, "rede": ["trifasica", "nao_sabe"] },  // valor exato, ou lista de aceites
    "preenchidos": ["percurso_descricao"],   // só verifica que tem valor (texto livre)
    "vazios": ["prazo"],
    "alertas_contem": ["mínimo vertical"],   // pedaço de texto de um alerta
    "sem_alertas": true,
    "em_falta_contem": ["anexo:quadro_aberto"],
    "em_falta_nao_contem": ["rede"],
    "anexos_validos": ["quadro_aberto"],
    "resposta_contem": ["contador"]          // palavra que tem de aparecer na última resposta do bot
  }
}
```

Todas as chaves de `esperado` são opcionais. Os textos comparam-se sem distinguir maiúsculas. Use `resposta_contem` só para palavras que o bot tem de usar de certeza (por exemplo, "contador" quando pede essa foto); uma lista dentro da lista aceita alternativas (`[["contador", "contagem"]]`).

## Fotos

Os ficheiros de `fotos/` não vão para o Git (podem ter dados de clientes). Um caso que use um ficheiro em falta aparece como "ignorado". O caso `completa-com-fotos` precisa de `fotos/quadro.jpg`, `fotos/local.jpg` e `fotos/fatura.pdf`; os casos `rede-quadro-2-polos` e `rede-quadro-4-polos-sem-certeza` precisam de `fotos/quadro-2-polos.jpg` (quadro com geral ou diferencial de 2 polos) e `fotos/quadro-4-polos.jpg` (quadro com diferencial de 4 polos, como um Hager CF425); o caso `rede-pela-foto-do-contador` precisa também de `fotos/contador.jpg`.

## Acrescentar casos

Quando aparecer um erro numa conversa real ou de teste, acrescentar aqui um caso que o reproduza, com as expectativas certas. Se a regra for de código (validação, campos em falta, coerência), acrescentar também um teste em `testes/ficha.test.ts`.
