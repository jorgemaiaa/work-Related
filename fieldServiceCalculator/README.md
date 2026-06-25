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

A Agenda chama `/api/schedules` (Pages Function + KV). A rota está protegida por **Cloudflare Access** — quem não estiver autorizado nunca chega ao backend. Se o backend não responder (deploy ainda não feito, sem rede), a tab cai num modo *local* que guarda em `localStorage` (chave `schedules.v1.cache`) só para experimentar; os dados ficam só no browser.

---

## Estrutura do repositório

```
fieldServiceCalculator/
├── index.html
├── README.md
└── functions/
    └── api/
        ├── schedules.js          # GET + POST  /api/schedules
        └── schedules/
            └── [id].js           # PATCH + DELETE /api/schedules/:id
```

---

## Deploy — Cloudflare Pages + KV + Access

Setup único, ~10 minutos no painel do Cloudflare.

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
4. Re-deploy para o binding ficar ativo.

### 3. Proteger `/agenda*` e `/api/*` com Access

1. **Zero Trust** (no menu lateral, em baixo) → primeira vez pede para criar uma equipa (escolhe um nome qualquer).
2. **Access** → **Applications** → **Add an application** → **Self-hosted**.
3. Application configuration:
   - Application name: `Agenda — work-Related`
   - Session duration: **7 days**
   - Application domain: `https://<projeto>.pages.dev`
   - Path: deixar vazio para proteger tudo, OU adicionar duas aplicações separadas:
     - app A — path `/api/*`
     - app B — path `/agenda` *(opcional — o frontend já está dentro da mesma página, então o gate da API basta)*
4. **Identity providers**: ativar **One-time PIN** (envia código por email) ou **Login with Google**. PIN é o magic-link clássico, sem registar nada.
5. **Policies**:
   - Policy name: `Empresa`
   - Action: **Allow**
   - Include: **Emails ending in** → `@gocharge.pt`
6. **App session timer**: 7 dias. **Global session timer** (do Zero Trust → Settings → Authentication): 30 dias.
7. Save.

A partir daqui, qualquer pedido a `/api/*` é interceptado por Access. Se passar, a Function recebe o header `Cf-Access-Authenticated-User-Email` e responde. Se não, o utilizador vê o ecrã de login do Cloudflare.

### 4. (Opcional) Domínio próprio

Em **Pages → Custom domains** podes ligar `agenda.teudominio.com`. Lembra-te de re-apontar a app no Access para o novo domínio.

### 5. Desligar o GitHub Pages

Quando confirmares que o Cloudflare está OK: **GitHub → repo → Settings → Pages → Source: None**. O URL antigo deixa de servir.

---

## Desenvolvimento local

Não há build step. Para a calculadora basta servir os ficheiros:

```bash
cd fieldServiceCalculator
python3 -m http.server 8000
# abrir http://localhost:8000
```

A tab Agenda cairá no modo *local* (sem backend) — útil para testar UI mas os dados não persistem para lá deste browser.

Para testar as Functions localmente, usa `wrangler pages dev`:

```bash
npx wrangler pages dev fieldServiceCalculator --kv SCHEDULES_KV
```

Por defeito o `Cf-Access-Authenticated-User-Email` não estará presente em dev, e a Function devolverá 401. Para experimentar, podes manualmente adicionar o header com um proxy ou comentar temporariamente o `if (!getEmail(...))`. Não fazer commit dessa alteração.

---

## Notas de segurança

- O backend confia no header `Cf-Access-Authenticated-User-Email`. Isto é seguro **enquanto** Access estiver realmente a proteger a rota `/api/*` no edge. Se removeres a Access policy, a API fica pública (responde 401 sempre, porque o header desaparece — fail-closed).
- Para mais defesa em profundidade, valida o JWT em `Cf-Access-Jwt-Assertion` contra a chave pública pública da tua equipa. Hoje a app não faz isso — adicionar se a sensibilidade dos dados aumentar.
- Não há *rate limiting* no backend. Cloudflare aplica limites genéricos; para limites a sério, adicionar regra em **Security → WAF → Rate limiting rules**.

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
