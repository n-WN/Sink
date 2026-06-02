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

let highlighterPromise: Promise<HighlighterCore> | null = null

function loadHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        () => import('shiki/themes/vitesse-light.mjs'),
        () => import('shiki/themes/vitesse-dark.mjs'),
      ],
      langs: [
        () => import('shiki/langs/typescript.mjs'),
        () => import('shiki/langs/javascript.mjs'),
        () => import('shiki/langs/tsx.mjs'),
        () => import('shiki/langs/jsx.mjs'),
        () => import('shiki/langs/vue.mjs'),
        () => import('shiki/langs/json.mjs'),
        () => import('shiki/langs/yaml.mjs'),
        () => import('shiki/langs/toml.mjs'),
        () => import('shiki/langs/html.mjs'),
        () => import('shiki/langs/xml.mjs'),
        () => import('shiki/langs/css.mjs'),
        () => import('shiki/langs/markdown.mjs'),
        () => import('shiki/langs/bash.mjs'),
        () => import('shiki/langs/python.mjs'),
        () => import('shiki/langs/go.mjs'),
        () => import('shiki/langs/rust.mjs'),
        () => import('shiki/langs/java.mjs'),
        () => import('shiki/langs/c.mjs'),
        () => import('shiki/langs/cpp.mjs'),
        () => import('shiki/langs/csharp.mjs'),
        () => import('shiki/langs/php.mjs'),
        () => import('shiki/langs/ruby.mjs'),
        () => import('shiki/langs/sql.mjs'),
        () => import('shiki/langs/lua.mjs'),
        () => import('shiki/langs/swift.mjs'),
        () => import('shiki/langs/kotlin.mjs'),
        () => import('shiki/langs/docker.mjs'),
        () => import('shiki/langs/ini.mjs'),
        () => import('shiki/langs/diff.mjs'),
      ],
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

/** Highlight code to themed HTML. Unknown/unloaded languages degrade to plain text. */
export async function highlightToHtml(code: string, lang: string): Promise<string> {
  const h = await loadHighlighter()
  const safeLang = h.getLoadedLanguages().includes(lang) ? lang : 'text'
  return h.codeToHtml(code, {
    lang: safeLang,
    themes: THEMES,
    defaultColor: false,
  })
}
