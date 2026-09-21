#!/usr/bin/env node
/**
 * Genera los secretos del Supabase autoalojado y los ficheros de entorno.
 *
 * Por qué hace falta: las claves `anon` y `service_role` no son valores
 * arbitrarios — son JWT firmados con el `JWT_SECRET` de ESA instancia.
 * Las de la nube están firmadas con el secreto de Supabase Inc., así que
 * el homelab las rechazaría. Aquí se genera un secreto nuevo y se firman
 * las dos claves con él, igual que hace Supabase al crear un proyecto.
 *
 * Lo ÚNICO que se conserva de la nube es ENCRYPTION_KEY: con él están
 * cifrados el token de WhatsApp, el verify_token y la clave de OpenAI que
 * viven en la base de datos. Cambiarlo dejaría esos valores ilegibles y
 * habría que volver a introducirlos a mano.
 *
 * Uso (en el homelab, dentro de deploy/homelab/):
 *   node gen-secrets.mjs --cloud-env ../../.env.local \
 *        --tailnet homelab.tail1234.ts.net --tailscale-ip 100.101.102.103
 *
 * Escribe:
 *   supabase.env   → variables para el docker/.env del repo de Supabase
 *   app.env        → el .env.local del CRM apuntando al homelab
 * Ninguno de los dos entra en git (ver .gitignore de esta carpeta).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import crypto from 'node:crypto'

// ── argumentos ──────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]])
    return acc
  }, []),
)
const cloudEnvPath = args['cloud-env']
const tailnet = args['tailnet']
const tailscaleIp = args['tailscale-ip']
if (!cloudEnvPath || !tailnet || !tailscaleIp) {
  console.error(
    'Uso: node gen-secrets.mjs --cloud-env <.env.local de la nube> --tailnet <host.tailnet.ts.net> --tailscale-ip <100.x.y.z>\n' +
      '     (la IP sale de `tailscale ip -4`; el nombre, de `tailscale status`)',
  )
  process.exit(1)
}
if (!/^100\.\d+\.\d+\.\d+$/.test(tailscaleIp)) {
  console.error(`--tailscale-ip debe ser la IP 100.x.y.z del nodo, no ${tailscaleIp}`)
  process.exit(1)
}
if (!existsSync(cloudEnvPath)) {
  console.error(`No existe ${cloudEnvPath}`)
  process.exit(1)
}

const cloud = Object.fromEntries(
  readFileSync(cloudEnvPath, 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z]/.test(l))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1).trim()]
    }),
)
for (const k of ['ENCRYPTION_KEY', 'AUTOMATION_CRON_SECRET', 'META_APP_SECRET']) {
  if (!cloud[k]) console.warn(`⚠  ${k} no está en ${cloudEnvPath}; tendrás que ponerlo a mano en app.env`)
}

// ── secretos nuevos ─────────────────────────────────────────────────
const hex = (n) => crypto.randomBytes(n).toString('hex')
const b64url = (buf) => Buffer.from(buf).toString('base64url')

const JWT_SECRET = hex(32) // 64 caracteres; Supabase exige ≥ 32
const POSTGRES_PASSWORD = hex(24)
const DASHBOARD_PASSWORD = hex(12)
const SECRET_KEY_BASE = hex(32)
const VAULT_ENC_KEY = hex(16) // exactamente 32 caracteres
const LOGFLARE_KEY = hex(24)

/** JWT HS256 con la forma exacta que espera Supabase (iss, role, iat, exp). */
function signSupabaseJwt(role) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({ iss: 'supabase', ref: 'homelab', role, iat: now, exp: now + 10 * 365 * 24 * 3600 }),
  )
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
  return `${header}.${payload}.${b64url(sig)}`
}
const ANON_KEY = signSupabaseJwt('anon')
const SERVICE_ROLE_KEY = signSupabaseJwt('service_role')

