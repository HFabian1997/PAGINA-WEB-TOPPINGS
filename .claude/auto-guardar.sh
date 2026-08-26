#!/usr/bin/env bash
# Guarda un commit cada vez que se modifica un archivo.
#
# Se dispara solo, después de cada edición. La idea es que NUNCA se pierda
# trabajo: antes los commits los hacía a mano y se pasaron nueve días sin
# guardar nada.
#
# Nunca corta el trabajo: si algo falla, avisa y sale bien igual.

set -uo pipefail

RAIZ="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$RAIZ" || exit 0

# En medio de un merge o un rebase no se toca nada
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ]; then
  exit 0
fi

# ¿Hay algo que guardar? (respeta .gitignore)
if [ -z "$(git status --porcelain)" ]; then
  exit 0
fi

git add -A

# Si después de aplicar .gitignore no quedó nada, no se hace commit vacío
if git diff --cached --quiet; then
  exit 0
fi

CUANTOS=$(git diff --cached --name-only | wc -l | tr -d ' ')
# `paste -sd ", "` NO sirve acá: toma la cadena como una LISTA de separadores
# y los va rotando (coma, espacio, coma...), así que la lista sale despareja.
LISTA=$(git diff --cached --name-only | head -4 | sed 's|.*/||' | tr '\n' '\a' | sed 's/\a$//; s/\a/, /g')
[ "$CUANTOS" -gt 4 ] && LISTA="$LISTA y $((CUANTOS - 4)) más"

git commit -q -m "Guardado automático: $LISTA" -m "Commit hecho solo al editar. Se pueden juntar después con un squash." 2>/dev/null

exit 0
