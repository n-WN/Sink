import { z } from 'zod'
import { PASTE_ID_RE, READ_PASSWORD_MAX } from '#shared/schemas/paste'

// Public, read-key-gated content endpoint behind the /s/:id share page. Returns just enough
// to render the snippet (no readKey, no password hash). The read key and optional password
// travel in the POST body (not the URL) to avoid extra exposure in logs/referers.
defineRouteMeta({
  openAPI: {
    description: 'Fetch a shared snippet for the public render view. Authorized by the per-snippet '
      + 'read key (and read password if set); no site token required.',
  },
})

const ShareBodySchema = z.object({
  k: z.string().trim().max(64),
  password: z.string().max(READ_PASSWORD_MAX).optional(),
})

export default eventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !PASTE_ID_RE.test(id))
    throw createError({ status: 400, statusText: 'Invalid id' })

  const { k, password } = await readValidatedBody(event, ShareBodySchema.parse)

  const paste = await getPaste(event, id)
  if (!paste)
    throw createError({ status: 404, statusText: 'Paste not found' })

  if (!safeEqual(k, paste.readKey))
    throw createError({ status: 401, statusText: 'Unauthorized' })

  if (paste.password) {
    if (!password || !await verifyLinkPassword(password, paste.password))
      throw createError({ status: 401, statusText: 'Password required', data: { hasPassword: true } })
  }

  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')

  const result = {
    id: paste.id,
    content: paste.content,
    lang: paste.lang,
    title: paste.title,
    burn: paste.burn,
    hasPassword: !!paste.password,
    expiration: paste.expiration,
  }

  // Burn after reading: destroy on the first successful read-key delivery (same rule as raw).
  if (paste.burn)
    await deletePaste(event, id)

  return result
})
