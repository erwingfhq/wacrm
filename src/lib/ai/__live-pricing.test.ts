/**
 * Comprobación EN VIVO de la política de precios del agente.
 *
 * Por qué no es un test normal: el prompt de precios no vive en el
 * código, vive en `ai_configs.system_prompt` en la base de datos. Un
 * test unitario no puede verlo. Esto llama a OpenAI con la clave real
 * de la cuenta y comprueba lo único que importa de verdad: que ante la
 * pregunta de un cliente salga el número correcto.
 *
 * Cuesta unos céntimos por ejecución, así que está FUERA de la suite:
 * `vitest.config.ts` excluye `__live-*` explícitamente (y además inyecta
 * secretos falsos que no descifrarían nada). Se ejecuta a mano:
 *
 *   npx vitest run --config vitest.live.config.ts
 *
 * Al añadir una tarifa nueva al prompt, añade aquí su caso — y un caso
 * que NO deba cotizarse. Los dos lados importan: un agente que cotiza
 * de más es tan caro como uno que traspasa todo.
 */
import { describe, it, expect } from 'vitest'
import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildSystemPrompt } from './defaults'
import { generateReply } from './generate'
import type { ChatMessage } from './types'

const ACCOUNT = '253763aa-906e-4038-ab08-3dbc3dce96a5'

interface Caso {
  nombre: string
  pregunta: string
  /** Importe que debe aparecer en la respuesta, o `null` si el caso
   *  debe acabar en traspaso a un humano. */
  espera: string | null
}

const CASOS: Caso[] = [
  // Tarifa calculada: $8.00/pie², redondeando hacia arriba al pie entero.
  { nombre: 'banner 24x36" → 6 pie²', pregunta: 'me gustaria saber que costo tiene un banner 24x36”', espera: '48' },
  { nombre: 'banner 4x8 ft → 32 pie²', pregunta: 'how much for a 4ft x 8ft vinyl banner?', espera: '256' },
  { nombre: 'banner 20x30" → 4.17 redondea a 5', pregunta: 'cuanto vale un banner de 20x30 pulgadas', espera: '40' },
  // Los dos que NO debe cotizar.
  { nombre: 'banner bajo el mínimo', pregunta: 'un banner chiquito de 10x12 pulgadas cuanto sale', espera: null },
  { nombre: 'trabajo a medida', pregunta: 'cuanto cuestan unas channel letters para mi local', espera: null },
]

describe('política de precios (en vivo)', () => {
  it('cotiza las tarifas publicadas y traspasa todo lo demás', async () => {
    const config = await loadAiConfig(supabaseAdmin(), ACCOUNT)
    if (!config) throw new Error('la cuenta no tiene configuración de IA')

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge: [],
    })

    const fallos: string[] = []

    for (const caso of CASOS) {
      const messages: ChatMessage[] = [{ role: 'user', content: caso.pregunta }]
      const { text, handoff } = await generateReply({ config, systemPrompt, messages })
      const salida = handoff ? '[[TRASPASO]]' : text
      console.log(`\n### ${caso.nombre}\n> ${caso.pregunta}\n< ${salida}`)

      if (caso.espera === null) {
        if (!handoff) fallos.push(`${caso.nombre}: debía traspasar y respondió «${text}»`)
        continue
      }
      if (handoff) {
        fallos.push(`${caso.nombre}: debía cotizar $${caso.espera} y traspasó`)
        continue
      }
      // El importe, no una cifra cualquiera: $48 / $48.00 / 48.00 valen,
      // pero "480" o "4.80" no.
      const re = new RegExp(`\\$?\\b${caso.espera}(\\.00)?\\b`)
      if (!re.test(text ?? '')) {
        fallos.push(`${caso.nombre}: esperaba $${caso.espera} y dijo «${text}»`)
      }
    }

    expect(fallos, `\n- ${fallos.join('\n- ')}\n`).toEqual([])
  })
})
