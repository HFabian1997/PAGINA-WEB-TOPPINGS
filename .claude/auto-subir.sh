#!/usr/bin/env bash
# Sube a GitHub lo que haya quedado guardado, al terminar cada tanda de trabajo.
#
# ANTES DE SUBIR REVISA QUE NO SE ESCAPE NADA SECRETO. El repositorio es
# PÚBLICO: cualquiera puede leerlo. Si encuentra algo, NO sube y avisa —
# nunca fuerza el push.
#
# La revisión es a propósito estrecha. Una que salte con cualquier palabra
# ("Zona Secreta", `checkAdminSecret`) terminaría bloqueando siempre, y una
# alarma que suena siempre es una alarma que se ignora.

set -uo pipefail

RAIZ="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$RAIZ" || exit 0

# ¿Hay algo por subir?
if ! git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
  echo "⚠️  La rama no tiene remoto configurado. No subo nada."
  exit 0
fi
PENDIENTES=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)
[ "$PENDIENTES" = "0" ] && exit 0

# ---------- revisión de seguridad ----------
PROBLEMAS=""

# 1. Archivos que NUNCA deben estar en el repo, aunque cambie el .gitignore
for PROHIBIDO in admin/content.json api/ai-config.php api/push-config.php .env; do
  if git ls-files --error-unmatch "$PROHIBIDO" >/dev/null 2>&1; then
    PROBLEMAS="$PROBLEMAS\n  · $PROHIBIDO está siendo versionado (tiene claves)"
  fi
done

# 2. Datos de clientes y fotos que suben ellos
if git ls-files 'api/data/*.json' 'api/uploads/*' 2>/dev/null | grep -qv '\.htaccess$'; then
  PROBLEMAS="$PROBLEMAS\n  · hay datos de clientes o fotos suyas versionados"
fi

# 3. Un valor de clave escrito a mano dentro del código que se va a subir
FUGAS=$(git diff @{u}..HEAD -U0 2>/dev/null \
  | grep '^+' \
  | grep -inE "(secret|password|passwd|apikey|api_key|token|authorization)[\"']?[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9_@#%^&*!-]{8,}[\"']" \
  | grep -viE "placeholder|ejemplo|example|tu-clave|xxxx" | head -3)
[ -n "$FUGAS" ] && PROBLEMAS="$PROBLEMAS\n  · parece haber una clave escrita en el código:\n$(echo "$FUGAS" | sed 's/^/      /')"

# 4. Claves de servicios conocidos, por su forma
FORMAS=$(git diff @{u}..HEAD -U0 2>/dev/null | grep '^+' \
  | grep -oE "(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)" | head -3)
[ -n "$FORMAS" ] && PROBLEMAS="$PROBLEMAS\n  · hay algo con forma de clave de servicio: $(echo "$FORMAS" | paste -sd ' ' -)"

if [ -n "$PROBLEMAS" ]; then
  echo "🛑 NO subí nada a GitHub. El repositorio es público y encontré esto:"
  printf "%b\n" "$PROBLEMAS"
  echo ""
  echo "   Quedan $PENDIENTES commits guardados en tu computador, sin subir."
  echo "   Revisalo y volvé a intentar. No fuerzo el push."
  exit 0
fi

# ---------- subir ----------
SALIDA=$(git push origin HEAD 2>&1)
if [ $? -eq 0 ]; then
  echo "✅ Subidos $PENDIENTES commits a GitHub."
else
  echo "⚠️  No pude subir. Los commits están guardados en tu computador."
  echo "$SALIDA" | tail -4 | sed 's/^/   /'
  echo "   No fuerzo el push. Contame qué dice y lo vemos."
fi

exit 0
