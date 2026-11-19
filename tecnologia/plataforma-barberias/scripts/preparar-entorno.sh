#!/usr/bin/env bash
# Funcionalidad 009 (US3; research R03): genera el .env de DESARROLLO desde .env.example.
# Uso, desde tecnologia/plataforma-barberias/:  ./scripts/preparar-entorno.sh [--subred a.b.c]
# Usa el Node del equipo (22 o mayor) si existe; si no, la imagen node:22 de Docker (la misma de Compose).
# Nunca escribe en un .env que ya exista: solo informa los NOMBRES de las variables que le faltan.
set -euo pipefail

cd "$(dirname "$0")/.."

if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then
  exec node scripts/preparar-entorno.mjs "$@"
fi

if command -v docker >/dev/null 2>&1; then
  exec docker run --rm -v "$PWD":/w -w /w node:22 node scripts/preparar-entorno.mjs "$@"
fi

echo "Hace falta Node 22 o mayor, o Docker, para generar el .env." >&2
exit 1
