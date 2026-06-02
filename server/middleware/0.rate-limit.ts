// Runs before 1.redirect and 2.auth. Throttles the public, id-addressed paste endpoints
// (brute-forcing the unguessable id or a read password) and the site-token check. Uses the
// free Workers Rate Limiting binding — best-effort, per Cloudflare location, so it throttles
// sustained scanning rather than precisely capping small bursts. The owner (valid site token)
// is exempt. This is the defence-in-depth layer behind the unguessable id; not the only one.
import type { H3Event } from 'h3'
import { PASTE_ID_RE } from '#shared/schemas/paste'

const BEARER_RE = /^Bearer\s+/
const RAW_OR_SHARE_RE = /^\/api\/paste\/([^/]+)\/(?:raw|share)$/

interface RateLimiter {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

async function enforce(event: H3Event, limiter: RateLimiter | undefined, key: string) {
  if (!limiter)
    return
  const { success } = await limiter.limit({ key })
  if (!success) {
    setHeader(event, 'Retry-After', '60')
    throw createError({ status: 429, statusText: 'Too Many Requests' })
  }
}

export default eventHandler(async (event) => {
  const env = event.context.cloudflare?.env as Record<string, RateLimiter> | undefined
  if (!env)
    return // local dev / no bindings

  const path = event.path.split('?')[0]
  if (!path.startsWith('/api/paste/') && path !== '/api/verify')
    return

  // Owner (valid site token) is never rate-limited.
  const token = getHeader(event, 'Authorization')?.replace(BEARER_RE, '') || ''
  if (token && safeEqual(token, useRuntimeConfig(event).siteToken))
    return

  const ip = getHeader(event, 'cf-connecting-ip') || 'unknown'

  const pasteMatch = path.match(RAW_OR_SHARE_RE)
  if (pasteMatch) {
    await enforce(event, env.RL_PASTE_IP, ip) // overall scan rate per IP
    // Only key the per-id limiter on a well-formed id, so a flood of junk ids can't blow up
    // the key cardinality (junk ids still get the per-IP limit above, then a 400 from the route).
    if (PASTE_ID_RE.test(pasteMatch[1]))
      await enforce(event, env.RL_PASTE_ID, `${ip}:${pasteMatch[1]}`)
    return
  }

  if (path === '/api/verify')
    await enforce(event, env.RL_VERIFY, ip) // site-token guessing
})
