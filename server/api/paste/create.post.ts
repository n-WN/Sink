import { CreatePasteSchema, DEFAULT_PASTE_TTL, MAX_FILE_SIZE, MAX_PASTE_TTL, MIN_PASTE_TTL, pasteId, PasteSchema, READ_PASSWORD_MAX } from '#shared/schemas/paste'

// A valid-ish MIME type; anything else is stored as application/octet-stream (which is never
// served inline), so a junk/CRLF Content-Type can't reach the response header.
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/

defineRouteMeta({
  openAPI: {
    description: 'Create a temporary clipboard entry. JSON body = a text snippet; '
      + 'multipart/form-data with a `file` field = a file/image. Auto-expires after its TTL.',
    security: [{ bearerAuth: [] }],
  },
})

function clampTtl(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n))
    return DEFAULT_PASTE_TTL
  return Math.min(MAX_PASTE_TTL, Math.max(MIN_PASTE_TTL, Math.trunc(n)))
}

export default eventHandler(async (event) => {
  const contentType = getHeader(event, 'content-type') || ''
  const createdAt = Math.floor(Date.now() / 1000)

  // ---- File / image upload (multipart) ----
  if (contentType.includes('multipart/form-data')) {
    // Require a sane Content-Length and reject oversized bodies before buffering them.
    const declared = Number(getHeader(event, 'content-length'))
    if (!Number.isFinite(declared))
      throw createError({ status: 411, statusText: 'Length Required' })
    if (declared > MAX_FILE_SIZE + 16 * 1024)
      throw createError({ status: 413, statusText: 'File too large' })

    const form = await readMultipartFormData(event)
    const fileParts = (form || []).filter(p => p.name === 'file' && p.filename)
    if (fileParts.length !== 1)
      throw createError({ status: 400, statusText: 'Exactly one file is required' })
    const filePart = fileParts[0]
    if (filePart.data.byteLength === 0)
      throw createError({ status: 400, statusText: 'Empty file' })
    if (filePart.data.byteLength > MAX_FILE_SIZE)
      throw createError({ status: 413, statusText: 'File too large' })

    const field = (name: string): string | undefined => {
      const part = form?.find(p => p.name === name && !p.filename)
      return part ? new TextDecoder().decode(part.data) : undefined
    }

    if (await pasteCapReached(event))
      throw createError({ status: 429, statusText: 'Too many active snippets' })

    const expiration = createdAt + clampTtl(field('ttl'))
    const password = field('password')?.slice(0, READ_PASSWORD_MAX) || undefined
    const id = pasteId()
    // Copy into a standalone ArrayBuffer (the multipart buffer may be a view over a pool).
    const bytes = filePart.data.buffer.slice(filePart.data.byteOffset, filePart.data.byteOffset + filePart.data.byteLength)
    // Validate the MIME and keep names short so the KV metadata stays under its 1024-byte cap.
    const rawMime = (filePart.type || '').trim()
    const mime = MIME_RE.test(rawMime) ? rawMime.slice(0, 100) : 'application/octet-stream'
    const filename = filePart.filename?.slice(0, 100) || undefined
    const title = field('title')?.slice(0, 100) || undefined

    await putFilePaste(event, {
      id,
      bytes,
      mime,
      filename,
      title,
      createdAt,
      expiration,
      burn: field('burn') === 'true',
      password: password ? await hashLinkPassword(password) : undefined,
    })

    setResponseStatus(event, 201)
    return {
      paste: {
        id,
        kind: 'file',
        lang: 'text',
        title,
        createdAt,
        expiration,
        size: filePart.data.byteLength,
        mime,
        filename,
        burn: field('burn') === 'true' || undefined,
        hasPassword: password ? true : undefined,
      },
    }
  }

  // ---- Text snippet (JSON) ----
  const input = await readValidatedBody(event, CreatePasteSchema.parse)

  if (await pasteCapReached(event))
    throw createError({ status: 429, statusText: 'Too many active snippets' })

  const expiration = createdAt + (input.ttl ?? DEFAULT_PASTE_TTL)

  const paste = PasteSchema.parse({
    id: pasteId(),
    content: input.content,
    lang: input.lang || 'text',
    title: input.title,
    createdAt,
    expiration,
    burn: input.burn ?? false,
    password: input.password ? await hashLinkPassword(input.password) : undefined,
  })

  await putPaste(event, paste)

  setResponseStatus(event, 201)
  return {
    paste: {
      id: paste.id,
      kind: 'text',
      lang: paste.lang,
      title: paste.title,
      createdAt: paste.createdAt,
      expiration: paste.expiration,
      size: paste.content.length,
      burn: paste.burn || undefined,
      hasPassword: paste.password ? true : undefined,
    },
  }
})
