# Field Service Calculator + Agenda

App web single-page com dois separadores:

1. **Calculadora** — custo de deslocação de instaladores em Portugal continental.
2. **Agenda** — calendário mensal de agendamentos (instalação / visita técnica / pós-venda).
3. **Custos** — tabela de preços por instalador e construtor de orçamentos.

A aplicação só abre dentro do Zoho CRM (Web Tab). Abrir o URL diretamente mostra "Acesso restrito". Não há palavra-passe.

Stack: HTML + Leaflet + OSRM + Nominatim no frontend; Cloudflare Pages + Pages Functions + KV no backend; gate de auth feito por uma *middleware* (cookie HMAC-assinado).

---

## Calculadora

- **Mapa**: Leaflet sobre tiles do OpenStreetMap.
- **Local do trabalho**: clica no mapa, ou procura uma morada (Nominatim, restrito a PT).
- **Rotas**: para cada instalador, faz pedido OSRM origem → trabalho e duplica a distância/duração (ida e volta).
- **Preço**: até **100 km** ida e volta é **grátis**. Acima disso, cobra-se apenas o excedente: `custo = (km − 100) × €/km`. Ex.: 120 km de ida e volta → 20 km cobráveis × €/km.
- **Resultados** ordenados do mais barato para o mais caro; melhor opção destacada no mapa e na sidebar.

### Editor de instaladores (browser)

- Editar / apagar / adicionar instaladores
- **Reset** restaura os predefinidos:
  - EV Chargers — Almada — 2 €/km (verde)
  - Q-CM Norte — Grijó — 0,40 €/km (azul-escuro)
  - Q-CM Sul — Lisboa — 0,40 €/km (azul-escuro)
  - E-Mob — Porto — 0,40 €/km (azul-claro)

Estado persistido em `localStorage`, chave `technicians.v1` — **por browser**, não partilhado.

---

## Agenda

Vista mensal; clica num dia para abrir o painel com os agendamentos desse dia e adicionar novos.

### Cada agendamento tem

| Campo | Descrição |
| --- | --- |
| `type` | `instalacao` / `visita` / `pos_venda` |
| `installerId` | id de um instalador (default ou criado) |
| `reference` | texto livre |
| `datetime` | data e hora local (`YYYY-MM-DDTHH:MM`) |
| `link` | URL opcional, clicável |

### Cores

Família por instalador, sombra por tipo:

| Família | Instaladores | Instalação | Visita técnica | Pós-venda |
| --- | --- | --- | --- | --- |
| Azul (Q-CM) | Q-CM Norte, Q-CM Sul | `#1e3a8a` | `#3b82f6` | `#bfdbfe` |
| Verde (EV) | EV Chargers | `#14532d` | `#16a34a` | `#bbf7d0` |
| Amarelo (E-Mob) | E-Mob | `#a16207` | `#eab308` | `#fde68a` |

Instaladores fora destas famílias (adicionados manualmente) usam a sua `color` sem variação por tipo.

### Privacidade

A regra "só dentro do Zoho" é aplicada pela middleware em `functions/_middleware.js` (ver **Notas de segurança**). Não há palavra-passe.

Se a Agenda for usada fora do backend (deploy ainda não feito, sem rede), cai num modo *local* que guarda em `localStorage` (chave `schedules.v1.cache`) só para experimentar; os dados ficam só no browser.

---

## Custos

- **Tabela de preços**: um preço por produto e por instalador (pack base mono/trifásico, metro de cabo mono/trifásico, quadro elétrico, visita técnica, fixação & configuração). Guardada em KV (chave `prices`), partilhada por toda a equipa.
- **Orçamento**: escolhe o instalador, o local e as quantidades. A deslocação vem da Calculadora (mesma regra de km grátis + €/km) — o local é partilhado entre as duas tabs.
- **Copiar resumo** copia o orçamento em texto para colar num email/mensagem.

---

## Estrutura do repositório

```
fieldServiceCalculator/
├── index.html
├── README.md
└── functions/
    ├── _middleware.js            # Zoho-only access rule for the whole site
    └── api/
        ├── prices.js             # GET + PUT   /api/prices
        ├── schedules.js          # GET + POST  /api/schedules
        └── schedules/
            └── [id].js           # PATCH + DELETE /api/schedules/:id
```

---

## Deploy — Cloudflare Pages + KV

Setup único, ~10 minutos no painel do Cloudflare. Não precisa de domínio próprio nem de Cloudflare Access.

### 1. Ligar o repositório a Pages

