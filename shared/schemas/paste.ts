import { customAlphabet } from 'nanoid'
import { z } from 'zod'

// Short, unambiguous id alphabet (no look-alike chars), 8 chars by default.
const PASTE_ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
export const pasteId = customAlphabet(PASTE_ID_ALPHABET, 8)

// Validates a paste id taken from the URL before it is used as a KV key.
// Built from the alphabet above to stay in sync; disable the range hint since the
// alphabet intentionally omits look-alike characters (0/1/i/l/o).
// eslint-disable-next-line regexp/prefer-range
export const PASTE_ID_RE = new RegExp(`^[${PASTE_ID_ALPHABET}]{8}$`)

// Per-paste read key: a 24-char secret embedded in the shareable raw URL so a leaked
// raw link only exposes that single paste (read-only), never the master site token.
export const readKey = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', 24)

// Clipboard is for text snippets, not large files: cap at 512 KB.
export const MAX_PASTE_SIZE = 512 * 1024

// Cloudflare KV minimum expiration is 60s; max preset is 30 days.
export const MIN_PASTE_TTL = 60
export const MAX_PASTE_TTL = 30 * 24 * 3600
export const DEFAULT_PASTE_TTL = 24 * 3600

// Cap the number of live snippets to stay within the free-tier KV budget and prevent
// a runaway client from filling storage. Generous for a single-user clipboard.
export const MAX_ACTIVE_PASTES = 1000

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
  readKey: z.string().trim().max(64).default(() => readKey()),
  // Burn after reading: deleted after the first fetch through the shareable raw link.
  burn: z.boolean().default(false),
  // Optional read password (PBKDF2 hash); gates the shareable raw link.
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
export interface PasteMeta {
  lang: string
  title?: string
  createdAt: number
  expiration: number
  size: number
  burn?: boolean
  hasPassword?: boolean
}

export interface PasteListItem extends PasteMeta {
  id: string
}
