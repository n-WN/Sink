import { customAlphabet } from 'nanoid'
import { z } from 'zod'
import { SHORT_ID_ALPHABET } from '../utils/short-id'

// Paste ids: 8 chars of the shared short-id alphabet (no 0/1/i/l/o).
export const pasteId = customAlphabet(SHORT_ID_ALPHABET, 8)

// Validates a paste id taken from the URL before it is used as a KV key. Built from the
// shared alphabet; disable the range hint since it intentionally omits look-alikes.

export const PASTE_ID_RE = new RegExp(`^[${SHORT_ID_ALPHABET}]{8}$`)

// Text snippets cap at 512 KB. Files (images / small attachments) cap at 1 MB — large
// enough for screenshots, small enough that the 1000-active cap stays within 1 GB storage.
export const MAX_PASTE_SIZE = 512 * 1024
export const MAX_FILE_SIZE = 1024 * 1024

// Only these image types are served inline; everything else is forced to download (SVG and
// HTML can execute script, so they are never inlined).
export const INLINE_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

// Cloudflare KV minimum expiration is 60s; max preset is 30 days.
export const MIN_PASTE_TTL = 60
export const MAX_PASTE_TTL = 30 * 24 * 3600
export const DEFAULT_PASTE_TTL = 24 * 3600

// Cap the number of live snippets to stay within the free-tier KV budget and prevent
// a runaway client from filling storage. Generous for a single-user clipboard.
export const MAX_ACTIVE_PASTES = 1000

// Public (anonymous) creates per UTC day. Protects the free KV write budget (~1000/day):
// each anon create costs 1 counter write + 1 paste write, so ~400 leaves headroom for the
// owner. The site-token owner is not counted.
export const ANON_DAILY_CREATE_CAP = 400

const now = () => Math.floor(Date.now() / 1000)

export const READ_PASSWORD_MAX = 128

// Stored shape (KV value). `password` holds the PBKDF2 hash (never the plaintext).
export const PasteSchema = z.object({
  id: z.string().trim().max(26).default(() => pasteId()),
  content: z.string().min(1).max(MAX_PASTE_SIZE),
  lang: z.string().trim().max(32).default('text'),
  title: z.string().trim().max(128).optional(),
  createdAt: z.number().int().safe().default(now),
  expiration: z.number().int().safe().default(() => now() + DEFAULT_PASTE_TTL),
  // Burn after reading: deleted after the first public (non-owner) fetch.
  burn: z.boolean().default(false),
  // Optional read password (PBKDF2 hash); gates public access to a snippet.
  password: z.string().optional(),
})

export type Paste = z.infer<typeof PasteSchema>

// Create request body.
export const CreatePasteSchema = z.object({
  content: z.string().min(1).max(MAX_PASTE_SIZE),
  lang: z.string().trim().max(32).optional(),
  title: z.string().trim().max(128).optional(),
  // Time-to-live in seconds; the link expires (is auto-deleted by KV) afterwards.
  ttl: z.coerce.number().int().min(MIN_PASTE_TTL).max(MAX_PASTE_TTL).optional(),
  burn: z.boolean().optional(),
  password: z.string().min(1).max(READ_PASSWORD_MAX).optional(),
})

export type CreatePaste = z.infer<typeof CreatePasteSchema>

// Lightweight metadata stored alongside each KV key so listing never reads bodies.
// For text pastes the body is the JSON Paste; for files the body is the raw bytes and the
// metadata carries everything (incl. the password hash, since there is no JSON value).
export interface PasteMeta {
  kind?: 'text' | 'file' // defaults to 'text' for legacy entries
  lang: string
  title?: string
  createdAt: number
  expiration: number
  size: number
  burn?: boolean
  hasPassword?: boolean
  mime?: string // file pastes
  filename?: string // file pastes
  passwordHash?: string // file pastes only; server-side, never returned to clients
}

// What list/UI sees — never includes the password hash.
export interface PasteListItem {
  id: string
  kind: 'text' | 'file'
  lang: string
  title?: string
  createdAt: number
  expiration: number
  size: number
  burn?: boolean
  hasPassword?: boolean
  mime?: string
  filename?: string
}

// Normalized record returned by the store regardless of kind.
export interface PasteRecord {
  id: string
  kind: 'text' | 'file'
  lang: string
  title?: string
  createdAt: number
  expiration: number
  burn: boolean
  password?: string // PBKDF2 hash
  size: number
  mime?: string
  filename?: string
  content?: string // text only
  bytes?: ArrayBuffer // file only
}
