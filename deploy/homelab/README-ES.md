# wacrm en el homelab — guía de despliegue

Producción completa en tu propio servidor: el CRM y Supabase (Postgres,
Auth, Storage, API) en Docker, publicados con Tailscale. Sin Hostinger,
sin Supabase cloud, sin mover DNS, sin abrir puertos.

## Cómo queda

```
 Meta (WhatsApp) ──HTTPS──▶ Funnel :443 ─┐
                                          ├─▶ Tailscale (host) ─▶ app :3000 ─▶ Kong :8000 ─▶ Postgres
 Equipo (móvil/portátil    ──tailnet──▶ :443 (app)               ▲
   con Tailscale)          ──tailnet──▶ :8443 (Supabase API) ────┘
```

- **`:443` es público** (Funnel): Meta tiene que llegar al webhook y Funnel
  expone el puerto entero, no una ruta. Pero entrar al CRM exige hablar
  con Supabase en **`:8443`, que solo existe dentro de la tailnet**. Un
  desconocido ve la pantalla de login y no pasa de ahí.
- El dominio `ngsignscrm.com` deja de servir la app (sigue para el correo).
  La dirección del CRM pasa a ser `https://<nodo>.<tailnet>.ts.net`.

## Requisitos del servidor

- Linux (Ubuntu 22.04+/Debian 12+), **4 GB de RAM mínimo** — Supabase
  autoalojado ocupa ~2,5 GB en reposo — y 20 GB de disco.
- `docker` con el plugin `compose`, `git`, `node` ≥ 20.
- Tailscale instalado y el nodo unido a tu tailnet.

```bash
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER
curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up
```

## 0. Tailscale: dos ajustes en el panel (una sola vez)

En <https://login.tailscale.com/admin>:

1. **DNS → HTTPS Certificates → Enable.** Sin esto no hay certificados
   para `*.ts.net` y nada de lo que sigue funciona.
2. **Access controls →** añade el atributo `funnel` a este nodo:
   ```json
   "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]
   ```

Apunta el nombre y la IP del nodo; los pide el paso 2:

```bash
tailscale status --self   # → homelab.tail1234.ts.net
tailscale ip -4           # → 100.x.y.z
```

## 1. Código

```bash
mkdir -p ~/srv && cd ~/srv
git clone git@github.com:erwingfhq/wacrm.git
git clone --depth 1 --filter=blob:none --sparse https://github.com/supabase/supabase.git
cd supabase && git sparse-checkout set docker && cd ..
```

Copia desde tu Mac los dos ficheros con secretos que no están en git:

```bash
scp "~/Desktop/Whatsapp CRM/.env.local" "~/Desktop/Whatsapp CRM/.env.whatsapp-token" homelab:~/srv/wacrm/
```

## 2. Secretos

```bash
cd ~/srv/wacrm/deploy/homelab
node gen-secrets.mjs --cloud-env ../../.env.local \
     --tailnet homelab.tail1234.ts.net --tailscale-ip 100.x.y.z
```

Genera `supabase.env` y `app.env`. **Edita `supabase.env` y pon
`SMTP_PASS`** (la contraseña del buzón `crm@ngsignscrm.com`). Después:

```bash
./apply-supabase-env.sh ~/srv/supabase/docker
```

Qué se conserva de la nube y qué no, porque importa:

| | |
|---|---|
| `ENCRYPTION_KEY` | **Se conserva.** Cifra el token de WhatsApp, el `verify_token` y la clave de OpenAI que viven en la base de datos. Con la misma clave, todo eso sigue funcionando sin tocarlo. |
| `JWT_SECRET`, `anon`, `service_role` | **Nuevos.** Están firmados por instancia; los de la nube no valen aquí. |
| `META_APP_SECRET` | **Se conserva.** Es de la app de Meta, no de dónde corra el CRM. |
| Sesiones de usuario | Se invalidan. Cada uno inicia sesión una vez más; las contraseñas siguen valiendo. |

## 3. Arrancar Supabase

