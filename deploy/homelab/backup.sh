#!/usr/bin/env bash
# Copia de seguridad diaria del homelab: base de datos + ficheros.
#
# En la nube, Supabase hacía esto por ti (en el plan Pro). Aquí lo haces
# tú, y es la parte de "autoalojar" que nadie recuerda hasta que hace
# falta. Guarda los últimos 14 días y borra el resto.
#
# Programar con cron (a las 03:30, cada día):
#   30 3 * * * /ruta/deploy/homelab/backup.sh >> /var/log/wacrm-backup.log 2>&1
#
# Y de verdad importante: que BACKUP_DIR esté en OTRO disco (o se copie a
# otro sitio). Una copia en el mismo disco que muere con él no es copia.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/backups/wacrm}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
STORAGE_VOL="${STORAGE_VOL:-$(dirname "$0")/../../../supabase/docker/volumes/storage}"
KEEP_DAYS=14

stamp="$(date +%Y%m%d-%H%M)"
mkdir -p "$BACKUP_DIR"

# Base de datos completa (esquema + datos), comprimida.
docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres --no-owner \
  | gzip > "$BACKUP_DIR/db-$stamp.sql.gz"

# Ficheros de Storage.
if [[ -d "$STORAGE_VOL" ]]; then
  tar -czf "$BACKUP_DIR/storage-$stamp.tar.gz" -C "$STORAGE_VOL" .
fi

find "$BACKUP_DIR" -type f -mtime +$KEEP_DAYS -delete
echo "$(date -Is)  ok  $(du -sh "$BACKUP_DIR" | cut -f1) en $BACKUP_DIR"
