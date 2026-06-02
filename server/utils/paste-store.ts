import type { H3Event } from 'h3'
import type { Paste, PasteListItem, PasteMeta } from '#shared/schemas/paste'

const PASTE_PREFIX = 'paste:'

export async function putPaste(event: H3Event, paste: Paste): Promise<void> {
  const { KV } = event.context.cloudflare.env
  const metadata: PasteMeta = {
    lang: paste.lang,
    title: paste.title,
    createdAt: paste.createdAt,
    expiration: paste.expiration,
    size: paste.content.length,
    burn: paste.burn || undefined,
    hasPassword: paste.password ? true : undefined,
  }
  await KV.put(`${PASTE_PREFIX}${paste.id}`, JSON.stringify(paste), {
    expiration: paste.expiration,
    metadata,
  })
}

export async function getPaste(event: H3Event, id: string): Promise<Paste | null> {
  const { KV } = event.context.cloudflare.env
  return await KV.get(`${PASTE_PREFIX}${id}`, { type: 'json' }) as Paste | null
}

export async function deletePaste(event: H3Event, id: string): Promise<void> {
  const { KV } = event.context.cloudflare.env
  await KV.delete(`${PASTE_PREFIX}${id}`)
}

interface ListPastesResult {
  pastes: PasteListItem[]
  list_complete: boolean
  cursor?: string
}

// Lists pastes using only KV key metadata — bodies are never fetched, so this stays
// within the free-tier read budget even with many snippets.
export async function listPastes(event: H3Event, options: { limit: number, cursor?: string }): Promise<ListPastesResult> {
  const { KV } = event.context.cloudflare.env
  const list = await KV.list<PasteMeta>({
    prefix: PASTE_PREFIX,
    limit: options.limit,
    cursor: options.cursor || undefined,
  })

  const pastes = (list.keys || []).map((key) => {
    const meta = (key.metadata ?? {}) as Partial<PasteMeta>
    return {
      id: key.name.slice(PASTE_PREFIX.length),
      lang: meta.lang ?? 'text',
      title: meta.title,
      createdAt: meta.createdAt ?? 0,
      expiration: meta.expiration ?? 0,
      size: meta.size ?? 0,
      burn: meta.burn,
      hasPassword: meta.hasPassword,
    } satisfies PasteListItem
  })

  // Newest first.
  pastes.sort((a, b) => b.createdAt - a.createdAt)

  return {
    pastes,
    list_complete: list.list_complete,
    cursor: 'cursor' in list ? list.cursor : undefined,
  }
}