```bash
cd ~/srv/supabase/docker
docker compose pull && docker compose up -d
docker compose ps        # todo "healthy" en 1–2 minutos
```

Panel de Supabase (Studio): `http://<ip-lan>:8000`, usuario `admin`, la
contraseña la imprimió `gen-secrets.mjs`. **Ese puerto queda abierto en
tu LAN**; si quieres cerrarlo, en `docker-compose.yml` cambia
`"${KONG_HTTP_PORT}:8000"` por `"127.0.0.1:${KONG_HTTP_PORT}:8000"` y
entra a Studio por Tailscale (`:8443`).

## 4. Traer los datos de la nube

La contraseña está en Supabase → Project Settings → Database.

```bash
cd ~/srv/wacrm/deploy/homelab
SUPABASE_DB_PASSWORD='...' ./export-cloud.sh     # → dump/{auth,public,storage}.sql
./import-homelab.sh                              # esquema + datos, imprime recuentos
```

Comprueba que los recuentos cuadran con lo que ves en el CRM de la nube.

## 5. Publicar con Tailscale

```bash
sudo ./tailscale-serve.sh
```

Imprime la URL del webhook. Desde otro dispositivo de la tailnet,
`https://homelab.tail1234.ts.net:8443/rest/v1/` debe responder (401 es
correcto: pide clave). Con `:8443` ya vivo, copia los ficheros de Storage:

```bash
CLOUD_URL=https://xpdqviimqppprxmblytl.supabase.co \
CLOUD_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY ../../.env.local | cut -d= -f2) \
LOCAL_URL=https://homelab.tail1234.ts.net:8443 \
LOCAL_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY app.env | cut -d= -f2) \
node copy-storage.mjs
```

## 6. Arrancar el CRM

```bash
docker compose -f docker-compose.app.yml --env-file app.env up -d --build
docker compose -f docker-compose.app.yml logs -f app     # "Ready" y sin errores de Supabase
```

Abre `https://homelab.tail1234.ts.net` desde un dispositivo con Tailscale
y entra con tu usuario de siempre.

## 7. Cambiar Meta al homelab

Ahora los dos CRM (Hostinger y homelab) están vivos y Meta sigue
apuntando a Hostinger. El corte es un solo cambio:

1. <https://developers.facebook.com/apps/1019685967553848> → WhatsApp →
   Configuración → **Webhook → Editar**.
2. URL de devolución de llamada: la que imprimió `tailscale-serve.sh`
   (`https://homelab.tail1234.ts.net/api/whatsapp/webhook`).
3. Token de verificación: **el mismo de siempre** — está en la base de datos
   cifrado con el `ENCRYPTION_KEY` que conservamos, así que el homelab lo
   reconoce. Si no lo tienes a mano: `.env.whatsapp-token` no es este;
   sácalo con `node -e` descifrando `whatsapp_config.verify_token`, o
   mira en SETUP-ES.md.
4. **Verificar y guardar.** Escribe un WhatsApp al número: debe aparecer
   en el CRM del homelab y el agente debe contestar.

Si algo falla, vuelve a poner la URL de Hostinger en Meta: el corte es
reversible en un minuto mientras no apagues nada.

## 8. Apagar la nube (después de una semana tranquila)

- **Hostinger**: detén la Web App (no la borres aún).
- **Supabase cloud**: déjala una semana como red de seguridad; luego
  pausa el proyecto o descarga su copia y bórralo. Recuerda que en Free
  se pausa solo a los 7 días sin tráfico.

## 9. Copias de seguridad — no es opcional

Ya instalado y en marcha en `docker-srv`:

```
30 3 * * * /opt/containers/wacrm/deploy/homelab/backup.sh >> /var/log/wacrm-backup.log 2>&1
```

Guarda en `/var/backups/wacrm/` la base de datos y los ficheros de
Storage, con 14 días de retención. Una copia ronda los **96 KB**, así que
la retención no cuesta nada.

