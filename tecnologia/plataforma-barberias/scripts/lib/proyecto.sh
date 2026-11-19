#!/usr/bin/env bash
# Funcionalidad 009 (research R01b): guardián del proyecto de Docker Compose, en bash puro (no necesita Node).
# Uso en otro script:  "$(dirname "$0")/../scripts/lib/proyecto.sh" || exit $?
# Código 0 si COMPOSE_PROJECT_NAME es un proyecto propio; 6 si falta o es el del responsable.
proyecto="$(printf '%s' "${COMPOSE_PROJECT_NAME:-}" | tr -d '[:space:]')"
if [ -z "$proyecto" ]; then
  echo "Falta COMPOSE_PROJECT_NAME. Los scripts de 009 nunca usan el proyecto por defecto: fija uno propio, por ejemplo COMPOSE_PROJECT_NAME=barberias-verificacion." >&2
  exit 6
fi
if [ "$(printf '%s' "$proyecto" | tr '[:upper:]' '[:lower:]')" = "plataforma-barberias" ]; then
  echo "COMPOSE_PROJECT_NAME=$proyecto es el proyecto de desarrollo del responsable: no se usa para medir ni verificar." >&2
  exit 6
fi
exit 0
