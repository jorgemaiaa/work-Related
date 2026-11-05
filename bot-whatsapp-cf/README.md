# Bot de análise técnica: WhatsApp → Claude → Zoho CRM (Cloudflare Workers)

Conversa com clientes no WhatsApp, recolhe a informação técnica para a instalação de um carregador (dados, fotos, faturas em PDF) e grava tudo no módulo "Análise Técnica" do Zoho CRM. A proposta é gerada depois por workflow no Zoho.

## Arquitetura

```
Meta (webhook) ──► Worker ──► Durable Object "Conversa" (um por número de telefone)
                                 ├─ SQLite próprio: mensagens, ficha, estado
                                 ├─ alarm: espera alguns segundos por mais mensagens
                                 ├─ Claude (API) com 4 ferramentas
                                 ├─ R2: fotos e PDFs
                                 └─ Zoho CRM ◄── token partilhado no Durable Object "ZohoAuth"
```

1. O Worker valida a assinatura da Meta e entrega cada mensagem ao Durable Object daquele cliente. Responde logo 200.
2. O Durable Object guarda a mensagem (ignorando repetidas) e marca um *alarm* para daqui a `DEBOUNCE_MS`. Cada mensagem nova adia o alarm, por isso o bot só responde quando o cliente pára de escrever.
3. No alarm, o Durable Object descarrega as fotos para o R2, chama o Claude com o estado da ficha e as mensagens novas, executa as ferramentas, responde no WhatsApp e sincroniza com o Zoho.
4. Se o processamento falhar, a Cloudflare repete o alarm automaticamente. Ao fim de várias falhas, a conversa passa para a equipa e o cliente é avisado.
5. Se o Zoho falhar, o Durable Object agenda nova tentativa 5 minutos depois.

Cada conversa vive isolada no seu Durable Object. Nenhuma ferramenta do modelo aceita IDs de clientes ou do Zoho, por isso o modelo não consegue ler nem alterar dados de outra pessoa.

## Ficheiros

| Ficheiro | Função |
|---|---|
| `src/index.ts` | Worker: webhook da Meta, saúde e rotas do simulador |
| `src/conversa.ts` | Durable Object de cada cliente: guardar, esperar, processar, sincronizar |
| `src/agente.ts` | Ferramentas do Claude, montagem do pedido, ciclo de tool use |
| `src/ficha.ts` | **Campos a recolher, validação e regras de coerência** (o sítio a editar mais vezes) |
| `src/prompts.ts` | Prompt de sistema e mensagens fixas |
| `src/zoho-mapa.ts` | **Mapeamento ficha → API names do Zoho** (preencher com os nomes reais) |
| `src/zoho.ts` | Cliente da API do Zoho CRM v8 |
| `src/zoho-auth.ts` | Durable Object que guarda e renova o token do Zoho |
| `src/whatsapp.ts` | Assinatura, leitura do webhook, envio e descarga de media |
| `src/tipos.ts` | Tipos e variáveis de ambiente |
| `scripts/simulador.mjs` | Conversar com o bot no terminal, sem WhatsApp |
| `.devcontainer/` e `scripts/preparar-codespace.sh` | Configuração automática do GitHub Codespaces (inclui instalar o Claude Code) |
| `CLAUDE.md` e `docs/proximos-passos.md` | Contexto e tarefas para o Claude Code |
| `wrangler.jsonc` | Configuração da Cloudflare (bindings, variáveis) |

## 0. Trabalhar no GitHub Codespaces (sem instalar nada no PC)

O Codespaces é um ambiente de desenvolvimento na nuvem, aberto no browser. A pasta `.devcontainer` configura-o automaticamente: Node.js 22, `npm install`, criação do `.dev.vars` e da pasta `fotos/`.

**Secrets do Codespaces** (GitHub > Settings > Codespaces > Secrets, com acesso a este repositório):

| Secret | Para quê |
|---|---|
| `BOT_ANTHROPIC_API_KEY` | Chave usada pelo bot no simulador e no Worker local. Tem outro nome para o Claude Code não a usar em vez da vossa subscrição |
| `CLOUDFLARE_API_TOKEN` | Publicar e gerir o Worker sem `wrangler login`. Criar em Cloudflare > My Profile > API Tokens com o modelo "Edit Cloudflare Workers" (confirmar que inclui R2 com permissão de edição) |
| `CLOUDFLARE_ACCOUNT_ID` | Identifica a conta Cloudflare |

Os secrets só chegam a um Codespace que arranque depois de serem criados. Se os acrescentar mais tarde, reinicie o Codespace e corra `rm .dev.vars && bash scripts/preparar-codespace.sh`.

**No Codespace:**

- Terminal 1: `npm run dev`. Terminal 2: `npm run simular`. Para abrir um segundo terminal, use o "+" no painel do terminal.
- Para testar com fotos, arraste-as para a pasta `fotos/` no explorador de ficheiros e use `/foto fotos/quadro.jpg`.
- A porta 8787 fica privada (só a sua conta GitHub lhe acede). Não a torne pública.
- Faça commit e push com frequência. Apagar um Codespace apaga as alterações que não foram enviadas para o GitHub.
- O Codespace para sozinho ao fim de algum tempo sem uso. Pode pará-lo também em github.com/codespaces, para poupar as horas gratuitas mensais.

## 1. Desenvolvimento local com o simulador

Precisa de Node.js 20 ou superior e de uma chave da API da Anthropic. Não precisa de conta Meta nem Zoho.

