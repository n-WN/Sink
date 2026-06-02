// Constant-time string comparison to avoid leaking secrets through timing.
// Length is allowed to leak (both inputs here are fixed-length random tokens).
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length)
    return false
  let result = 0
  for (let i = 0; i < a.length; i++)
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}
