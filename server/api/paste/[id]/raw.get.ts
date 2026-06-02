import { PASTE_ID_RE } from '#shared/schemas/paste'

const BEARER_RE = /^Bearer\s+/

defineRouteMeta({
  openAPI: {
    description: 'Get the raw text of a clipboard entry as text/plain. '
      + 'Auth via the per-paste read key (?k=) so the raw URL is shareable/curl-able without '
      + 'exposing the site token; the Authorization header (site token) also works.',
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

  // This route is exempt from the global Bearer check (see middleware/2.auth.ts) so a raw
  // link is openable without leaking the master token. Authorize here instead: either the
  // paste's own read key (?k=) or the site token in the Authorization header.
  const query = getQuery(event)
  const queryKey = query.k
  const headerToken = getHeader(event, 'Authorization')?.replace(BEARER_RE, '')
  const { siteToken } = useRuntimeConfig(event)
  const viaReadKey = typeof queryKey === 'string' && safeEqual(queryKey, paste.readKey)
  const viaSiteToken = typeof headerToken === 'string' && safeEqual(headerToken, siteToken)
  if (!viaReadKey && !viaSiteToken)
    throw createError({ status: 401, statusText: 'Unauthorized' })

  // Read-password gate (applies to the shareable read-key path only; the site-token owner
  // already has full access).
  if (paste.password && viaReadKey && !viaSiteToken) {
    const submitted = typeof query.p === 'string' ? query.p : ''
    if (!submitted || !await verifyLinkPassword(submitted, paste.password))
      throw createError({ status: 401, statusText: 'Password required' })
  }

  // Harden: force plain text, block MIME sniffing/execution, hide the key from referers.
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Security-Policy', 'default-src \'none\'; sandbox')
  setHeader(event, 'Content-Disposition', 'inline; filename="paste.txt"')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  setHeader(event, 'X-Frame-Options', 'DENY')
  setHeader(event, 'Cache-Control', 'no-store')

  // Burn after reading: once delivered through the shareable link, destroy it.
  if (paste.burn && viaReadKey)
    await deletePaste(event, id)

  return paste.content
})
