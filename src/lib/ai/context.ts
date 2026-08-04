import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
}

/** Media kinds a customer can send that the model cannot look at. */
const MEDIA_TYPES = new Set(['image', 'video', 'document', 'audio', 'sticker'])

/** Human-readable noun per media kind, used in the attachment marker. */
const MEDIA_LABEL: Record<string, string> = {
  image: 'an image',
  video: 'a video',
  document: 'a document',
  audio: 'a voice note',
  sticker: 'a sticker',
}

/**
 * Render one row as the text the model sees.
 *
 * Text messages pass through unchanged. Media messages become an
 * explicit marker plus their caption, because the model has no vision
 * and never receives the file itself: without the marker it cannot tell
 * that the customer answered at all, and it re-asks the question it
 * just asked. The caption alone is not enough either — "Con esta
 * medida" reads as a non-sequitur unless the model knows a picture came
 * with it.
 */
function renderRow(m: DbMessage): string | null {
  const caption = m.content_text?.trim() ?? ''

  if (m.content_type === 'text') {
    return caption || null
  }

  if (MEDIA_TYPES.has(m.content_type)) {
    const label = MEDIA_LABEL[m.content_type] ?? 'a file'
    const marker = `[the customer sent ${label} — you cannot see it]`
    return caption ? `${marker} ${caption}` : marker
  }

  // Templates, interactive replies, locations, contacts: no useful text.
  return null
}

/**
 * Fetch the last N messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`.
 *
 * Media messages are included as a marker (see `renderRow`) rather than
 * dropped. Dropping them made the assistant blind to any turn where the
 * customer answered with a photo — common when the answer *is* the
 * artwork — so it repeated its previous question verbatim.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .map((m) => ({ row: m, text: renderRow(m) }))
    .filter((x): x is { row: DbMessage; text: string } => x.text !== null)
    .map(({ row, text }) => ({
      role: row.sender_type === 'customer' ? 'user' : 'assistant',
      content: text,
    }))
}
