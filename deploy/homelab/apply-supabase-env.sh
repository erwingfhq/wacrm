#!/usr/bin/env bash
# Fusiona supabase.env (generado) sobre el .env del Supabase autoalojado.
#
# Supabase publica su docker-compose con un .env.example de ~80 variables.
# Solo cambiamos las nuestras; el resto se deja tal cual para que las
# actualizaciones del upstream no rompan nada. Cada clave de supabase.env
# reemplaza la línea correspondiente del .env; si no existe, se añade.
#
# Uso: ./apply-supabase-env.sh <ruta al directorio supabase/docker>
set -euo pipefail

DOCKER_DIR="${1:?Uso: $0 <ruta a supabase/docker>}"
SRC="$(dirname "$0")/supabase.env"
DST="$DOCKER_DIR/.env"

[[ -f "$SRC" ]] || { echo "No existe $SRC — ejecuta antes gen-secrets.mjs"; exit 1; }
[[ -f "$DST" ]] || cp "$DOCKER_DIR/.env.example" "$DST"

if grep -q '__PON_AQUI' "$SRC"; then
  echo "supabase.env aún tiene marcadores __PON_AQUI__ (SMTP_PASS). Rellénalos primero."
  exit 1
fi

while IFS= read -r line; do
  [[ "$line" =~ ^[A-Z_]+= ]] || continue
  key="${line%%=*}"
  if grep -q "^${key}=" "$DST"; then
    # Reemplazo literal; el delimitador | no aparece en JWT ni en hex.
    sed -i.bak "s|^${key}=.*|${line}|" "$DST"
  else
    printf '\n%s\n' "$line" >> "$DST"
  fi
done < "$SRC"
rm -f "$DST.bak"
chmod 600 "$DST"
echo "✓ $DST actualizado con $(grep -c '^[A-Z_]*=' "$SRC") variables."
