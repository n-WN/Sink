import type { HighlighterCore } from 'shiki/core'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

// Vitesse (by the Shiki author): a minimal light/dark theme pair. Mirrors the style used
// by the reference project (agent-web). Dual themes emit inline light colors plus a
// `--shiki-dark` CSS var that the stylesheet swaps to under `.dark`.
const THEMES = { light: 'vitesse-light', dark: 'vitesse-dark' } as const

// Curated language set — keep it lean so the client bundle stays small. Each entry is the
// canonical Shiki id; aliases are resolved in `resolveLang`.
export const HIGHLIGHT_LANGS: { id: string, label: string }[] = [
  { id: 'text', label: 'Plain text' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'tsx', label: 'TSX' },
  { id: 'jsx', label: 'JSX' },
  { id: 'vue', label: 'Vue' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'toml', label: 'TOML' },
  { id: 'html', label: 'HTML' },
  { id: 'xml', label: 'XML' },
  { id: 'css', label: 'CSS' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'bash', label: 'Shell / Bash' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'java', label: 'Java' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'php', label: 'PHP' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'sql', label: 'SQL' },
  { id: 'lua', label: 'Lua' },
  { id: 'swift', label: 'Swift' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'ini', label: 'INI' },
  { id: 'diff', label: 'Diff' },
]

const LANG_ALIASES: Record<string, string> = {
  'ts': 'typescript',
  'js': 'javascript',
  'py': 'python',
  'rs': 'rust',
  'sh': 'bash',
  'shell': 'bash',
  'zsh': 'bash',
  'yml': 'yaml',
  'md': 'markdown',
  'c++': 'cpp',
  'c#': 'csharp',
  'rb': 'ruby',
  'docker': 'dockerfile',
  'txt': 'text',
  'plaintext': 'text',
}

export function resolveLang(lang: string | undefined | null): string {
  const id = (lang || 'text').toLowerCase().trim()
  return LANG_ALIASES[id] ?? id
}

// Per-language grammar loaders. Grammars are only ~10-40 KB each but loading all ~30 up
// front made the first highlight wait on every import. We now load just the one language a
// snippet needs, on demand.
type LangImport = () => Promise<{ default: unknown }>
const LANG_LOADERS: Record<string, LangImport> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  dockerfile: () => import('shiki/langs/docker.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
}

let highlighterPromise: Promise<HighlighterCore> | null = null
const loadedLangs = new Set<string>()

function loadHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        () => import('shiki/themes/vitesse-light.mjs'),
        () => import('shiki/themes/vitesse-dark.mjs'),
      ],
      // Languages are loaded lazily per snippet (see highlightToHtml), not all up front.
      langs: [],
      // `forgiving` keeps highlighting working in Safari/Firefox: the JS RegExp engine
      // compiles TextMate grammars to native RegExp, and some patterns that V8 accepts are
      // rejected elsewhere. Without it one bad pattern drops the whole block to plaintext.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  }
  return highlighterPromise
}

const HTML_ESCAPES: [RegExp, string][] = [
  [/&/g, '&amp;'],
  [/</g, '&lt;'],
  [/>/g, '&gt;'],
  [/"/g, '&quot;'],
  [/'/g, '&#039;'],
]

function escapeHtml(value: string): string {
  return HTML_ESCAPES.reduce((acc, [re, rep]) => acc.replace(re, rep), value)
}

/** Plain (un-tokenized) container shown before the async highlighter resolves. */
export function highlightFallback(code: string): string {
  return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`
}

/**
 * Highlight code to themed HTML. The one needed grammar is loaded on demand; unknown
 *  languages degrade to plain text (always available in Shiki core).
 */
export async function highlightToHtml(code: string, lang: string): Promise<string> {
  const h = await loadHighlighter()
  let safeLang = 'text'
  if (LANG_LOADERS[lang]) {
    if (!loadedLangs.has(lang)) {
      await h.loadLanguage(LANG_LOADERS[lang] as Parameters<typeof h.loadLanguage>[0])
      loadedLangs.add(lang)
    }
    safeLang = lang
  }
  return h.codeToHtml(code, {
    lang: safeLang,
    themes: THEMES,
    defaultColor: false,
  })
}
