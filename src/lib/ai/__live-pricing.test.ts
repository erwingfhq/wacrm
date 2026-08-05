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
  /** Idioma en el que escribió el cliente. El agente debe responder en
   *  el mismo: un precio correcto en el idioma equivocado sigue siendo
   *  una mala respuesta. */
  idioma?: 'es' | 'en'
  /** Turnos previos de la conversación. El fallo que motivó todo esto
   *  ocurrió en el tercer turno: con un precio anterior ya en el
   *  contexto, el modelo lo reutilizó en vez de buscar el nuevo. Un
   *  caso de un solo turno no lo habría detectado nunca. */
  contexto?: ChatMessage[]
  /** Para turnos donde repetir el importe no es obligatorio (una
   *  explicación, una repregunta). Lo que se exige es que NO aparezca
   *  ningún importe distinto de éste: callarlo es correcto,
   *  contradecirse no. */
  sinContradecir?: string
}

/** Todos los importes en dólares que aparecen en un texto. */
const IMPORTES = (t: string) =>
  [...t.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)].map((m) =>
    m[1].replace(/[,.]00$/, '').replace(/,/g, ''),
  )

/** Palabras que solo aparecen en una de las dos lenguas y que el modelo
 *  usa de forma natural al cotizar. Basta para detectar un cambio de
 *  idioma sin montar un detector completo. */
const MARCAS_EN = /\b(square feet|that is|the price|is \$|banner is)\b/i

const CASOS: Caso[] = [
  // En la tabla: leer, nunca calcular.
  { nombre: 'tabla 24x36" → $48', pregunta: 'me gustaria saber que costo tiene un banner 24x36”', espera: '48', idioma: 'es' },
  // La regresión de producción: cotizó $256 copiando el ejemplo de 4x8.
  { nombre: 'tabla 48x72" → $192', pregunta: 'que me cuesta un banner 48x72?', espera: '192', idioma: 'es' },
  { nombre: 'tabla 4x8 ft → $256', pregunta: 'how much for a 4ft x 8ft vinyl banner?', espera: '256', idioma: 'en' },
  { nombre: 'tabla 3x6 ft → $144', pregunta: 'precio de un banner de 3x6 pies', espera: '144', idioma: 'es' },
  { nombre: 'tabla 60x120" → $400', pregunta: 'cuanto sale un banner de 60x120 pulgadas', espera: '400', idioma: 'es' },
  // Lados invertidos: es la misma medida.
  { nombre: 'tabla 72x48" (invertida) → $192', pregunta: 'y un banner de 72x48 pulgadas?', espera: '192', idioma: 'es' },
  // Fuera de la tabla: ahora traspasa en vez de inventarse la cuenta.
  { nombre: '20x30" fuera de tabla → traspaso', pregunta: 'cuanto vale un banner de 20x30 pulgadas', espera: null },
  { nombre: '30x40" fuera de tabla → traspaso', pregunta: 'y uno de 30x40 pulgadas?', espera: null },
  { nombre: '5x7 ft fuera de tabla → traspaso', pregunta: 'necesito un banner de 5 por 7 pies, cuanto es', espera: null },
  // Reproducción exacta del fallo de producción: tras cotizar un 24x36,
  // el modelo cotizó el 48x72 a $256 copiando un importe que ya había
  // visto. Debe dar $192.
  {
    nombre: 'multiturno: no reutiliza el precio anterior',
    pregunta: 'y otro banner 48x72',
    espera: '192',
    idioma: 'es',
    contexto: [
      { role: 'user', content: 'me gustaria saber que costo tiene un banner 24x36”' },
      { role: 'assistant', content: 'Un banner impreso de 24" x 36" cuesta $48.00.' },
    ],
  },
  // Y la repregunta incrédula que vino después, que es cuando más tienta
  // ajustar el número para que "cuadre".
  {
    nombre: 'multiturno: mantiene el precio al ser cuestionado',
    pregunta: 'y porque si el banner 24x36 vale $48.00 porque este vale tanto?',
    espera: null,
    sinContradecir: '192',
    idioma: 'es',
    contexto: [
      { role: 'user', content: 'me gustaria saber que costo tiene un banner 24x36”' },
      { role: 'assistant', content: 'Un banner impreso de 24" x 36" cuesta $48.00.' },
      { role: 'user', content: 'y otro banner 48x72' },
      { role: 'assistant', content: 'Un banner impreso de 48" x 72" cuesta $192.00.' },
    ],
  },
  // Los que nunca se cotizan.
  { nombre: 'bajo el mínimo → traspaso', pregunta: 'un banner chiquito de 10x12 pulgadas cuanto sale', espera: null },
  { nombre: 'trabajo a medida → traspaso', pregunta: 'cuanto cuestan unas channel letters para mi local', espera: null },
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
      const messages: ChatMessage[] = [
        ...(caso.contexto ?? []),
        { role: 'user', content: caso.pregunta },
      ]
      const { text, handoff } = await generateReply({ config, systemPrompt, messages })
      const salida = handoff ? '[[TRASPASO]]' : text
      console.log(`\n### ${caso.nombre}\n> ${caso.pregunta}\n< ${salida}`)

      if (caso.sinContradecir) {
        const otros = IMPORTES(text ?? '').filter((v) => v !== caso.sinContradecir)
        if (otros.length) {
          fallos.push(
            `${caso.nombre}: no debía dar otro importe que $${caso.sinContradecir} y dijo $${otros.join(', $')} — «${text}»`,
          )
        }
        continue
      }
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
        continue
      }
      if (caso.idioma === 'es' && MARCAS_EN.test(text ?? '')) {
        fallos.push(`${caso.nombre}: el cliente escribió en español y contestó en inglés — «${text}»`)
      }
    }

    expect(fallos, `\n- ${fallos.join('\n- ')}\n`).toEqual([])
  })
})
