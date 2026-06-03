import { z } from 'zod'
import { PASTE_ID_RE, READ_PASSWORD_MAX } from '#shared/schemas/paste'

const BEARER_RE = /^Bearer\s+/

// Public content endpoint behind the /s/:id share page. Authorized by the (unguessable)
// snippet id; the optional read password travels in the POST body (not the URL). Returns
// just enough to render the snippet (never the password hash).
defineRouteMeta({
  openAPI: {
    description: 'Fetch a shared snippet for the public render view. Authorized by the snippet id '
      + '(and read password in the body if set); no site token required.',
  },
})

const ShareBodySchema = z.object({
  password: z.string().max(READ_PASSWORD_MAX).optional(),
})

export default eventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !PASTE_ID_RE.test(id))
    throw createError({ status: 400, statusText: 'Invalid id' })

  const { password } = await readValidatedBody(event, ShareBodySchema.parse)

  const record = await getPasteRecord(event, id)
  if (!record)
    throw createError({ status: 404, statusText: 'Paste not found' })

  // The site-token owner bypasses the read password and never triggers burn (same as raw).
  const headerToken = getHeader(event, 'Authorization')?.replace(BEARER_RE, '')
  const viaSiteToken = typeof headerToken === 'string' && safeEqual(headerToken, useRuntimeConfig(event).siteToken)

  if (record.password && !viaSiteToken) {
    if (!password || !await verifyLinkPassword(password, record.password))
      throw createError({ status: 401, statusText: 'Password required', data: { hasPassword: true } })
  }

  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')

  // Files: return metadata only — the page loads the bytes from /raw. Text: include content.
  const result = {
    id: record.id,
    kind: record.kind,
    lang: record.lang,
    title: record.title,
    burn: record.burn,
    hasPassword: !!record.password,
    expiration: record.expiration,
    size: record.size,
    mime: record.mime,
    filename: record.filename,
    content: record.kind === 'text' ? record.content : undefined,
  }

  // Burn after reading: destroy on the first public (non-owner) delivery. For a file the
  // page still needs to fetch /raw to show it — but a burn file would already be gone, so do
  // not burn file pastes on the metadata fetch (the /raw fetch performs the burn instead).
  if (record.burn && !viaSiteToken && record.kind === 'text')
    await deletePaste(event, id)

  return result
})
