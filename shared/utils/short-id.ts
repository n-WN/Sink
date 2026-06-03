// The single unambiguous, lowercase short-id alphabet (no 0/1/i/l/o) shared by both the
// link shortener and the clipboard. Readable and easy to type by hand. Each feature builds
// its own ids/slugs from this one alphabet (links: configurable length; pastes: 8 chars).
export const SHORT_ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
