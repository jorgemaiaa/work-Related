# Bot de análise técnica (WhatsApp → Claude → Zoho CRM)

## O que é

Bot de WhatsApp de uma empresa portuguesa que instala carregadores de veículos elétricos. Conversa com o cliente, recolhe a informação técnica para a instalação (pisos, distâncias, percurso do cabo, rede mono/trifásica, potência contratada, fotos do quadro, do local e da fatura) e grava tudo no módulo personalizado "Análise Técnica" do Zoho CRM. A proposta comercial é gerada depois por um workflow no Zoho: **o bot nunca calcula nem indica preços**.

Estado: **piloto em desenvolvimento**. O esqueleto funciona de ponta a ponta com o Claude e o Zoho simulados. Já conversa com o Claude real no banco de testes (`/dev`); ainda não foi testado contra as APIs reais da Meta nem do Zoho. As próximas tarefas estão em `docs/proximos-passos.md`.

## Stack

- Cloudflare Workers em TypeScript, com Durable Objects (SQLite) e R2.
- API do Claude chamada por `fetch` (sem SDK). Modelo em `CLAUDE_MODEL` (wrangler.jsonc).
- WhatsApp Cloud API (Meta) e Zoho CRM API v8, centro de dados europeu (`.eu`).
- Desenvolvimento no GitHub Codespaces (`.devcontainer/`). O utilizador não pode instalar software no PC.

## Comandos

```bash
npm run dev        # Worker local em http://localhost:8787 (usa .dev.vars)
npm run simular    # simulador de conversa no terminal (precisa do dev a correr)
npm run verificar  # tsc (código e testes): correr sempre depois de alterar código
npm run testar     # testes automáticos (Vitest, pasta testes/)
npm run casos      # conversas de regressão (casos/*.json) contra o bot local; usa o Claude real
npm run deploy     # publicar (precisa de CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID)
npm run logs       # wrangler tail do Worker publicado
npm run deploy:staging / npm run logs:staging   # o mesmo para o Worker de staging
```

O simulador aceita `/foto caminho [legenda]`, `+ texto` (acumula sem responder), `/ficha` e `/reset`. As rotas `/dev/*` só existem com `MODO_DEV=true` e exigem o cabeçalho `X-Dev-Token` igual a `DEV_TOKEN` (sem `DEV_TOKEN`, só respondem em `localhost`). O simulador e o `npm run casos` leem o `DEV_TOKEN` do ambiente ou de `.dev.vars`. Contra o staging: `BOT_URL=... DEV_TOKEN=... npm run simular`.

A página `/dev` (`src/pagina-dev.html`) é o banco de testes: chat e ficha em tempo real lado a lado. Usa `/dev/ficha`, que devolve o estado, `emFalta`, `campos` e o histórico de mensagens.

## Arquitetura

- `src/index.ts`: Worker. Valida a assinatura da Meta (`X-Hub-Signature-256`), extrai as mensagens e entrega cada uma ao Durable Object do cliente. Responde 200 logo.
- `src/conversa.ts`: Durable Object `Conversa`, **um por número de telefone** (`getByName(telefone)`). Guarda mensagens em SQLite e o estado (`Estado`) na chave `"estado"` do storage. Cada mensagem nova adia o *alarm* (`DEBOUNCE_MS`), por isso o bot responde só quando o cliente pára de escrever. No `alarm()`: descarrega media para o R2, corre um turno do agente, responde e sincroniza com o Zoho. Falhas são repetidas pela Cloudflare. Ao fim de `MAX_TENTATIVAS`, a conversa passa a "humano".
- `src/agente.ts`: um turno com o Claude. Quatro ferramentas com `strict: true`: `atualizar_ficha`, `registar_anexo`, `concluir_recolha`, `passar_a_humano`. O system prompt tem uma parte fixa com `cache_control` e uma parte dinâmica com o estado da ficha.
- `src/ficha.ts`: **fonte única dos campos a recolher**, validação, campos em falta e regras de coerência. O esquema da ferramenta `atualizar_ficha` é gerado a partir de `CAMPOS`.
- `src/zoho-mapa.ts`: mapeamento ficha → API names do Zoho. **Os nomes atuais são exemplos.**
- `src/zoho.ts` e `src/zoho-auth.ts`: cliente Zoho e Durable Object único que guarda e renova o access token.
- `src/whatsapp.ts`: envio de texto, descarga de media, parsing do webhook.
- `src/dev.ts` e `src/pagina-dev.html`: proteção das rotas `/dev/*` (`DEV_TOKEN`) e página do banco de testes servida em `/dev`.
- `src/prompts.ts`: prompt de sistema e mensagens fixas. Contém os marcadores `[EMPRESA]` e `[LINK_PRIVACIDADE]` por preencher.

