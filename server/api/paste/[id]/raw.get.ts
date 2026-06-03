import { INLINE_IMAGE_MIME, PASTE_ID_RE } from '#shared/schemas/paste'

const BEARER_RE = /^Bearer\s+/
const UNSAFE_FILENAME_RE = /["\\\r\n]/g

defineRouteMeta({
  openAPI: {
    description: 'Get the raw bytes of a clipboard entry (text/plain for text snippets, the '
      + 'original Content-Type for files). Public: authorized by the (unguessable) snippet id; '
      + 'the read password (?p=) is required if set. The site token bypasses the password and burn.',
  },
})

export default eventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !PASTE_ID_RE.test(id))
    throw createError({ status: 400, statusText: 'Invalid id' })

  const record = await getPasteRecord(event, id)
  if (!record)
    throw createError({ status: 404, statusText: 'Paste not found' })

  // Public access is by snippet id (an unguessable, rate-limited capability). The site token
  // (owner) bypasses the read password and never burns the snippet.
  const headerToken = getHeader(event, 'Authorization')?.replace(BEARER_RE, '')
  const { siteToken } = useRuntimeConfig(event)
  const viaSiteToken = typeof headerToken === 'string' && safeEqual(headerToken, siteToken)

  if (record.password && !viaSiteToken) {
    // Password may come via header (preferred — keeps it out of URLs/logs) or ?p= (curl).
    const submitted = getHeader(event, 'x-paste-password')
      || (typeof getQuery(event).p === 'string' ? String(getQuery(event).p) : '')
    if (!submitted || !await verifyLinkPassword(submitted, record.password))
      throw createError({ status: 401, statusText: 'Password required' })
  }

  // Harden every response: no MIME sniffing/execution, no referer, no caching.
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Security-Policy', 'default-src \'none\'; sandbox')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  setHeader(event, 'X-Frame-Options', 'DENY')
  setHeader(event, 'Cache-Control', 'no-store')

  // Burn after reading: destroy on the first public delivery (owner reads do not burn).
  const burn = async () => {
    if (record.burn && !viaSiteToken)
      await deletePaste(event, id)
  }

  if (record.kind === 'file') {
    const mime = record.mime || 'application/octet-stream'
    // Only known-safe raster images are shown inline; SVG/HTML/unknown are forced to download.
    const inline = INLINE_IMAGE_MIME.has(mime)
    const name = (record.filename || `${id}`).replace(UNSAFE_FILENAME_RE, '_')
    setHeader(event, 'Content-Type', mime)
    setHeader(event, 'Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`)
    await burn()
    return new Uint8Array(record.bytes as ArrayBuffer)
  }

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'inline; filename="paste.txt"')
  await burn()
  return record.content
})
