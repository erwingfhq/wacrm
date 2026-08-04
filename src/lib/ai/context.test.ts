import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

/** Shorthand for a plain text row. */
const text = (sender_type: string, content_text: string | null) => ({
  sender_type,
  content_type: 'text',
  content_text,
})

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      text('customer', 'third'),
      text('agent', 'second'),
      text('customer', 'first'),
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([text('bot', 'auto reply')]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only text messages', async () => {
    const out = await buildConversationContext(
      fakeDb([text('customer', '   '), text('customer', null), text('customer', 'real')]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  // The assistant has no vision and never receives the file. Media used
  // to be dropped entirely, which made it blind to any turn where the
  // customer answered with a photo — it then repeated its previous
  // question verbatim. These cases pin the marker that fixes that.
  it('keeps a media message with its caption, flagged as unviewable', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_type: 'image',
          content_text: 'Con esta medida',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      {
        role: 'user',
        content: '[the customer sent an image — you cannot see it] Con esta medida',
      },
    ])
  })

  it('keeps a media message with no caption as a bare marker', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'document', content_text: null },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: '[the customer sent a document — you cannot see it]' },
    ])
  })

  it('drops non-media, non-text kinds that carry no useful text', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'location', content_text: null },
        { sender_type: 'customer', content_type: 'interactive', content_text: null },
        text('customer', 'real'),
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })
})
