#!/usr/bin/env node
/**
 * Importa una exportación de chat de WhatsApp al CRM.
 *
 * Por qué existe: migrar un número a la Cloud API deja la bandeja
 * vacía — el historial vive en la app del móvil, y esa app deja de
 * abrir el número en cuanto migras. Este script recupera lo que
 * exportaste antes de dar el paso.
 *
 * Uso:
 *   node scripts/import-whatsapp-export.mjs <fichero.txt> <telefono> [nombre]
 *
 *   fichero.txt  Exportación de WhatsApp ("Exportar chat", sin multimedia
 *                o con ella — los adjuntos se registran como marcador).
 *   telefono     Teléfono del cliente en formato internacional sin '+',
 *                p. ej. 13475576460. Es la clave de deduplicación.
 *   nombre       Opcional. Si se omite se usa el teléfono.
 *
 * Añade `--dry-run` para ver qué haría sin escribir nada.
 *
 * Notas de diseño:
 *   - Los mensajes importados van sin `message_id`: no tienen wamid de
 *     Meta y no deben colisionar con los reales.
 *   - `status = 'read'`: son históricos, no hay entrega que confirmar.
 *   - Reutiliza el contacto y la conversación si ya existen para ese
 *     teléfono, en vez de duplicarlos.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Configuración ────────────────────────────────────────────────

const ENV_PATH = resolve(process.cwd(), '.env.local')

function loadEnv() {
  const raw = readFileSync(ENV_PATH, 'utf8')
  return Object.fromEntries(
    raw
      .split('\n')
      .filter((l) => /^[A-Z]/.test(l))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1).trim()]
      }),
  )
}

// ── Parseo de la exportación ─────────────────────────────────────

/**
 * WhatsApp exporta en dos formatos según el sistema:
 *   iOS      [4/8/26, 10:30:15] Nombre: mensaje
 *   Android  4/8/26, 10:30 - Nombre: mensaje
 * Ambos pueden llevar AM/PM. Las líneas que no encajan son
 * continuaciones del mensaje anterior (saltos de línea del usuario).
 */
const LINE_RE =
  /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?\]?\s*[-–]?\s*([^:]{1,60}):\s?([\s\S]*)$/

/** Marcadores que WhatsApp deja donde había un adjunto. */
const ATTACHMENT_RE =
  /<(?:Media omitted|Multimedia omitido|attached|archivo adjunto)[^>]*>|(?:image|video|audio|document|sticker) omitted/i

/**
 * WhatsApp escribe la fecha con el formato del móvil, y `8/2/26` es
 * ambiguo: 8 de febrero o 2 de agosto según el país. Se decide mirando
 * el fichero entero antes de convertir nada:
 *
 *   - Si algún primer número supera 12, solo puede ser el día → D/M/Y.
 *   - Si no, y hay AM/PM, es formato de EE. UU. → M/D/Y.
 *   - Si no hay ninguna pista, se asume M/D/Y (es un negocio en NY).
 *
 * Equivocarse aquí desplaza meses enteros y descoloca el orden de la
 * conversación, así que conviene que el script diga en voz alta qué
 * ha decidido.
 */
function detectDateOrder(text) {
  let sawAmPm = false
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LINE_RE)
    if (!m) continue
    if (Number(m[1]) > 12) return { order: 'DMY', reason: 'un primer número > 12' }
    if (m[7]) sawAmPm = true
  }
  return sawAmPm
    ? { order: 'MDY', reason: 'formato AM/PM (EE. UU.)' }
    : { order: 'MDY', reason: 'sin pistas — se asume EE. UU.' }
}

function parseExport(text, order) {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LINE_RE)
    if (!m) {
      // Continuación del mensaje anterior.
      if (out.length && line.trim()) out[out.length - 1].body += '\n' + line
      continue
    }
    const [, first, second, y, h, min, sec, ampm, author, body] = m
    const [dd, mm] =
      order === 'DMY' ? [Number(first), Number(second)] : [Number(second), Number(first)]

    let hour = Number(h)
    if (ampm) {
      const pm = /p/i.test(ampm)
      if (pm && hour !== 12) hour += 12
      if (!pm && hour === 12) hour = 0
    }
    const year = y.length === 2 ? 2000 + Number(y) : Number(y)

    out.push({
      at: new Date(year, mm - 1, dd, hour, Number(min), Number(sec ?? 0)),
      author: author.trim(),
      body: body ?? '',
    })
  }
  return out.filter((m) => m.body.trim() || ATTACHMENT_RE.test(m.body))
}

// ── Cliente REST de Supabase ─────────────────────────────────────

