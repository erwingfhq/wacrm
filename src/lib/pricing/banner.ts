/**
 * Precio de banner de vinilo impreso, calculado de forma determinista.
 *
 * Por qué existe: se midió al agente cotizando banners con cuatro
 * formatos distintos de prompt —fórmula con ejemplos, tabla agrupada,
 * matriz simétrica y lista plana— y todos produjeron algún importe
 * equivocado: $256 por un 48x72" (son $192), $88 por un 20x30" (son
 * $40), $640 por un 60x120" (son $400). Prohibirle calcular tampoco
 * funciona: lo hace igual. Un precio inventado va directo a un cliente.
 *
 * Así que el modelo deja de decidir el número. Aquí se detecta la medida
 * en el mensaje y se calcula el importe; el agente solo lo transmite.
 */

/** Tarifa por pie cuadrado, con dobladillo y ojales incluidos. */
export const BANNER_RATE_PER_SQFT = 8

/** Por debajo de esto no se cotiza: aplica un cargo mínimo que aún no
 *  está definido, así que la consulta se traspasa a un humano. */
export const BANNER_MIN_SQFT = 6

export interface BannerSize {
  width: number
  height: number
  unit: 'in' | 'ft'
}

export interface BannerQuote {
  size: BannerSize
  /** Pies cuadrados redondeados hacia arriba al entero. */
  sqft: number
  /** Importe en dólares. */
  price: number
}

/**
 * Unidades tal y como las escribe un cliente real, en los dos idiomas.
 * Se enumeran dentro del propio patrón en vez de capturar «una palabra»
 * y comprobarla después: capturando cualquier palabra, `24x36 y otro de
 * 48x72` tomaba la «y» como unidad y descartaba la primera medida.
 */
const UNIT_RE = String.raw`(?:ft\b|foot\b|feet\b|f\b|pies\b|pie\b|in\b|inch\b|inches\b|pulgadas\b|pulgada\b|pulg\b|pg\b|"|”|'')`

const FEET = /^(ft|foot|feet|f|pies?|pie)$/i

/**
 * Extrae una medida de un mensaje. Devuelve null si no hay ninguna, o si
 * hay más de una (dos medidas en un mensaje son una conversación para un
 * humano, no algo que cotizar a ciegas).
 *
 * Acepta lo que escribe la gente: `24x36`, `24 x 36"`, `48x72 pulgadas`,
 * `4ft x 8ft`, `5 por 7 pies`, `3 pies x 6 pies`.
 *
 * Sin unidad explícita: si algún número pasa de 12 son pulgadas, porque
 * nadie encarga un banner de 20 pies de lado por WhatsApp sin decirlo.
 * Si los dos son pequeños (`4x8`) es genuinamente ambiguo —4x8 pies son
 * $256.00 y 4x8 pulgadas no llegan al mínimo— y se devuelve null para
 * que lo vea un humano. Adivinar aquí cuesta dinero; preguntar, un
 * minuto.
 */
/**
 * Un banner tiene un tamaño físico razonable, y eso descarta parejas de
 * números que solo parecían una medida: `llamame al 347 por 5 minutos`
 * encaja con el patrón perfectamente. Los límites son deliberadamente
 * anchos —de medio pie a treinta— porque su trabajo es filtrar
 * disparates, no decidir qué se puede fabricar.
 */
const MIN_SIDE_IN = 6
const MAX_SIDE_IN = 360

function isPlausibleBanner(size: BannerSize): boolean {
  const factor = size.unit === 'in' ? 1 : 12
  return [size.width, size.height].every((side) => {
    const inches = side * factor
    return inches >= MIN_SIDE_IN && inches <= MAX_SIDE_IN
  })
}

export function parseBannerSize(text: string): BannerSize | null {
  const re = new RegExp(
    String.raw`(\d+(?:\.\d+)?)\s*` + UNIT_RE + '?' +
      String.raw`\s*(?:x|×|por|by)\s*(\d+(?:\.\d+)?)\s*` + UNIT_RE + '?',
    'gi',
  )
  // Se recuperan las unidades aparte: el patrón las delimita, pero
  // interesa cuál de las dos apareció, no solo que hubiera una.
  const unitAt = (s: string): 'in' | 'ft' | null => {
    const t = s.trim().replace(/[.]$/, '')
    if (!t) return null
    return FEET.test(t) ? 'ft' : 'in'
  }

  const found: BannerSize[] = []
  for (const m of text.matchAll(re)) {
    const w = Number(m[1])
    const h = Number(m[2 + 1] ?? m[2])
    if (!(w > 0) || !(h > 0)) continue

    // La unidad puede venir tras cualquiera de los dos números: tanto
    // "48x72 pulgadas" como "4ft x 8ft" son habituales.
    const raw = m[0].match(new RegExp(UNIT_RE, 'i'))?.[0] ?? ''
    const unit = unitAt(raw)
    if (!unit && w <= 12 && h <= 12) continue // ambiguo → que lo vea un humano

    const size: BannerSize = { width: w, height: h, unit: unit ?? 'in' }
    if (!isPlausibleBanner(size)) continue

    found.push(size)
  }

  return found.length === 1 ? found[0] : null
}

/**
 * Calcula el importe. Redondea hacia arriba al pie cuadrado entero, que
 * es como se cobra en el sector y nunca cotiza por debajo del coste.
 * Devuelve null por debajo del mínimo — ese caso se traspasa.
 */
export function quoteBanner(size: BannerSize): BannerQuote | null {
  const factor = size.unit === 'in' ? 1 / 12 : 1
  const sqft = Math.ceil(size.width * factor * size.height * factor)
  if (sqft < BANNER_MIN_SQFT) return null
  return { size, sqft, price: sqft * BANNER_RATE_PER_SQFT }
}

/**
 * Detecta la medida en el mensaje del cliente y devuelve la frase que se
 * le entrega al modelo como hecho ya resuelto. Null cuando no hay medida
 * o cae bajo el mínimo, y entonces el agente traspasa como siempre.
 *
 * Se redacta en inglés porque es el idioma del resto del prompt; el
 * agente traduce al idioma del cliente al responder.
 */
export function bannerPriceFact(customerMessage: string): string | null {
  const size = parseBannerSize(customerMessage)
  if (!size) return null
  const quote = quoteBanner(size)
  if (!quote) return null

  const u = size.unit === 'in' ? '"' : ' ft'
  return (
    `BANNER PRICE, already calculated for you — do not recompute it, ` +
    `do not adjust it, quote it exactly as written: a printed vinyl ` +
    `banner of ${size.width}${u} x ${size.height}${u} is ${quote.sqft} ` +
    `square feet and costs $${quote.price.toFixed(2)}, hemming and ` +
    `grommets included. Shipping and installation are extra. This price ` +
    `is for ONE banner.`
  )
}
