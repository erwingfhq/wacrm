#!/usr/bin/env bash
# Carga el esquema del CRM y los datos volcados en el Supabase del homelab.
#
# Orden, y por qué:
#   1. ALL_MIGRATIONS.sql  → crea tablas, RLS, funciones, triggers.
#   2. auth.sql            → usuarios; los perfiles de `public` los
#                            referencian, así que van antes.
#   3. public.sql          → el CRM entero.
#   4. storage.sql         → buckets y objetos (los bytes, copy-storage.mjs).
#
# Todo dentro de `session_replication_role = replica`: desactiva triggers
# y comprobaciones de clave ajena durante la carga, que es lo que permite
# insertar en cualquier orden interno sin que un FK a medio camino aborte
# el volcado. Requiere superusuario; en el autoalojado lo somos.
#
# Uso (desde deploy/homelab, con el compose de Supabase ya arrancado):
#   ./import-homelab.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DUMP="$HERE/dump"
MIG="$HERE/../../supabase/ALL_MIGRATIONS.sql"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"

for f in "$MIG" "$DUMP/auth.sql" "$DUMP/public.sql" "$DUMP/storage.sql"; do
  [[ -f "$f" ]] || { echo "Falta $f"; exit 1; }
done
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || { echo "No encuentro el contenedor $DB_CONTAINER — ¿está arrancado Supabase?"; exit 1; }

psql() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "1/4 esquema del CRM (36 migraciones)…"
psql -q < "$MIG"

load() { # <fichero>
  echo "$2…"
  { echo "SET session_replication_role = replica;"; cat "$1"; echo "SET session_replication_role = DEFAULT;"; } | psql -q
}
load "$DUMP/auth.sql"    "2/4 usuarios (auth)"
load "$DUMP/public.sql"  "3/4 datos del CRM (public)"
load "$DUMP/storage.sql" "4/4 metadatos de Storage"

echo
echo "Recuento:"
psql -At <<'SQL'
select 'usuarios      ' || count(*) from auth.users
union all select 'contactos     ' || count(*) from public.contacts
union all select 'conversaciones' || count(*) from public.conversations
union all select 'mensajes      ' || count(*) from public.messages
union all select 'whatsapp      ' || string_agg(status, ',') from public.whatsapp_config
union all select 'agente IA     ' || count(*) || ' config' from public.ai_configs;
SQL
echo
echo "✓ Datos cargados. Siguiente: copy-storage.mjs para los ficheros."
