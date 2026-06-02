const BEARER_RE = /^Bearer\s+/
const RAW_PASTE_RE = /^\/api\/paste\/[^/]+\/raw$/

export default eventHandler((event) => {
  const path = event.path.split('?')[0]

  // The raw-paste endpoint authorizes itself (per-paste read key or site token) so that a
  // shareable raw URL never has to carry the master token. Everything else under /api/
  // requires the site token in the Authorization header.
  const isRawPaste = event.method === 'GET' && RAW_PASTE_RE.test(path)
  if (!path.startsWith('/api/') || isRawPaste)
    return

  const token = getHeader(event, 'Authorization')?.replace(BEARER_RE, '') || ''
  if (!safeEqual(token, useRuntimeConfig(event).siteToken)) {
    throw createError({
      status: 401,
      statusText: 'Unauthorized',
    })
  }
})
