import { PASTE_ID_RE } from '#shared/schemas/paste'

defineRouteMeta({
  openAPI: {
    description: 'Get a single clipboard entry (full content + metadata)',
    security: [{ bearerAuth: [] }],
  },
})

export default eventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !PASTE_ID_RE.test(id))
    throw createError({ status: 400, statusText: 'Invalid id' })

  const record = await getPasteRecord(event, id)
  if (!record)
    throw createError({ status: 404, statusText: 'Paste not found' })

  // Private content: never cache. Never return the password hash or the raw bytes (the owner
  // viewer loads a file from /raw with the site token).
  setHeader(event, 'Cache-Control', 'no-store')
  return {
    paste: {
      id: record.id,
      kind: record.kind,
      lang: record.lang,
      title: record.title,
      createdAt: record.createdAt,
      expiration: record.expiration,
      burn: record.burn,
      hasPassword: !!record.password,
      size: record.size,
      mime: record.mime,
      filename: record.filename,
      content: record.kind === 'text' ? record.content : undefined,
    },
  }
})
