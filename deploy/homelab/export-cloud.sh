#!/usr/bin/env bash
# Vuelca los DATOS del Supabase de la nube a ./dump/.
#
# Solo datos, no esquema: el esquema `public` lo crean las migraciones del
# repo (supabase/ALL_MIGRATIONS.sql) y los esquemas `auth` y `storage` los
# crean los propios servicios de Supabase al arrancar. Volcar el esquema
# de la nube traería roles, extensiones y versiones que no existen igual
# en el autoalojado, y la restauración fallaría a medias.
#
# Se usa pg_dump desde la imagen oficial de Postgres para no instalar nada
# en el host. Versión 17: un pg_dump nuevo sabe leer servidores viejos; al
# revés no.
#
# Conexión por el POOLER en modo sesión (puerto 5432), que responde por
# IPv4. La conexión "directa" db.<ref>.supabase.co suele ser solo IPv6 y
# desde una red doméstica falla sin explicación.
#
# Uso:
#   SUPABASE_DB_PASSWORD='...' ./export-cloud.sh
set -euo pipefail

REF="xpdqviimqppprxmblytl"
HOST="aws-0-us-east-1.pooler.supabase.com"   # región East US (N. Virginia)
USER="postgres.${REF}"
: "${SUPABASE_DB_PASSWORD:?Exporta SUPABASE_DB_PASSWORD (Supabase → Settings → Database → Database password)}"

OUT="$(dirname "$0")/dump"
mkdir -p "$OUT"
URL="postgresql://${USER}:${SUPABASE_DB_PASSWORD}@${HOST}:5432/postgres?sslmode=require"

dump() { # <fichero> <args de pg_dump…>
  local f="$1"; shift
  docker run --rm -e PGPASSWORD="$SUPABASE_DB_PASSWORD" postgres:17-alpine \
    pg_dump "$URL" --data-only --no-owner --no-privileges --disable-triggers "$@" > "$OUT/$f"
  echo "  $f  $(du -h "$OUT/$f" | cut -f1)"
}

echo "Volcando datos de ${REF}…"

# Todo lo del CRM: contactos, conversaciones, mensajes, prompt del agente…
dump public.sql --schema=public

# Usuarios y sus contraseñas (hash), identidades y perfiles de MFA. Se
# excluyen sesiones y tokens: quedan inválidos al cambiar JWT_SECRET, y
# todo el mundo volverá a iniciar sesión una vez. Las migraciones internas
# de GoTrue tampoco: las gestiona el servicio.
dump auth.sql --schema=auth \
  --exclude-table='auth.schema_migrations' \
  --exclude-table='auth.sessions' \
  --exclude-table='auth.refresh_tokens' \
  --exclude-table='auth.audit_log_entries' \
  --exclude-table='auth.flow_state'

# Metadatos de Storage (buckets y objetos). Los FICHEROS en sí no están
# en Postgres: los copia copy-storage.mjs.
dump storage.sql --schema=storage \
  --exclude-table='storage.migrations' \
  --exclude-table='storage.s3_multipart_uploads' \
  --exclude-table='storage.s3_multipart_uploads_parts'

echo
echo "✓ Volcado en $OUT/. Siguiente: copy-storage.mjs (ficheros) y luego import-homelab.sh."
