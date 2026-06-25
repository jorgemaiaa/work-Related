# Field Service Calculator

Calculadora web de custos de deslocação para instaladores em Portugal continental.
Aplicação single-file (HTML + Leaflet + OSRM + Nominatim), sem backend.

URL público (GitHub Pages):
`https://jorgemaiaa.github.io/work-Related/fieldServiceCalculator/`

## Como funciona

- **Mapa**: Leaflet sobre tiles do OpenStreetMap, limitado a Portugal continental.
- **Local do trabalho**: clica no mapa, ou procura uma morada (Nominatim,
  restrito a PT).
- **Rotas**: para cada instalador, faz pedido OSRM origem → trabalho e
  duplica a distância/duração para representar a ida e volta.
- **Preço**:
  - `custo = km_ida_e_volta × €/km` se a ida e volta exceder **100 km**;
  - caso contrário, **grátis**.
- **Melhor opção** é destacada na barra lateral e no mapa.

## Instaladores

Editor lateral permite:

- Editar / apagar instaladores existentes
- Adicionar novos (nome, etiqueta de origem, €/km, cor, lat/lng manuais
  ou via "📍 Escolher local no mapa")
- **Reset** restaura os predefinidos:
  - EV Chargers — Almada — 2 €/km
  - Q-CM Norte — Grijó — 0,40 €/km
  - Q-CM Sul — Lisboa — 0,40 €/km

Estado persistido em `localStorage` na chave `technicians.v1`.

## Limitações

- OSRM e Nominatim são serviços públicos partilhados — adequado para uso
  pessoal/equipa, não para produção. Substituir por Mapbox/HERE/Google/Geoapify
  ou OSRM self-hosted para SLA.
- Tudo client-side, sem autenticação. Qualquer pessoa com o URL pode usar.
- O cálculo de ida e volta assume que o técnico regressa à origem após
  o mesmo trabalho (sem multi-stop).
- Apenas Portugal continental (bounds excluem Madeira e Açores).
  Ajustar `PT_BOUNDS` em `index.html` se precisar de incluir as ilhas.

## Constantes principais (`index.html`)

| Constante              | Função                                    |
| ---------------------- | ----------------------------------------- |
| `DEFAULT_TECHNICIANS`  | Lista de instaladores predefinidos        |
| `STORAGE_KEY`          | Chave do `localStorage` (`technicians.v1`)|
| `PT_BOUNDS`            | Limites geográficos do mapa               |
| `FREE_KM`              | Limite (km) abaixo do qual a viagem é grátis (100) |

> Não renomeies `STORAGE_KEY` sem migração — instaladores guardados pelos
> utilizadores serão perdidos.

## Desenvolvimento

Não há build step. Para testar localmente:

```bash
cd fieldServiceCalculator
python3 -m http.server 8000
# abrir http://localhost:8000
```

## Deploy

GitHub Pages: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
A app fica acessível em `/work-Related/fieldServiceCalculator/`.
