import type { H3Event } from 'h3'
import type { z } from 'zod'
import type { LinkSchema } from '#shared/schemas/link'
import { parseURL, stringifyParsedURL } from 'ufo'

type Link = z.infer<typeof LinkSchema>

export function withoutQuery(url: string): string {
  const parsed = parseURL(url)
  return stringifyParsedURL({ ...parsed, search: '' })
}

export function normalizeSlug(event: H3Event, slug: string): string {
  const { caseSensitive } = useRuntimeConfig(event)
  return caseSensitive ? slug : slug.toLowerCase()
}

export function buildShortLink(event: H3Event, slug: string): string {
  return `${getRequestProtocol(event)}://${getRequestHost(event)}/${slug}`
}

export async function putLink(event: H3Event, link: Link): Promise<void> {
  const expiration = getExpiration(event, link.expiration)

  await kvPutJson(event, 'link', link.slug, link, {
    expiration,
    metadata: {
      expiration,
      url: withoutQuery(link.url),
      comment: link.comment,
    },
  })
}

export async function getLink(event: H3Event, slug: string, cacheTtl?: number): Promise<Link | null> {
  return await kvGetJson<Link>(event, 'link', slug, cacheTtl)
}

export async function getLinkWithMetadata(event: H3Event, slug: string): Promise<{ link: Link | null, metadata: Record<string, unknown> | null }> {
  const { value: link, metadata } = await kvGetJsonWithMetadata<Link>(event, 'link', slug)
  return { link, metadata }
}

export async function deleteLink(event: H3Event, slug: string): Promise<void> {
  await kvDelete(event, 'link', slug)
}

export async function linkExists(event: H3Event, slug: string): Promise<boolean> {
  const link = await getLink(event, slug)
  return link !== null
}

interface ListLinksOptions {
  limit: number
  cursor?: string
}

interface ListLinksResult {
  links: (Link | null)[]
  list_complete: boolean
  cursor?: string
}

export async function listLinks(event: H3Event, options: ListLinksOptions): Promise<ListLinksResult> {
  const { cloudflare } = event.context
  const { KV } = cloudflare.env
  const list = await KV.list({
    prefix: 'link:',
    limit: options.limit,
    cursor: options.cursor || undefined,
  })

  const links = await Promise.all(
    (list.keys || []).map(async (key: { name: string }) => {
      const { metadata, value: link } = await KV.getWithMetadata(key.name, { type: 'json' }) as { metadata: Record<string, unknown> | null, value: Link | null }
      if (link) {
        return {
          ...(metadata ?? {}),
          ...link,
        }
      }
      return link
    }),
  )

  return {
    links,
    list_complete: list.list_complete,
    cursor: 'cursor' in list ? list.cursor : undefined,
  }
}
