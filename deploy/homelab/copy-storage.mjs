#!/usr/bin/env node
/**
 * Copia los FICHEROS de Storage de la nube al homelab, bucket a bucket.
 *
 * Los metadatos (qué buckets hay, qué objetos, con qué permisos) viajan
 * en el volcado de Postgres; los bytes no. Este script los baja de la
 * nube con la clave service_role de allí y los sube a la instancia nueva
 * con la de aquí, conservando ruta y content-type.
 *
 * Es idempotente: `upsert` sobrescribe si ya existe, así que se puede
 * relanzar sin miedo si se corta a medias.
 *
 * Uso:
 *   CLOUD_URL=https://xpdqviimqppprxmblytl.supabase.co \
 *   CLOUD_KEY=<service_role de la nube> \
 *   LOCAL_URL=https://homelab.tailnet.ts.net:8443 \
 *   LOCAL_KEY=<service_role generado> \
 *   node copy-storage.mjs
 */

const need = (k) => process.env[k] || (console.error(`Falta ${k}`), process.exit(1))
const CLOUD = { url: need('CLOUD_URL'), key: need('CLOUD_KEY') }
const LOCAL = { url: need('LOCAL_URL'), key: need('LOCAL_KEY') }

const api = ({ url, key }) => ({
  h: { apikey: key, Authorization: `Bearer ${key}` },
  buckets: async function () {
    const r = await fetch(`${url}/storage/v1/bucket`, { headers: this.h })
    if (!r.ok) throw new Error(`listar buckets ${r.status}: ${await r.text()}`)
    return r.json()
  },
  list: async function (bucket, prefix = '') {
    const out = []
    let offset = 0
    for (;;) {
      const r = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { ...this.h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
      })
      if (!r.ok) throw new Error(`listar ${bucket}/${prefix} ${r.status}`)
      const items = await r.json()
      for (const it of items) {
        const path = prefix ? `${prefix}/${it.name}` : it.name
        // Las "carpetas" vienen sin id; se recorren.
        if (it.id === null) out.push(...(await this.list(bucket, path)))
        else out.push({ path, type: it.metadata?.mimetype })
      }
      if (items.length < 1000) break
      offset += 1000
    }
    return out
  },
  download: async function (bucket, path) {
    const r = await fetch(`${url}/storage/v1/object/${bucket}/${encodeURI(path)}`, { headers: this.h })
    if (!r.ok) throw new Error(`bajar ${bucket}/${path} ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  },
  upload: async function (bucket, path, body, type) {
    const r = await fetch(`${url}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
      method: 'POST',
      headers: { ...this.h, 'Content-Type': type || 'application/octet-stream', 'x-upsert': 'true' },
      body,
    })
    if (!r.ok) throw new Error(`subir ${bucket}/${path} ${r.status}: ${await r.text()}`)
  },
  ensureBucket: async function (b) {
    const r = await fetch(`${url}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...this.h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: b.id, name: b.name, public: b.public, file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types }),
    })
    // 409 = ya existe (lo creó el volcado de storage.sql). Correcto.
    if (!r.ok && r.status !== 409) throw new Error(`crear bucket ${b.id} ${r.status}: ${await r.text()}`)
  },
})

const cloud = api(CLOUD)
const local = api(LOCAL)

let total = 0, bytes = 0
for (const b of await cloud.buckets()) {
  await local.ensureBucket(b)
  const objs = await cloud.list(b.id)
  console.log(`\n${b.id} (${b.public ? 'público' : 'privado'}): ${objs.length} objetos`)
  for (const o of objs) {
    const data = await cloud.download(b.id, o.path)
    await local.upload(b.id, o.path, data, o.type)
    total++; bytes += data.length
    process.stdout.write(`\r  ${total} copiados, ${(bytes / 1e6).toFixed(1)} MB`)
  }
}
console.log(`\n\n✓ ${total} ficheros, ${(bytes / 1e6).toFixed(1)} MB.`)
