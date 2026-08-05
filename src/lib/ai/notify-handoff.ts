import type { SupabaseClient } from '@supabase/supabase-js'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'

/** Cuánto de la consulta del cliente cabe en el aviso. WhatsApp admite
 *  mucho más, pero el aviso se lee en la pantalla de bloqueo: lo útil es
 *  saber de qué va, no leerlo entero. */
const MAX_QUESTION = 300

export interface NotifyHandoffArgs {
  accountId: string
  /** Teléfono que recibe el aviso, tal y como está guardado. */
  notifyPhone: string
  /** Nombre del cliente que se queda esperando. */
  contactName: string
  /** Su última pregunta — la que el agente no supo contestar. */
  question: string
  /** Plantilla aprobada en Meta para cuando la ventana de 24 h está
   *  cerrada. Sin ella solo se intenta el texto libre. */
  templateName?: string | null
  templateLang?: string | null
}

/** Qué acabó pasando. Se devuelve para poder registrarlo y probarlo. */
export type NotifyHandoffResult =
  | { sent: true; via: 'text' | 'template' }
  | { sent: false; reason: string }

/**
 * Avisa por WhatsApp a la persona responsable de que el agente ha
 * traspasado una conversación.
 *
 * Por qué existe: el traspaso ya deja una fila en `notifications`, pero
 * eso es la campanita del CRM. Si nadie tiene la pestaña abierta, el
 * cliente espera y nadie se entera.
 *
 * Dos vías, y el orden importa:
 *
 *   1. Texto libre. Gratis, inmediato y sin nada que aprobar — pero
 *      Meta solo lo entrega dentro de la ventana de 24 h, es decir si
 *      el responsable ha escrito al número del negocio hace menos de
 *      un día.
 *   2. Plantilla aprobada. Siempre se entrega, incluso con la ventana
 *      cerrada, pero se paga por mensaje y hay que darla de alta en
 *      Meta antes.
 *
 * Se intenta la 1 y se cae a la 2 ante *cualquier* fallo, no solo el de
 * la ventana: un aviso que no llega es peor que un aviso de pago, y la
 * lista de motivos por los que Meta rechaza un texto libre es más larga
 * que el error 131047.
 *
 * NUNCA lanza. Esto cuelga del camino del webhook: que no llegue el
 * aviso es malo, pero tumbar la respuesta a Meta es peor.
 */
export async function notifyHandoff(
  db: SupabaseClient,
  args: NotifyHandoffArgs,
): Promise<NotifyHandoffResult> {
  try {
    const to = sanitizePhoneForMeta(args.notifyPhone)
    if (!isValidE164(to)) {
      const reason = `teléfono de aviso inválido: ${args.notifyPhone}`
      console.error('[ai handoff notify]', reason)
      return { sent: false, reason }
    }

    const { data: config, error } = await db
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', args.accountId)
      .maybeSingle()
    if (error || !config) {
      return { sent: false, reason: 'WhatsApp no está configurado en la cuenta' }
    }

    const accessToken = decrypt(config.access_token)
    const phoneNumberId = config.phone_number_id
    const question = truncate(args.question.trim(), MAX_QUESTION)
    const name = args.contactName.trim() || 'Un cliente'

    try {
      await sendTextMessage({
        phoneNumberId,
        accessToken,
        to,
        text: `🔔 ${name} necesita atención — el asistente no pudo resolverlo.\n\n«${question}»\n\nRespóndele desde el CRM.`,
      })
      return { sent: true, via: 'text' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!args.templateName) {
        console.error(
          `[ai handoff notify] texto libre rechazado y no hay plantilla configurada: ${msg}`,
        )
        return { sent: false, reason: msg }
      }
      // La ventana estaba cerrada (o Meta rechazó el texto por otro
      // motivo). Se paga la plantilla antes que perder el aviso.
      console.warn(
        `[ai handoff notify] texto libre rechazado (${msg}) — se envía la plantilla ${args.templateName}`,
      )
      await sendTemplateMessage({
        phoneNumberId,
        accessToken,
        to,
        templateName: args.templateName,
        language: args.templateLang ?? 'es',
        params: [name, question],
      })
      return { sent: true, via: 'template' }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[ai handoff notify] no se pudo avisar:', reason)
    return { sent: false, reason }
  }
}

/** Corta por el último espacio para no partir una palabra por la mitad. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + '…'
}
