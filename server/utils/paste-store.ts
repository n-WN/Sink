import type { H3Event } from 'h3'
import type { Paste, PasteListItem, PasteMeta, PasteRecord } from '#shared/schemas/paste'
import { ANON_DAILY_CREATE_CAP, MAX_ACTIVE_PASTES } from '#shared/schemas/paste'

const PASTE_PREFIX = 'paste:'

// Best-effort per-UTC-day cap on anonymous creates (KV is not atomic, so a burst can
// overshoot slightly — acceptable). Returns true if the day's cap is already reached; else
// increments the counter and returns false. The site-token owner should not call this.
export async function anonDailyCreateCapReached(event: H3Event): Promise<boolean> {
  const { KV } = event.context.cloudflare.env
  const day = new Date().toISOString().slice(0, 10)
  const key = `paste:create:day:${day}`
  const current = Number(await KV.get(key)) || 0
  if (current >= ANON_DAILY_CREATE_CAP)
    return true
  await KV.put(key, String(current + 1), { expirationTtl: 2 * 24 * 3600 })
  return false
}

export interface FilePasteInput {
  id: string
  bytes: ArrayBuffer
  mime: string
  filename?: string
  title?: string
  createdAt: number
  expiration: number
  burn: boolean
  password?: string // PBKDF2 hash
}

// True when there are already MAX_ACTIVE_PASTES live snippets (one cheap list op).
// Guards the free-tier KV budget against a runaway client filling storage.
// Count the keys directly: when exactly MAX exist, `list_complete` is still true (the page
// is full but there is no next page), so checking key count avoids an off-by-one.
export async function pasteCapReached(event: H3Event): Promise<boolean> {
  const { KV } = event.context.cloudflare.env
  const list = await KV.list({ prefix: PASTE_PREFIX, limit: MAX_ACTIVE_PASTES })
  return list.keys.length >= MAX_ACTIVE_PASTES
}

export async function putPaste(event: H3Event, paste: Paste): Promise<void> {
  const metadata: PasteMeta = {
    kind: 'text',
    lang: paste.lang,
    title: paste.title,
    createdAt: paste.createdAt,
    expiration: paste.expiration,
    size: paste.content.length,
    burn: paste.burn || undefined,
    hasPassword: paste.password ? true : undefined,
  }
  await kvPutJson(event, 'paste', paste.id, paste, { expiration: paste.expiration, metadata })
}

export async function putFilePaste(event: H3Event, file: FilePasteInput): Promise<void> {
  const metadata: PasteMeta = {
    kind: 'file',
    lang: 'text',
    title: file.title,
    createdAt: file.createdAt,
    expiration: file.expiration,
    size: file.bytes.byteLength,
    burn: file.burn || undefined,
    hasPassword: file.password ? true : undefined,
    mime: file.mime,
    filename: file.filename,
    passwordHash: file.password, // file bodies are bytes, so the hash lives in metadata
  }
  await kvPutBytes(event, 'paste', file.id, file.bytes, { expiration: file.expiration, metadata })
}

// Reads a paste of either kind into a normalized record. Reads the body as bytes: text bodies
// are JSON (decode + parse); file bodies are the raw bytes. Legacy entries (no kind) are text.
export async function getPasteRecord(event: H3Event, id: string): Promise<PasteRecord | null> {
  const { value, metadata } = await kvGetBytesWithMetadata<PasteMeta>(event, 'paste', id)
  if (!value)
    return null
  const meta = metadata ?? ({} as PasteMeta)

  if (meta.kind === 'file') {
    return {
      id,
      kind: 'file',
      lang: 'text',
      title: meta.title,
      createdAt: meta.createdAt ?? 0,
      expiration: meta.expiration ?? 0,
      burn: !!meta.burn,
      password: meta.passwordHash,
      size: meta.size ?? value.byteLength,
      mime: meta.mime,
      filename: meta.filename,
      bytes: value,
    }
  }

  const paste = JSON.parse(new TextDecoder().decode(value)) as Paste
  return {
    id: paste.id,
    kind: 'text',
    lang: paste.lang,
    title: paste.title,
    createdAt: paste.createdAt,
    expiration: paste.expiration,
    burn: !!paste.burn,
    password: paste.password,
    size: paste.content.length,
    content: paste.content,
  }
}

export async function deletePaste(event: H3Event, id: string): Promise<void> {
  await kvDelete(event, 'paste', id)
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
      kind: meta.kind ?? 'text',
      lang: meta.lang ?? 'text',
      title: meta.title,
      createdAt: meta.createdAt ?? 0,
      expiration: meta.expiration ?? 0,
      size: meta.size ?? 0,
      burn: meta.burn,
      hasPassword: meta.hasPassword,
      mime: meta.mime,
      filename: meta.filename,
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