```bash
npm install
cp .dev.vars.example .dev.vars     # preencher ANTHROPIC_API_KEY
npm run dev                        # terminal 1: Worker local em http://localhost:8787
npm run simular                    # terminal 2: conversa no terminal
```

No simulador:

- `/foto caminho.jpg legenda` envia uma foto (ou um `.pdf`).
- `+ texto` acumula mensagens sem resposta.
- `/ficha` mostra o estado.
- `/reset` recomeça a conversa.

Com `MODO_DEV=true` as respostas aparecem no terminal e nada é enviado para o WhatsApp. O R2 e os Durable Objects são simulados localmente.

`npm run verificar` confirma os tipos do TypeScript.

## 2. Publicar na Cloudflare

No Codespaces, com os secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` definidos, o `wrangler login` não é necessário. Fora do Codespaces, comece por `npx wrangler login`.

```bash
npx wrangler r2 bucket create bot-anexos --jurisdiction eu
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put WA_VERIFY_TOKEN       # texto longo e aleatório à vossa escolha
npx wrangler secret put WA_APP_SECRET
npx wrangler secret put WA_ACCESS_TOKEN
npx wrangler secret put WA_PHONE_NUMBER_ID
npx wrangler secret put ZOHO_CLIENT_ID
npx wrangler secret put ZOHO_CLIENT_SECRET
npx wrangler secret put ZOHO_REFRESH_TOKEN
npm run deploy
```

O Worker fica em `https://bot-analise-tecnica.<subdomínio>.workers.dev`. Podem associar um domínio vosso no painel da Cloudflare.

**Jurisdição.** Decidam `JURISDICAO` antes do primeiro deploy e não a mudem depois. Com `"eu"`, os Durable Objects (conversas e fichas) e o bucket R2 ficam guardados na UE. Mudar mais tarde cria Durable Objects novos e as conversas existentes deixam de ser encontradas.

**Plano.** Confirmem na página de preços da Cloudflare se o plano gratuito dos Workers chega para o piloto ou se compensa o plano pago, que tem limites mais altos.

## 3. WhatsApp (Meta)

1. Em developers.facebook.com, criar uma app do tipo Business e adicionar o produto WhatsApp. A Meta fornece um número de teste.
2. Em Business Settings, criar um System User com acesso à app e gerar um token permanente com `whatsapp_business_messaging` e `whatsapp_business_management` → `WA_ACCESS_TOKEN`.
3. Copiar o Phone number ID → `WA_PHONE_NUMBER_ID` e o App secret (Definições > Básico) → `WA_APP_SECRET`.
4. Configurar o webhook com o URL `https://<worker>/webhook` e o verify token igual a `WA_VERIFY_TOKEN`, e subscrever o campo `messages`.
5. Confirmar em `WA_GRAPH_VERSION` (wrangler.jsonc) a versão da Graph API em vigor.

## 4. Zoho CRM

1. Em api-console.zoho.eu, criar um **Self Client** → `ZOHO_CLIENT_ID` e `ZOHO_CLIENT_SECRET`.
2. Em "Generate Code", gerar um código com os scopes
   `ZohoCRM.modules.contacts.ALL,ZohoCRM.modules.custom.ALL,ZohoCRM.modules.attachments.ALL`.
3. Trocar o código por um refresh token (uma única vez, antes de o código expirar):
   ```bash
   curl -X POST "https://accounts.zoho.eu/oauth/v2/token" \
     -d grant_type=authorization_code -d client_id=... -d client_secret=... -d code=...
   ```
   Guardar o `refresh_token` com `npx wrangler secret put ZOHO_REFRESH_TOKEN`.
4. Preencher `ZOHO_MODULE` (wrangler.jsonc) e `src/zoho-mapa.ts` com os API names reais. As opções das picklists têm de coincidir exatamente, incluindo acentos.
5. Testar primeiro numa sandbox do Zoho: em `.dev.vars`, `ZOHO_ENABLED=true` e os URLs da sandbox.

Se a vossa empresa trabalha com Leads em vez de Contacts, alterar `procurarContacto` e `criarContacto` em `src/zoho.ts`.

## 5. Operação

- **Logs:** `npm run logs` mostra os eventos em tempo real. Também estão no painel (Workers Logs). Cada chamada de ferramenta fica registada com os dados do cliente, por isso definam um prazo de retenção curto.
- **Ficheiros e RGPD:** configurar uma regra de ciclo de vida no bucket R2 para apagar fotos e PDFs ao fim de X dias.
- **`MODO_DEV`** fica sempre `"false"` em produção. Com `"true"`, as rotas `/dev/*` ficam abertas e nada é enviado para o WhatsApp.
- **Imagens:** são enviadas ao Claude sem redimensionar. O WhatsApp já comprime as fotos, e imagens acima de ~3,7 MB são ignoradas com aviso ao modelo.

## Falta fazer antes de lançar

- **Resposta humana.** Quando uma conversa passa a "humano", o bot cala-se. A equipa precisa de uma forma de responder: a caixa de entrada de um fornecedor de WhatsApp, uma integração WhatsApp no Zoho, ou uma rota protegida no Worker que use `WhatsApp.enviarTexto`.
- **Mensagens fora das 24 horas.** Lembretes exigem templates aprovados pela Meta. Ainda não estão implementados.
- **RGPD.** Prazo de retenção das conversas nos Durable Objects. Link da política de privacidade em `src/prompts.ts`.
- **Limites de abuso.** Limitar o número de mensagens por cliente e por dia.
- **Bateria de testes.** Guardar casos antigos como guiões do simulador e corrê-los sempre que o prompt ou as regras mudarem.