// ── URLs ────────────────────────────────────────────────────────────
// La app se sirve en :443 del nodo Tailscale; Supabase (Kong) en :8443.
// Las dos con el certificado que gestiona Tailscale. Ver tailscale-serve.sh.
const APP_URL = `https://${tailnet}`
const SUPABASE_URL = `https://${tailnet}:8443`

// ── supabase.env ────────────────────────────────────────────────────
// Solo las variables que difieren del .env.example oficial. El resto se
// deja como viene. Se aplican con apply-supabase-env.sh.
const supabaseEnv = `# Generado por gen-secrets.mjs — ${new Date().toISOString()}
# Se fusiona sobre supabase/docker/.env (copia del .env.example oficial).

POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}
SECRET_KEY_BASE=${SECRET_KEY_BASE}
VAULT_ENC_KEY=${VAULT_ENC_KEY}
LOGFLARE_PUBLIC_ACCESS_TOKEN=${LOGFLARE_KEY}
LOGFLARE_PRIVATE_ACCESS_TOKEN=${hex(24)}

# Dónde vive todo para el navegador del equipo (tailnet).
SITE_URL=${APP_URL}
API_EXTERNAL_URL=${SUPABASE_URL}
SUPABASE_PUBLIC_URL=${SUPABASE_URL}
ADDITIONAL_REDIRECT_URLS=${APP_URL}/**

# Correo de Auth: el buzón de Hostinger que ya está verificado
# (MX/SPF/DKIM). Pon la contraseña del buzón en SMTP_PASS.
SMTP_ADMIN_EMAIL=crm@ngsignscrm.com
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=crm@ngsignscrm.com
SMTP_PASS=__PON_AQUI_LA_CONTRASEÑA_DEL_BUZON__
SMTP_SENDER_NAME=NG Signs CRM

# Sin registro libre: las cuentas las crea el admin desde el CRM.
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
DISABLE_SIGNUP=false

STUDIO_DEFAULT_ORGANIZATION=NewGen Signs
STUDIO_DEFAULT_PROJECT=wacrm
`

// ── app.env ─────────────────────────────────────────────────────────
const appEnv = `# Generado por gen-secrets.mjs — ${new Date().toISOString()}
# .env.local del CRM en el homelab. NO subir a git.

NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
NEXT_PUBLIC_SITE_URL=${APP_URL}
NEXT_PUBLIC_APP_LOCALE=${cloud.NEXT_PUBLIC_APP_LOCALE || 'en'}

# CONSERVADOS de la nube — con ellos están cifrados los secretos que
# viven en la base de datos. Si cambian, hay que reintroducir el token
# de WhatsApp y la clave de OpenAI desde el CRM.
ENCRYPTION_KEY=${cloud.ENCRYPTION_KEY || '__FALTA__'}
AUTOMATION_CRON_SECRET=${cloud.AUTOMATION_CRON_SECRET || hex(24)}
META_APP_SECRET=${cloud.META_APP_SECRET || '__FALTA__'}

# Puerto en el host donde escucha el contenedor de la app.
HOST_PORT=3000

# Para que el CONTENEDOR resuelva el nombre .ts.net sin depender del DNS
# de Docker: docker-compose.app.yml lo fija con extra_hosts. Si el nodo
# cambia de IP de Tailscale (raro), actualízalo aquí y reinicia.
TAILNET_HOST=${tailnet}
TAILSCALE_IP=${tailscaleIp}
`

writeFileSync('supabase.env', supabaseEnv, { mode: 0o600 })
writeFileSync('app.env', appEnv, { mode: 0o600 })

console.log('✓ supabase.env y app.env escritos (permisos 600).')
console.log('')
console.log('  App (equipo, vía Tailscale) :', APP_URL)
console.log('  Supabase API                :', SUPABASE_URL)
console.log('  Studio (panel de Supabase)  :', `http://<ip-del-homelab>:8000  usuario admin / ${DASHBOARD_PASSWORD}`)
console.log('')
console.log('Siguiente: edita supabase.env y pon SMTP_PASS. Luego apply-supabase-env.sh.')