**Cada copia se verifica antes de darse por buena**: que el gzip esté
íntegro, que contenga las tablas clave, y cuántos mensajes trae. Una
copia vacía o truncada pasa desapercibida durante meses y se descubre el
día que hace falta; por eso el script falla en voz alta en lugar de
dejarla ahí.

Dos trampas que costaron un rato al montarlo, por si tocas el script:

- **Nada de umbrales por tamaño.** La primera versión exigía 100 KB
  mínimos y saltaba con copias perfectamente válidas: esta base entera
  comprime a 96 KB. Se comprueba el contenido, no los bytes.
- **Cuidado con `set -o pipefail` y los cortes anticipados.** `grep -q` y
  `awk ... {exit}` cierran la tubería, `zcat` recibe SIGPIPE y el script
  muere con código 141 *después* de haber hecho bien la copia. Se lee el
  fichero entero de una pasada.

### Pendiente: sacarlas de la máquina

Hoy las copias viven en el **mismo disco** que los datos. Eso protege de
un borrado accidental o una migración fallida, pero no de un disco
muerto. El script ya admite un destino remoto por la variable `OFFSITE`,
que hace `rsync` tras cada copia:

```bash
# Con el NAS montado (NFS/SMB) — el plan definitivo:
30 3 * * * OFFSITE=/mnt/nas/wacrm /opt/containers/wacrm/deploy/homelab/backup.sh >> /var/log/wacrm-backup.log 2>&1

# Por SSH a otra máquina de la tailnet — interino, gratis:
30 3 * * * OFFSITE=usuario@casa-server:backups/wacrm /opt/containers/wacrm/deploy/homelab/backup.sh >> ...
```

Para el destino por SSH hay una clave dedicada en
`/root/.ssh/id_ed25519_backup` (creada sin passphrase, solo para esto);
basta con autorizar su `.pub` en el destino.

### Restaurar

```bash
zcat /var/backups/wacrm/db-AAAAMMDD-HHMM.sql.gz \
  | docker exec -i supabase-db psql -U postgres -d postgres
```

El volcado lleva `--clean --if-exists`, así que se restaura sobre una base
que ya tenga datos sin vaciarla antes. **Pruébalo una vez al mes contra un
contenedor aparte**: una copia que nunca se ha restaurado es una
hipótesis, no una copia.

## Operación diaria

| Quiero… | Comando |
|---|---|
| Actualizar el CRM | `cd ~/srv/wacrm && git pull && cd deploy/homelab && docker compose -f docker-compose.app.yml --env-file app.env up -d --build` |
| Aplicar una migración nueva | `docker exec -i supabase-db psql -U postgres -d postgres < ../../supabase/migrations/0XX_*.sql` **antes** de reconstruir la app |
| Ver logs del CRM | `docker compose -f docker-compose.app.yml logs -f app` |
| Ver logs de Supabase | `cd ~/srv/supabase/docker && docker compose logs -f auth rest storage` |
| Actualizar Supabase | `cd ~/srv/supabase/docker && git pull && docker compose pull && docker compose up -d` (haz copia antes) |

## Problemas conocidos y su causa

- **El login carga pero no entra, sin error.** El navegador no llega a
  `:8443` → ese dispositivo no está en la tailnet, o `tailscale serve`
  no está activo (`tailscale serve status`).
- **Meta dice que no puede verificar el webhook.** Funnel no está activo
  (`tailscale funnel status`), o falta el atributo `funnel` en el panel.
- **"invalid signature" en los logs de la app.** `META_APP_SECRET` no es
  el de la app `1019685967553848`. Mismo síntoma que en la primera
  puesta en marcha (ver SETUP-ES.md).
- **La app no descifra el token de WhatsApp / la clave de OpenAI.**
  `ENCRYPTION_KEY` en `app.env` no es el de la nube. Cópialo tal cual de
  `.env.local`.
- **Correos de Auth no llegan.** `SMTP_PASS` en `supabase.env` y
  `docker compose up -d auth` para recargarlo. Los logs de `auth`
  muestran el `535` si la contraseña está mal.
