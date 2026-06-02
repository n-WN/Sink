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

  const paste = await getPaste(event, id)
  if (!paste)
    throw createError({ status: 404, statusText: 'Paste not found' })

  // Private content: never cache. Strip the password hash (expose only a boolean) and any
  // legacy readKey left on old KV entries (no longer used; id-only access now).
  setHeader(event, 'Cache-Control', 'no-store')
  const { password, readKey, ...rest } = paste as typeof paste & { readKey?: string }
  void readKey
  return { paste: { ...rest, hasPassword: !!password } }
})
