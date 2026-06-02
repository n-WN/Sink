const BEARER_RE = /^Bearer\s+/
const RAW_PASTE_RE = /^\/api\/paste\/[^/]+\/raw$/
const SHARE_PASTE_RE = /^\/api\/paste\/[^/]+\/share$/

export default eventHandler((event) => {
  const path = event.path.split('?')[0]

  // The raw and share paste endpoints authorize themselves (per-paste read key + optional
  // read password) so a shared link never has to carry the master token. Everything else
  // under /api/ requires the site token in the Authorization header.
  const isPublicShare
    = (event.method === 'GET' && RAW_PASTE_RE.test(path))
      || (event.method === 'POST' && SHARE_PASTE_RE.test(path))
  if (!path.startsWith('/api/') || isPublicShare)
    return

  const token = getHeader(event, 'Authorization')?.replace(BEARER_RE, '') || ''
  if (!safeEqual(token, useRuntimeConfig(event).siteToken)) {
    throw createError({
      status: 401,
      statusText: 'Unauthorized',
    })
  }
})
