import type { H3Event } from 'h3'

// The two features are both "short id -> JSON resource in KV"; this is the one place that
// builds the prefixed key and does the typed get/put/delete. List stays per-feature (paste
// lists metadata only, links read values + metadata), so it is intentionally not wrapped.
type KvPrefix = 'link' | 'paste'

function kv(event: H3Event) {
  return event.context.cloudflare.env.KV
}

export function kvKey(prefix: KvPrefix, id: string): string {
  return `${prefix}:${id}`
}

export async function kvGetJson<T>(event: H3Event, prefix: KvPrefix, id: string, cacheTtl?: number): Promise<T | null> {
  return await kv(event).get(kvKey(prefix, id), { type: 'json', cacheTtl }) as T | null
}

export async function kvGetJsonWithMetadata<T, M = Record<string, unknown>>(
  event: H3Event,
  prefix: KvPrefix,
  id: string,
): Promise<{ value: T | null, metadata: M | null }> {
  const { value, metadata } = await kv(event).getWithMetadata(kvKey(prefix, id), { type: 'json' })
  return { value: value as T | null, metadata: metadata as M | null }
}

export async function kvPutJson<T>(
  event: H3Event,
  prefix: KvPrefix,
  id: string,
  value: T,
  options?: { expiration?: number, metadata?: Record<string, unknown> },
): Promise<void> {
  await kv(event).put(kvKey(prefix, id), JSON.stringify(value), options)
}

export async function kvDelete(event: H3Event, prefix: KvPrefix, id: string): Promise<void> {
  await kv(event).delete(kvKey(prefix, id))
}
