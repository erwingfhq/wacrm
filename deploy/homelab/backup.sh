#!/usr/bin/env bash
# Copia de seguridad del CRM: base de datos + ficheros de Storage.
#
# En Supabase cloud esto lo hacía el proveedor. Autoalojado, lo haces tú,
# y es la parte de "tener tus datos en casa" que nadie recuerda hasta que
# hace falta.
#
# Guarda los últimos KEEP_DAYS días y borra lo anterior. La base de datos
# ronda los 14 MB comprimidos, así que la retención cuesta poco.
#
# Cron (03:30 cada día):
#   30 3 * * * /opt/containers/wacrm/deploy/homelab/backup.sh >> /var/log/wacrm-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/wacrm}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
STORAGE_VOL="${STORAGE_VOL:-/opt/containers/supabase/docker/volumes/storage}"
KEEP_DAYS="${KEEP_DAYS:-14}"
# Nodo Tailscale donde dejar una copia fuera de esta máquina. Vacío = no.
OFFSITE="${OFFSITE:-}"

stamp="$(date +%Y%m%d-%H%M)"
mkdir -p "$BACKUP_DIR"

# --clean --if-exists: el volcado se puede restaurar sobre una base que ya
# tenga cosas, sin borrarla a mano antes.
docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres \
  --no-owner --no-privileges --clean --if-exists \
  | gzip > "$BACKUP_DIR/db-$stamp.sql.gz"

# Un volcado vacío o truncado pasaría desapercibido durante meses, así
# que se comprueba el CONTENIDO y no el tamaño: el umbral por bytes es
# engañoso —esta base entera comprime a ~96 KB— y saltaba con copias
# perfectamente válidas.
size=$(stat -c%s "$BACKUP_DIR/db-$stamp.sql.gz")
gzip -t "$BACKUP_DIR/db-$stamp.sql.gz"   # íntegro de principio a fin
# Una sola pasada. Con `grep -q` dentro del bucle, grep cortaba la
# lectura, zcat recibía SIGPIPE y `pipefail` marcaba la tubería como
# fallida aunque la tabla estuviera: daba falsos errores en copias buenas.
presentes=$(zcat "$BACKUP_DIR/db-$stamp.sql.gz" | grep -o '^COPY public\.[a-z_]*' | sort -u)
faltan=""
for t in messages contacts conversations ai_configs whatsapp_config; do
  case "$presentes" in *"COPY public.$t"*) ;; *) faltan="$faltan $t" ;; esac
done
if [ -n "$faltan" ]; then
  echo "$(date -Is)  ERROR: al volcado le faltan tablas:$faltan"
  exit 1
fi
# El awk NO sale al terminar el bloque —baja una bandera y sigue— porque
# salir antes cierra la tubería, zcat recibe SIGPIPE y `pipefail` tumba el
# script con código 141 después de haber hecho la copia correctamente.
filas=$(zcat "$BACKUP_DIR/db-$stamp.sql.gz" \
  | awk '/^COPY public.messages /{f=1;next} f&&/^\\\./{f=0} f{c++} END{print c+0}')

if [ -d "$STORAGE_VOL" ]; then
  tar -czf "$BACKUP_DIR/storage-$stamp.tar.gz" -C "$STORAGE_VOL" . 2>/dev/null || true
fi

# Copia fuera de la máquina. Sin esto, un disco muerto se lleva también
# las copias: están en el mismo sitio que los datos.
if [ -n "$OFFSITE" ]; then
  rsync -a --delete-after \
    "$BACKUP_DIR/" "$OFFSITE/" 2>&1 | tail -2 || echo "  aviso: la copia remota falló"
fi

find "$BACKUP_DIR" -type f -mtime "+$KEEP_DAYS" -delete
echo "$(date -Is)  ok  db-$stamp.sql.gz ($(numfmt --to=iec $size), $filas mensajes)  total $(du -sh "$BACKUP_DIR" | cut -f1)"
