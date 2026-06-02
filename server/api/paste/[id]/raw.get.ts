import { PASTE_ID_RE } from '#shared/schemas/paste'

const BEARER_RE = /^Bearer\s+/

defineRouteMeta({
  openAPI: {
    description: 'Get the raw text of a clipboard entry as text/plain. Public: authorized by '
      + 'the (unguessable) snippet id; the read password (?p=) is required if the snippet has one. '
      + 'The site-token Authorization header bypasses the password and never triggers burn.',
  },
})

export default eventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !PASTE_ID_RE.test(id))
    throw createError({ status: 400, statusText: 'Invalid id' })

  const paste = await getPaste(event, id)
  if (!paste)
    throw createError({ status: 404, statusText: 'Paste not found' })

  // Public access is by snippet id (an unguessable, rate-limited capability). The site token
  // (owner) bypasses the read password and never burns the snippet.
  const headerToken = getHeader(event, 'Authorization')?.replace(BEARER_RE, '')
  const { siteToken } = useRuntimeConfig(event)
  const viaSiteToken = typeof headerToken === 'string' && safeEqual(headerToken, siteToken)

  if (paste.password && !viaSiteToken) {
    const submitted = typeof getQuery(event).p === 'string' ? String(getQuery(event).p) : ''
    if (!submitted || !await verifyLinkPassword(submitted, paste.password))
      throw createError({ status: 401, statusText: 'Password required' })
  }

  // Harden: force plain text, block MIME sniffing/execution, drop the referer.
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Security-Policy', 'default-src \'none\'; sandbox')
  setHeader(event, 'Content-Disposition', 'inline; filename="paste.txt"')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  setHeader(event, 'X-Frame-Options', 'DENY')
  setHeader(event, 'Cache-Control', 'no-store')

  // Burn after reading: destroy on the first public delivery (owner reads do not burn).
  if (paste.burn && !viaSiteToken)
    await deletePaste(event, id)

  return paste.content
})