1. Painel Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Autoriza o GitHub e escolhe `jorgemaiaa/work-Related`.
3. Branch: `main`.
4. **Build settings**:
   - Framework preset: *None*
   - Build command: *(deixar vazio)*
   - Build output directory: `fieldServiceCalculator`
   - Root directory (Advanced): `fieldServiceCalculator`
5. Save & Deploy. O site fica em `https://<projeto>.pages.dev`.

### 2. Criar o namespace KV e ligar ao projeto

1. **Workers & Pages** → **KV** → **Create namespace**. Nome: `schedules` (ou outro). Anota o ID.
2. Volta ao projeto Pages → **Settings** → **Functions** → **KV namespace bindings** → **Add binding**.
   - Variable name: `SCHEDULES_KV` *(tem de ser exatamente este — é o nome usado nas Functions)*.
   - KV namespace: escolhe o que acabaste de criar.
3. Aplica também ao ambiente **Preview** se quiseres testar branches.

### 3. Variáveis de ambiente (opcionais)

No projeto Pages → **Settings → Variables and Secrets** → ambiente **Production**:

| Variável              | Valor |
| --------------------- | ----- |
| `ALLOW_DIRECT_ACCESS` | `true` desliga a regra "só dentro do Zoho" — a app abre em qualquer browser, **sem proteção nenhuma**. Útil só para testes/emergências. |
| `FRAME_ANCESTORS`     | Domínios autorizados a embeber a app. Por defeito `https://*.zoho.eu https://*.zoho.com`. |

As variáveis antigas `AGENDA_PASSWORD` e `SESSION_SECRET` já não são usadas e podem ser apagadas.

### 4. Re-deploy

Depois de mudar variáveis ou bindings: projeto Pages → **Deployments** → **Retry deployment** (ou faz um novo push). Só ficam ativos no próximo deploy.

### 5. Como funciona

- Cada pedido passa pela middleware. Abrir o URL diretamente (navegação de topo, `Sec-Fetch-Dest: document`) → página "Acesso restrito".
- Dentro de uma iframe (Zoho Web Tab) a app carrega normalmente, e os pedidos da própria app a `/api/*` passam.
- O cabeçalho `Content-Security-Policy: frame-ancestors …` faz o browser recusar mostrar a app dentro de qualquer site que não seja Zoho.

### 6. (Opcional) Domínio próprio

Em **Pages → Custom domains** podes ligar `agenda.teudominio.com` quando tiveres um domínio na tua conta Cloudflare.

### 7. Desligar o GitHub Pages

Quando confirmares que o Cloudflare está OK: **GitHub → repo → Settings → Pages → Source: None**. O URL antigo deixa de servir.

---

## Desenvolvimento local

Não há build step. Para a calculadora basta servir os ficheiros:

```bash
cd fieldServiceCalculator
python3 -m http.server 8000
# abrir http://localhost:8000
```

A tab Agenda cairá no modo *local* (sem backend) — útil para testar UI mas os dados ficam só neste browser.

Para testar as Functions localmente, usa `wrangler pages dev`:

```bash
npx wrangler pages dev fieldServiceCalculator \
  --kv SCHEDULES_KV \
  --binding ALLOW_DIRECT_ACCESS=true
```

---

## Notas de segurança

- **Não há autenticação.** A regra "só dentro do Zoho" assenta em cabeçalhos que os browsers enviam (`Sec-Fetch-*`) e no CSP `frame-ancestors`. Impede o acesso normal fora do Zoho, mas um script/ferramenta (ex.: `curl`) pode falsificar esses cabeçalhos e ler/escrever os dados da API se souber o URL.
- A Agenda guarda nomes de clientes e referências (dados pessoais). Se isso passar a ser sensível, voltar a pôr autenticação (palavra-passe ou login Zoho via OAuth).
- Sem auditoria por utilizador. Os campos `createdAt` / `updatedAt` ficam.

---

## Constantes principais (`index.html`)

| Constante              | Função                                                |
| ---------------------- | ----------------------------------------------------- |
| `DEFAULT_TECHNICIANS`  | Lista de instaladores predefinidos                    |
| `STORAGE_KEY`          | Chave do `localStorage` para instaladores             |
| `SCHEDULES_CACHE_KEY`  | Chave do `localStorage` para agenda em modo offline   |
| `PT_BOUNDS`            | Vista inicial do mapa (Portugal continental)          |
| `FREE_KM`              | Limite abaixo do qual a viagem é grátis (100 km)      |
| `FAMILY_SHADES`        | Paleta de cores por família × tipo                    |
| `INSTALLER_FAMILY`     | Mapa instalador → família (cor)                       |

> Não renomear `STORAGE_KEY` nem `SCHEDULES_CACHE_KEY` sem migração — dados guardados nos browsers seriam perdidos.
