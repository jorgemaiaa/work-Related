#!/usr/bin/env bash
# Corre automaticamente quando o Codespace é criado. Pode ser repetido à mão:
#   rm .dev.vars && bash scripts/preparar-codespace.sh
set -e
npm install

# A chave do bot chama-se BOT_ANTHROPIC_API_KEY para não ser confundida com a do
# Claude Code: se existir ANTHROPIC_API_KEY no ambiente, o Claude Code pode usá-la
# em vez da vossa subscrição.
CHAVE="${BOT_ANTHROPIC_API_KEY:-}"
if [ -z "$CHAVE" ] && [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Aviso: renomeie o secret ANTHROPIC_API_KEY para BOT_ANTHROPIC_API_KEY."
  CHAVE="$ANTHROPIC_API_KEY"
fi

# .dev.vars não vai para o Git: é criado aqui a partir do exemplo e dos secrets
if [ ! -f .dev.vars ]; then
  cp .dev.vars.example .dev.vars
  if [ -n "$CHAVE" ]; then
    sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$CHAVE|" .dev.vars
  else
    echo "Aviso: o secret BOT_ANTHROPIC_API_KEY não está definido; preencha-o em .dev.vars."
  fi
fi

# DEV_TOKEN para abrir o banco de testes (/dev) no browser pelo endereço reencaminhado do
# Codespace. Também é acrescentado a um .dev.vars antigo que ainda não o tenha.
if ! grep -q '^DEV_TOKEN=.\+' .dev.vars; then
  TOKEN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
  sed -i '/^DEV_TOKEN=/d' .dev.vars
  echo "DEV_TOKEN=$TOKEN" >> .dev.vars
fi

mkdir -p fotos   # fotos de teste (não vão para o Git)

# Claude Code (instalador oficial)
if ! command -v claude >/dev/null 2>&1; then
  curl -fsSL https://claude.ai/install.sh | bash || echo "Aviso: não foi possível instalar o Claude Code."
  grep -q '.local/bin' ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
fi

echo ""
echo "Pronto. Terminal 1: npm run dev   |   Terminal 2: npm run simular   |   Claude Code: claude"
echo "Banco de testes no browser: separador PORTS > porta 8787 > abrir e acrescentar /dev ao endereço."
echo "O DEV_TOKEN a colar na página está em .dev.vars (grep DEV_TOKEN .dev.vars)."