## Decisões a manter

1. **O modelo nunca recebe IDs de cliente, de registo nem credenciais.** As ferramentas atuam só sobre a conversa do Durable Object atual. Nunca acrescentar parâmetros de ID às ferramentas. É a defesa contra prompt injection de um cliente.
2. **Regras de negócio no código, não no prompt.** Validação, campos em falta e coerência estão em `ficha.ts`. `concluir_recolha` é recusada pelo código se faltar informação. O prompt explica; o código garante.
3. **O bot não indica preços, prazos nem compromissos.**
4. **Ficha e Zoho evoluem juntos.** Ao mudar um campo, atualizar `ficha.ts`, `zoho-mapa.ts` e, se necessário, o prompt.
5. **Limites do strict tool use:** no máximo 24 parâmetros opcionais no total entre todas as ferramentas strict, e sem `minimum`/`maximum` no esquema. Os limites numéricos ficam em `LIMITES`, em `ficha.ts`.
6. **Jurisdição UE (`JURISDICAO="eu"`) fixada antes do primeiro deploy.** Mudá-la depois cria Durable Objects novos e "perde" as conversas existentes.
7. **Propriedade do registo no Zoho:** enquanto o estado é `em_recolha`, escreve o bot. A partir de `concluida` ou `humano`, o bot deixa de alterar dados (só faz a sincronização final).
8. **Dentro de um turno, o pedido ao Claude só cresce no fim.** O system prompt (incluindo o "Estado atual") é montado uma vez por turno em `executarTurno` e não muda entre iterações; as mensagens só recebem acrescentos. Os blocos de pensamento do modelo ficam ligados ao prompt exato em que nasceram: alterar o system ou mensagens anteriores a meio do turno dá 400 ("Invalid signature in thinking block"). As novidades durante o turno vão nos resultados das ferramentas.
9. Ao alterar o esquema SQL em `conversa.ts`, os Durable Objects existentes já têm a tabela antiga: usar `ALTER TABLE` idempotente, nunca só mudar o `CREATE TABLE`.

## Convenções

- Texto visto pelo cliente: **português de Portugal**, formal sem "tu", mensagens curtas para telemóvel.
- Código: identificadores e comentários em português, como no resto do projeto. TypeScript `strict`.
- Logs com `registar(evento, dados)` (JSON numa linha). Atenção: os logs podem conter dados pessoais.
- `wrangler.jsonc` tem um ambiente `staging` (Worker e bucket R2 separados, `MODO_DEV=true`). Bindings e `vars` não são herdados: ao acrescentar uma variável ou binding, acrescentá-la também em `env.staging`.
- Segredos nunca no código nem no Git: `.dev.vars` (local, gerado por `scripts/preparar-codespace.sh`) e `wrangler secret put` (produção). No Codespace, a chave do bot é o secret `BOT_ANTHROPIC_API_KEY`.
- Antes de dar uma tarefa por concluída: `npm run verificar`, `npm run testar` e uma conversa no simulador ou no banco de testes que exercite a alteração. Se a alteração mexer no comportamento do bot, correr também `npm run casos`.
- Quando aparecer um erro numa conversa, acrescentar um caso em `casos/` que o reproduza.

## Pontos por confirmar nas APIs reais

- Versão da Graph API em `WA_GRAPH_VERSION`.
- Formato dos telefones nos Contactos do Zoho (a pesquisa tenta `+351…` e o número nacional) e se a empresa usa Contacts ou Leads.
- API names reais do módulo "Análise Técnica" e opções exatas das picklists.
