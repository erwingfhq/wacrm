import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: h.sendTextMessage,
  sendTemplateMessage: h.sendTemplateMessage,
}))
// The stored token is encrypted; the notifier just needs it decrypted.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { notifyHandoff } from './notify-handoff'

/** Fake matching `.from('whatsapp_config').select().eq().maybeSingle()`. */
function fakeDb(config: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: config, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const CONFIG = { phone_number_id: 'pn-1', access_token: 'enc-token' }

const ARGS = {
  accountId: 'acct-1',
  notifyPhone: '13475576460',
  contactName: 'Ana',
  question: '¿cuánto cuesta un banner 24x36?',
  templateName: 'handoff_alert',
  templateLang: 'es',
}

beforeEach(() => {
  h.sendTextMessage.mockReset().mockResolvedValue({ messageId: 'wamid.1' })
  h.sendTemplateMessage.mockReset().mockResolvedValue({ messageId: 'wamid.2' })
})

describe('notifyHandoff', () => {
  it('sends free-form first — it is free and needs no approval', async () => {
    const out = await notifyHandoff(fakeDb(CONFIG), ARGS)
    expect(out).toEqual({ sent: true, via: 'text' })
    expect(h.sendTemplateMessage).not.toHaveBeenCalled()

    const sent = h.sendTextMessage.mock.calls[0][0]
    expect(sent).toMatchObject({
      phoneNumberId: 'pn-1',
      accessToken: 'plain:enc-token',
      to: '13475576460',
    })
    expect(sent.text).toContain('Ana')
    expect(sent.text).toContain('banner 24x36')
  })

  // Meta rejects free-form once the 24h window shuts. That is the whole
  // reason the template path exists.
  it('falls back to the template when free-form is rejected', async () => {
    h.sendTextMessage.mockRejectedValue(
      new Error('(#131047) Message failed to send because more than 24 hours have passed'),
    )
    const out = await notifyHandoff(fakeDb(CONFIG), ARGS)
    expect(out).toEqual({ sent: true, via: 'template' })
    expect(h.sendTemplateMessage).toHaveBeenCalledTimes(1)
    expect(h.sendTemplateMessage.mock.calls[0][0]).toMatchObject({
      templateName: 'handoff_alert',
      language: 'es',
      params: ['Ana', '¿cuánto cuesta un banner 24x36?'],
    })
  })

  it('reports failure when free-form fails and no template is configured', async () => {
    h.sendTextMessage.mockRejectedValue(new Error('window closed'))
    const out = await notifyHandoff(fakeDb(CONFIG), {
      ...ARGS,
      templateName: null,
    })
    expect(out).toEqual({ sent: false, reason: 'window closed' })
    expect(h.sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('never throws when the template send also fails', async () => {
    h.sendTextMessage.mockRejectedValue(new Error('window closed'))
    h.sendTemplateMessage.mockRejectedValue(new Error('template not approved'))
    const out = await notifyHandoff(fakeDb(CONFIG), ARGS)
    expect(out).toEqual({ sent: false, reason: 'template not approved' })
  })

  it('rejects an invalid phone without calling Meta', async () => {
    const out = await notifyHandoff(fakeDb(CONFIG), {
      ...ARGS,
      notifyPhone: 'no-es-un-telefono',
    })
    expect(out.sent).toBe(false)
    expect(h.sendTextMessage).not.toHaveBeenCalled()
  })

  it('gives up quietly when WhatsApp is not configured', async () => {
    const out = await notifyHandoff(fakeDb(null), ARGS)
    expect(out).toEqual({
      sent: false,
      reason: 'WhatsApp no está configurado en la cuenta',
    })
    expect(h.sendTextMessage).not.toHaveBeenCalled()
  })

  it('trims a long question at a word boundary', async () => {
    const largo = 'palabra '.repeat(80).trim()
    await notifyHandoff(fakeDb(CONFIG), { ...ARGS, question: largo })
    const { text } = h.sendTextMessage.mock.calls[0][0]
    expect(text).toContain('…')
    expect(text).not.toContain('palab\n')
    // 300 chars of question + the surrounding copy, nowhere near the
    // 4096 WhatsApp limit.
    expect(text.length).toBeLessThan(500)
  })

  it('uses a placeholder when the contact has no name at all', async () => {
    await notifyHandoff(fakeDb(CONFIG), { ...ARGS, contactName: '   ' })
    expect(h.sendTextMessage.mock.calls[0][0].text).toContain('Un cliente')
  })
})
