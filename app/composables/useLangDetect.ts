import { resolveLang } from '@/composables/useHighlighter'

// Heuristic language detection (flourite: tiny, dependency-free, browser-safe).
// Lazy-loaded so it only ships when the user actually asks for auto-detection.
let detectFn: Promise<(code: string) => string> | null = null

function loadDetector(): Promise<(code: string) => string> {
  if (!detectFn) {
    detectFn = import('flourite').then(({ default: flourite }) => (code: string) => {
      const { language } = flourite(code, { shiki: true, noUnknown: false })
      // flourite returns names like "Python"/"Javascript"/"C++"/"Unknown"; map to a Shiki id.
      if (!language || language === 'Unknown')
        return 'text'
      return resolveLang(language)
    })
  }
  return detectFn
}

/** Detect a snippet's language and return a Shiki language id ('text' if unknown). */
export async function detectLang(code: string): Promise<string> {
  if (!code.trim())
    return 'text'
  const detect = await loadDetector()
  return detect(code)
}
