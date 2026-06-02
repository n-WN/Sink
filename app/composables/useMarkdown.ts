import { highlightToHtml, resolveLang } from '@/composables/useHighlighter'

// DOMPurify config: allow standard markdown markup plus Shiki's highlighted code
// (span + class + style, where style carries Shiki's `--shiki-light/--shiki-dark` vars).
// Raw HTML in the source is already escaped (markdown-it `html: false`); this is the
// second, authoritative layer that strips scripts, event handlers and unsafe URLs.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'hr',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'em',
    'b',
    'i',
    'del',
    's',
    'sub',
    'sup',
    'mark',
    'small',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'pre',
    'code',
    'span',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class', 'style', 'align'],
  // Only safe schemes for href/src; blocks javascript:, vbscript:, etc.
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):/i,
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input'],
  ADD_ATTR: ['target', 'rel'],
}

type Renderer = (src: string) => Promise<string>

let rendererPromise: Promise<Renderer> | null = null

async function buildRenderer(): Promise<Renderer> {
  const [{ MarkdownItAsync }, { default: DOMPurify }] = await Promise.all([
    import('markdown-it-async'),
    import('dompurify'),
  ])

  const md = MarkdownItAsync({
    html: false, // never trust raw inline HTML from arbitrary pastes
    linkify: true,
    breaks: false,
    // Reuse the single shared Shiki highlighter; returns a full `<pre class="shiki">`,
    // which markdown-it uses verbatim (no extra <pre><code> wrapper).
    async highlight(code, lang) {
      try {
        return await highlightToHtml(code, resolveLang(lang))
      }
      catch {
        return '' // fall back to markdown-it's default escaped code block
      }
    },
  })

  // Open links in a new tab without leaking the opener.
  const defaultLinkOpen = md.renderer.rules.link_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer nofollow')
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  return async (src: string) => {
    const dirty = await md.renderAsync(src)
    return DOMPurify.sanitize(dirty, SANITIZE_CONFIG)
  }
}

/** Render Markdown to sanitized HTML. Lazy-loads markdown-it + DOMPurify on first use. */
export function renderMarkdown(src: string): Promise<string> {
  rendererPromise ??= buildRenderer()
  return rendererPromise.then(render => render(src))
}
