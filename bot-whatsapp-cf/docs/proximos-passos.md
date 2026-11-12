# Próximos passos

Ordem recomendada. Cada tarefa deve terminar com `npm run verificar` e um teste no simulador. Marcar `[x]` quando estiver feita.

## Fase A: pôr o piloto a funcionar com APIs reais

- [ ] **A1. Primeira chamada real ao Claude.** Com `ANTHROPIC_API_KEY` em `.dev.vars`, correr o simulador e fazer uma conversa completa. Confirmar que os esquemas das ferramentas são aceites, que o cache do prompt funciona (`usage.cache_read_input_tokens` > 0 a partir da 2.ª chamada; acrescentar esse valor ao log) e que as fotos são lidas. Corrigir o que falhar.
- [x] **A2. Testes automáticos de `ficha.ts`.** Configurar Vitest (com `@cloudflare/vitest-pool-workers`, se for útil para testar também o Durable Object) e cobrir `validar`, `camposEmFalta` e `verificarCoerencia`. Incluir o caso de referência: quadro no piso 5, carro no piso -1 e 6 m declarados têm de gerar alerta.
- [x] **A3. Bateria de conversas de regressão.** Criar `casos/*.json`: cada caso tem uma sequência de mensagens (texto e fotos de `fotos/`) e expectativas sobre o estado final (campos preenchidos, alertas, estado). Criar `scripts/correr-casos.mjs`, que faz `/dev/reset`, envia as mensagens pelo `/dev/mensagem` e compara com `/dev/ficha`. As respostas do modelo variam, por isso as expectativas são sobre a ficha, não sobre o texto.
- [x] **A4. Ambiente de staging.** Criar um ambiente `staging` no `wrangler.jsonc` (Worker separado, bucket R2 separado). Proteger as rotas `/dev/*` com um segredo `DEV_TOKEN` (cabeçalho), para poderem existir num Worker publicado. Opcional: uma página `/dev` com um simulador web simples (texto e upload de foto), também protegida.
- [ ] **A5. WhatsApp real.** Publicar o staging com `MODO_DEV=false` (ou separar "rotas de teste ativas" de "não enviar WhatsApp" em duas variáveis), ligar o número de teste da Meta ao webhook e testar com um telemóvel. (A separação já existe: `ENVIAR_WHATSAPP_EM_DEV="true"` em `env.staging.vars`.)
- [ ] **A5b. Fotos grandes no WhatsApp.** As fotos normais chegam comprimidas pela Meta, mas uma imagem enviada como *documento* chega no tamanho original e, acima de ~3,7 MB, é ignorada (`MAX_BYTES_IMAGEM` em `agente.ts`). Confirmar no teste com telemóvel e, se acontecer, redimensionar no Worker (Cloudflare Images) ou pedir ao cliente para a reenviar como foto. O banco de testes (`/dev`) já reduz as fotos no browser antes de enviar.
- [ ] **A5c. Vídeos do WhatsApp.** O bot já analisa vídeos como sequência de fotogramas (tipo `video`, fotogramas no R2 debaixo do prefixo em `media_chave`, MIME `video/fotogramas`), mas hoje só o banco de testes os produz, no browser. Para o WhatsApp: tratar `type: "video"` em `whatsapp.ts`, descarregar o MP4 e extrair até 12 fotogramas no servidor. Um Worker não corre ffmpeg; opções: Cloudflare Media Transformations (modo `frame`, a partir de um URL do vídeo), Cloudflare Containers com ffmpeg, ou um serviço externo. Depois, o prompt pode sugerir ao cliente um vídeo curto do caminho do cabo.
- [ ] **A6. Zoho sandbox.** Ligar à sandbox, confirmar a criação de contacto, registo e anexos, e ajustar `zoho-mapa.ts` aos API names reais.

## Fase B: dados e campos (depende do utilizador)

- [ ] **B1. Redesenhar a ficha.** O utilizador vai fornecer os campos atuais do módulo "Análise Técnica". Propor a nova ficha (campos a manter, criar e retirar), e depois atualizar `ficha.ts`, `zoho-mapa.ts` e o prompt. Respeitar os limites do strict tool use.
- [ ] **B2. Textos finais.** Preencher `[EMPRESA]` e `[LINK_PRIVACIDADE]` em `src/prompts.ts`.

## Fase C: antes de abrir a clientes reais

- [ ] **C1. Resposta humana.** Definir com o utilizador como a equipa responde às conversas em estado "humano" (caixa de entrada de um fornecedor de WhatsApp, integração no Zoho, ou rota protegida no Worker) e implementar.
- [ ] **C2. Templates da Meta.** Lembrete de informação em falta, enviado por alarm se o cliente não responder em X horas, e retoma de conversa fora da janela de 24 horas.
- [ ] **C3. RGPD.** Regra de ciclo de vida no R2 para apagar ficheiros ao fim de N dias. Alarm no Durable Object que apaga a conversa N dias depois de concluída. Reduzir dados pessoais nos logs.
- [ ] **C4. Limites de abuso.** Máximo de mensagens por cliente e por dia. Acima disso, passar a humano e parar de chamar o modelo.
- [ ] **C5. Monitorização.** Alertas quando há erros repetidos (falhas do Claude, do Zoho ou do envio WhatsApp).

## Perguntas em aberto para o utilizador

- Campos atuais do módulo "Análise Técnica" e opções das picklists.
- Contacts ou Leads no Zoho.
- Canal para a equipa responder às conversas passadas a humano.
- Prazo de retenção de fotos e conversas.
- Nome da empresa e link da política de privacidade.