function api(env) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/'
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
  return {
    get: (path) => fetch(base + path, { headers }).then((r) => r.json()),
    post: (path, body) =>
      fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) }).then(
        async (r) => {
          const j = await r.json()
          if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`)
          return j
        },
      ),
    patch: (path, body) =>
      fetch(base + path, { method: 'PATCH', headers, body: JSON.stringify(body) }).then(
        (r) => r.json(),
      ),
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run')
  const dryRun = process.argv.includes('--dry-run')
  const [file, phone, ...nameParts] = args

  if (!file || !phone) {
    console.error(
      'Uso: node scripts/import-whatsapp-export.mjs <fichero.txt> <telefono> [nombre] [--dry-run]',
    )
    process.exit(1)
  }

  const name = nameParts.join(' ') || phone
  const env = loadEnv()
  const db = api(env)

  const raw = readFileSync(resolve(file), 'utf8')
  const { order, reason } = detectDateOrder(raw)
  console.log(`Formato de fecha       : ${order} (${reason})`)
  const parsed = parseExport(raw, order)
  if (!parsed.length) {
    console.error('No se reconoció ningún mensaje. ¿Es una exportación de WhatsApp?')
    process.exit(1)
  }

  // El autor que más aparece como remitente NO es necesariamente el
  // cliente, así que se pide explícitamente: todo lo que no sea el
  // cliente se considera del negocio.
  const authors = [...new Set(parsed.map((m) => m.author))]
  console.log('Participantes detectados:', authors.join(' | '))
  console.log('Mensajes reconocidos   :', parsed.length)
  console.log('Rango                  :', parsed[0].at.toISOString().slice(0, 10),
    '→', parsed[parsed.length - 1].at.toISOString().slice(0, 10))

  if (authors.length !== 2) {
    console.warn(
      `\n⚠  Se esperaban 2 participantes y hay ${authors.length}. ` +
        'Si es un grupo, el resultado no tendrá sentido.',
    )
  }

  // El cliente es el autor cuyo nombre coincide con el que se pasó, o
  // —lo habitual— el que NO eres tú. Se resuelve por el nombre dado.
  const customerAuthor =
    authors.find((a) => a.toLowerCase() === name.toLowerCase()) ??
    authors.find((a) => a.replace(/\D/g, '').includes(phone.slice(-7))) ??
    authors[0]
  console.log('Se tratará como cliente :', customerAuthor)
  console.log('El resto se importa como mensajes del negocio (agent).')

  if (dryRun) {
    console.log('\n--dry-run: no se ha escrito nada.')
    console.log('Primeros 5 mensajes:')
    parsed.slice(0, 5).forEach((m) =>
      console.log(
        '  ' + m.at.toISOString().slice(0, 16) + ' [' +
          (m.author === customerAuthor ? 'customer' : 'agent') + '] ' +
          m.body.slice(0, 60),
      ),
    )
    return
  }

  // Cuenta destino: la del owner.
  const [owner] = await db.get('profiles?select=user_id,account_id&account_role=eq.owner')
  if (!owner) throw new Error('No se encontró un perfil owner.')

  // Contacto — reutiliza si ya existe (dedupe por teléfono).
  let [contact] = await db.get(`contacts?select=id&phone=eq.${phone}`)
  if (!contact) {
    ;[contact] = await db.post('contacts', {
      user_id: owner.user_id,
      account_id: owner.account_id,
      phone,
      name,
    })
    console.log('Contacto creado:', contact.id)
  } else {
    console.log('Contacto existente reutilizado:', contact.id)
  }

  // Conversación — igual.
  let [conv] = await db.get(`conversations?select=id&contact_id=eq.${contact.id}`)
  if (!conv) {
    ;[conv] = await db.post('conversations', {
      user_id: owner.user_id,
      account_id: owner.account_id,
      contact_id: contact.id,
      status: 'open',
    })
    console.log('Conversación creada:', conv.id)
  } else {
    console.log('Conversación existente reutilizada:', conv.id)
  }

  // Mensajes, en lotes para no abusar del endpoint.
  const rows = parsed.map((m) => ({
    conversation_id: conv.id,
    sender_type: m.author === customerAuthor ? 'customer' : 'agent',
    content_type: ATTACHMENT_RE.test(m.body) ? 'image' : 'text',
    content_text: m.body.trim() || null,
    status: 'read',
    created_at: m.at.toISOString(),
  }))

  const BATCH = 200
  let done = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    await db.post('messages', chunk)
    done += chunk.length
    process.stdout.write(`\rImportando… ${done}/${rows.length}`)
  }
  console.log('')

  const last = parsed[parsed.length - 1]
  await db.patch(`conversations?id=eq.${conv.id}`, {
    last_message_text: last.body.slice(0, 200),
    last_message_at: last.at.toISOString(),
  })

  console.log(`\n✓ ${rows.length} mensajes importados en la conversación ${conv.id}`)
  console.log('  Ábrela en https://ngsignscrm.com/inbox')
}

main().catch((e) => {
  console.error('\nError:', e.message)
  process.exit(1)
})
