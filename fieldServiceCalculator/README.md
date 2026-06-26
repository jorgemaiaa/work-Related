# Field Service Calculator + Agenda

App web single-page com dois separadores:

1. **Calculadora** — custo de deslocação de instaladores em Portugal continental (pública).
2. **Agenda** — calendário mensal de agendamentos (instalação / visita técnica / pós-venda), protegida por Cloudflare Access.

Stack: HTML + Leaflet + OSRM + Nominatim no frontend; Cloudflare Pages + Pages Functions + KV no backend; Cloudflare Access para autenticação.

---

## Calculadora

- **Mapa**: Leaflet sobre tiles do OpenStreetMap.
- **Local do trabalho**: clica no mapa, ou procura uma morada (Nominatim, restrito a PT).
- **Rotas**: para cada instalador, faz pedido OSRM origem → trabalho e duplica a distância/duração (ida e volta).
- **Preço**: `custo = km × €/km` se a ida e volta exceder **100 km**; caso contrário, **grátis**.
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

A Agenda chama `/api/schedules` (Pages Function + KV). Toda a rota `/api/*` está protegida por uma **palavra-passe partilhada** (middleware em `functions/api/_middleware.js`) — o público em geral nunca chega ao backend. A sessão dura **30 dias**.

Se o backend não responder (deploy ainda não feito, sem rede), a tab cai num modo *local* que guarda em `localStorage` (chave `schedules.v1.cache`) só para experimentar; os dados ficam só no browser.

---

## Estrutura do repositório

```
fieldServiceCalculator/
├── index.html
├── README.md
└── functions/
    └── api/
        ├── _middleware.js        # auth gate (cookie + HMAC)
        ├── auth.js               # POST /api/auth (login) + DELETE (logout)
        ├── schedules.js          # GET + POST  /api/schedules
        └── schedules/
            └── [id].js           # PATCH + DELETE /api/schedules/:id
```

---

## Deploy — Cloudflare Pages + KV + palavra-passe partilhada

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

### 3. Definir a palavra-passe e o segredo de sessão

No projeto Pages → **Settings → Environment variables** (ou **Variables and Secrets**) → adiciona **duas** variáveis para o ambiente **Production** (e Preview, se usares):

| Variável            | Tipo            | Valor                                                   |
| ------------------- | --------------- | ------------------------------------------------------- |
| `AGENDA_PASSWORD`   | **Encrypt** ✓   | Palavra-passe que vais partilhar com a equipa.          |
| `SESSION_SECRET`    | **Encrypt** ✓   | String aleatória longa (≥ 32 chars). Usa um gerador.    |

Gera um `SESSION_SECRET` no terminal:

```bash
openssl rand -base64 48
```

Se mudares o `SESSION_SECRET`, todas as sessões existentes ficam inválidas (toda a gente tem de voltar a entrar). Útil em caso de fuga.

### 4. Re-deploy

Depois de definir as variáveis: projeto Pages → **Deployments** → **Retry deployment** (ou faz um novo push). Bindings e env vars só ficam ativos no próximo deploy.

### 5. Como funciona

- A **Calculadora** é pública.
- Quando se abre a tab **Agenda**, o browser faz `GET /api/schedules`. A *middleware* (`functions/api/_middleware.js`) verifica o cookie de sessão. Se não houver, devolve `401`.
- A UI abre um modal a pedir a palavra-passe → `POST /api/auth` → o servidor compara (constant-time) com `AGENDA_PASSWORD`. Em caso de sucesso, devolve um cookie HMAC-assinado válido por **30 dias** (`HttpOnly`, `Secure`, `SameSite=Lax`).
- Pedidos seguintes a `/api/*` passam o cookie e a middleware deixa-os passar.
- Botão **Sair** no topo apaga o cookie e força nova autenticação.
- Tentativas falhadas: máx. **5 por minuto por IP** (rate limit guardado em KV).

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
  --binding AGENDA_PASSWORD=devpwd \
  --binding SESSION_SECRET=dev-secret-change-me-please
```

---

## Notas de segurança

- **`SESSION_SECRET` é o que protege os cookies.** Tem de ser longo e aleatório. Se vazar, qualquer pessoa pode forjar cookies de sessão até o rodares.
- **`AGENDA_PASSWORD` é partilhada por toda a equipa.** Quando alguém sai, muda-a — todas as sessões existentes continuam válidas até expirarem (30 dias), excepto se também rodares `SESSION_SECRET` (o que invalida tudo imediatamente).
- O cookie é `HttpOnly` + `Secure` + `SameSite=Lax`, ou seja: não acessível por JS no browser e só viaja em HTTPS.
- Rate limit: 5 tentativas falhadas / minuto / IP. Mitiga força-bruta superficial; um atacante distribuído passa por cima. Se for relevante, adicionar **Security → WAF → Rate limiting rules** com limites mais agressivos.
- Sem auditoria por utilizador (é uma palavra-passe partilhada — não há "quem"). Os campos `createdAt` / `updatedAt` ficam, mas `createdBy` foi removido.

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
