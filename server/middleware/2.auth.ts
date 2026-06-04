const BEARER_RE = /^Bearer\s+/
const RAW_PASTE_RE = /^\/api\/paste\/[^/]+\/raw$/
const SHARE_PASTE_RE = /^\/api\/paste\/[^/]+\/share$/
const CREATE_PASTE_RE = /^\/api\/paste\/create$/

export default eventHandler((event) => {
  const path = event.path.split('?')[0]

  // Public, no site token required:
  //  - GET  /api/paste/:id/raw  and  POST /api/paste/:id/share : authorized by the unguessable
  //    snippet id (+ optional read password), so a shared link never carries the master token.
  //  - POST /api/paste/create : anyone may create a snippet (rate-limited + daily-capped in the
  //    route/limiter). Listing and deleting still require the site token.
  const isPublic
    = (event.method === 'GET' && RAW_PASTE_RE.test(path))
      || (event.method === 'POST' && SHARE_PASTE_RE.test(path))
      || (event.method === 'POST' && CREATE_PASTE_RE.test(path))
  if (!path.startsWith('/api/') || isPublic)
    return

  const token = getHeader(event, 'Authorization')?.replace(BEARER_RE, '') || ''
  if (!safeEqual(token, useRuntimeConfig(event).siteToken)) {
    throw createError({
      status: 401,
      statusText: 'Unauthorized',
    })
  }
})
