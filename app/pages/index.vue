<script setup lang="ts">
import type { PasteListItem } from '#shared/schemas/paste'
import { Check, ClipboardList, Copy, Download, FileCode, Link2, Loader, Lock, Plus, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useAuthToken } from '@/composables/useAuthToken'
import { HIGHLIGHT_LANGS, highlightFallback, highlightToHtml, resolveLang } from '@/composables/useHighlighter'
import { renderMarkdown } from '@/composables/useMarkdown'

definePageMeta({ layout: false })
useHead({ title: 'clip' })

type ViewMode = 'highlight' | 'raw' | 'preview'

interface PasteFull extends PasteListItem {
  content: string
  readKey: string
}

const TTL_OPTIONS = [
  { value: 600, label: '10 min' },
  { value: 3600, label: '1 hour' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '7 days' },
  { value: 2592000, label: '30 days' },
]

const { getToken, setToken, removeToken } = useAuthToken()

const ready = ref(false)
const authed = ref(false)
const tokenInput = ref('')
const unlocking = ref(false)

const draft = reactive({ title: '', lang: 'text', ttl: 86400, content: '' })
const creating = ref(false)

const pastes = ref<PasteListItem[]>([])
const selected = ref<PasteFull | null>(null)
const view = ref<ViewMode>('highlight')
const highlighted = ref('')
const rendered = ref('')
const copied = ref(false)

const origin = computed(() => (import.meta.client ? window.location.origin : ''))

function rawUrl(p: PasteFull): string {
  return `${origin.value}/api/paste/${p.id}/raw?k=${encodeURIComponent(p.readKey)}`
}

function curlHint(p: PasteFull): string {
  return `curl '${rawUrl(p)}'`
}

function formatBytes(size: number): string {
  if (size < 1024)
    return `${size} B`
  if (size < 1024 * 1024)
    return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatExpiry(expiration: number): string {
  const secs = expiration - Math.floor(Date.now() / 1000)
  if (secs <= 0)
    return 'expired'
  if (secs < 3600)
    return `${Math.ceil(secs / 60)}m`
  if (secs < 86400)
    return `${Math.ceil(secs / 3600)}h`
  return `${Math.ceil(secs / 86400)}d`
}

async function checkAuth(): Promise<boolean> {
  if (!getToken())
    return false
  try {
    await useAPI('/api/verify')
    return true
  }
  catch {
    return false
  }
}

async function loadList() {
  try {
    const res = await useAPI<{ pastes: PasteListItem[] }>('/api/paste/list')
    pastes.value = res.pastes
  }
  catch (e) {
    toast.error('Failed to load', { description: e instanceof Error ? e.message : String(e) })
  }
}

async function unlock() {
  if (tokenInput.value.length < 8) {
    toast.error('Token is too short')
    return
  }
  unlocking.value = true
  setToken(tokenInput.value)
  if (await checkAuth()) {
    authed.value = true
    tokenInput.value = ''
    await loadList()
  }
  else {
    removeToken()
    toast.error('Invalid token')
  }
  unlocking.value = false
}

function lock() {
  removeToken()
  authed.value = false
  pastes.value = []
  selected.value = null
}

async function createPaste() {
  if (!draft.content.trim()) {
    toast.error('Nothing to save')
    return
  }
  creating.value = true
  try {
    const res = await useAPI<{ paste: PasteListItem }>('/api/paste/create', {
      method: 'POST',
      body: { content: draft.content, lang: draft.lang, title: draft.title || undefined, ttl: draft.ttl },
    })
    // Update the list locally instead of re-listing (cheaper on the KV budget).
    pastes.value = [res.paste, ...pastes.value]
    draft.content = ''
    draft.title = ''
    await openPaste(res.paste.id)
    toast.success('Saved', { description: `/${res.paste.id}` })
  }
  catch (e) {
    toast.error('Failed to save', { description: e instanceof Error ? e.message : String(e) })
  }
  finally {
    creating.value = false
  }
}

async function renderView() {
  if (!selected.value)
    return
  if (view.value === 'highlight') {
    highlighted.value = highlightFallback(selected.value.content)
    try {
      highlighted.value = await highlightToHtml(selected.value.content, resolveLang(selected.value.lang))
    }
    catch { /* keep fallback */ }
  }
  else if (view.value === 'preview') {
    rendered.value = ''
    try {
      rendered.value = await renderMarkdown(selected.value.content)
    }
    catch (e) {
      toast.error('Failed to render', { description: e instanceof Error ? e.message : String(e) })
    }
  }
}

async function openPaste(id: string) {
  try {
    const res = await useAPI<{ paste: PasteFull }>(`/api/paste/${id}`)
    selected.value = res.paste
    view.value = resolveLang(res.paste.lang) === 'markdown' ? 'preview' : 'highlight'
    await renderView()
  }
  catch (e) {
    toast.error('Failed to open', { description: e instanceof Error ? e.message : String(e) })
  }
}

async function removePaste(id: string) {
  try {
    await useAPI(`/api/paste/${id}`, { method: 'DELETE' })
    pastes.value = pastes.value.filter(p => p.id !== id)
    if (selected.value?.id === id)
      selected.value = null
    toast.success('Deleted')
  }
  catch (e) {
    toast.error('Failed to delete', { description: e instanceof Error ? e.message : String(e) })
  }
}

watch(view, () => renderView())

async function copyText(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    toast.success(label)
    setTimeout(() => (copied.value = false), 1600)
  }
  catch {
    toast.error('Copy failed')
  }
}

function downloadPaste(p: PasteFull) {
  const blob = new Blob([p.content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${p.title || p.id}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  authed.value = await checkAuth()
  if (authed.value)
    await loadList()
  ready.value = true
})
</script>

<template>
  <div
    class="
      clip min-h-screen bg-[var(--bg-base)] font-sans text-[var(--fg-primary)]
      antialiased
    "
  >
    <!-- Top bar -->
    <header
      class="
        sticky top-0 z-20 flex h-12 items-center justify-between border-b
        border-[var(--border-subtle)] bg-[var(--bg-base)] px-4
      "
    >
      <div class="flex items-center gap-2">
        <ClipboardList
          :size="16" :stroke-width="1.75" class="text-[var(--accent)]"
        />
        <span class="font-mono text-[13px] font-medium tracking-tight">clip</span>
        <span class="mono-label">temporary</span>
      </div>
      <div class="flex items-center gap-3">
        <span v-if="authed" class="mono-label">{{ pastes.length }} snippet{{ pastes.length === 1 ? '' : 's' }}</span>
        <NuxtLink
          to="/dashboard" class="
            mono-label transition-colors
            hover:text-[var(--fg-primary)]
          "
        >
          dashboard
        </NuxtLink>
        <button
          v-if="authed" type="button" class="
            mono-label transition-colors
            hover:text-[var(--fg-primary)]
          " @click="lock"
        >
          lock
        </button>
      </div>
    </header>

    <ClientOnly>
      <div
        v-if="!ready" class="
          grid h-[60vh] place-items-center text-[var(--fg-muted)]
        "
      >
        <Loader :size="18" class="animate-spin" />
      </div>

      <!-- Auth gate -->
      <div v-else-if="!authed" class="grid min-h-[70vh] place-items-center px-4">
        <div
          class="
            w-full max-w-sm rounded-xl border border-[var(--border-subtle)] p-6
          "
        >
          <div class="flex items-center gap-2">
            <Lock :size="15" :stroke-width="1.75" class="text-[var(--accent)]" />
            <h2 class="text-[17px] font-semibold tracking-[-0.02em]">
              Enter site token
            </h2>
          </div>
          <p class="mt-1 text-[14px] tracking-[-0.016em] text-[var(--fg-muted)]">
            This clipboard is protected.
          </p>
          <form class="mt-5" @submit.prevent="unlock">
            <label class="mono-label">token</label>
            <input
              v-model="tokenInput"
              type="password"
              placeholder="site token"
              autocomplete="current-password"
              class="field mt-1.5 w-full"
            >
            <button
              type="submit" :disabled="unlocking" class="
                btn-accent mt-4 w-full justify-center
              "
            >
              <Loader v-if="unlocking" :size="14" class="animate-spin" />
              Unlock
            </button>
          </form>
        </div>
      </div>

      <!-- App -->
      <div
        v-else class="
          mx-auto grid max-w-7xl grid-cols-1 gap-px bg-[var(--border-subtle)]
          lg:grid-cols-[minmax(0,360px)_1fr]
        "
      >
        <!-- Left: composer + list -->
        <section class="flex flex-col gap-4 bg-[var(--bg-base)] p-4">
          <div class="rounded-lg border border-[var(--border-subtle)]">
            <input
              v-model="draft.title" placeholder="title (optional)" class="
                w-full border-b border-[var(--border-subtle)] bg-transparent
                px-3 py-2 text-[13px] outline-none
                placeholder:text-[var(--fg-faint)]
              "
            >
            <textarea
              v-model="draft.content"
              placeholder="paste or type…"
              spellcheck="false"
              class="
                block h-44 w-full resize-y bg-transparent p-3 font-mono
                text-[13px] leading-relaxed text-[var(--fg-primary)]
                outline-none
                placeholder:text-[var(--fg-faint)]
              "
            />
            <div
              class="
                flex items-center gap-2 border-t border-[var(--border-subtle)]
                p-2
              "
            >
              <select
                v-model="draft.lang" aria-label="Language" class="field flex-1"
              >
                <option v-for="l in HIGHLIGHT_LANGS" :key="l.id" :value="l.id">
                  {{ l.label }}
                </option>
              </select>
              <select
                v-model.number="draft.ttl" aria-label="Expiry" class="
                  field flex-1
                "
              >
                <option v-for="t in TTL_OPTIONS" :key="t.value" :value="t.value">
                  {{ t.label }}
                </option>
              </select>
              <button type="button" :disabled="creating" class="btn-accent" @click="createPaste">
                <Loader v-if="creating" :size="13" class="animate-spin" />
                <Plus v-else :size="13" :stroke-width="2" />
                Add
              </button>
            </div>
          </div>

          <div class="flex flex-col gap-0.5">
            <button
              v-for="p in pastes"
              :key="p.id"
              type="button"
              class="
                group flex items-center gap-2 rounded-md px-2 py-2 text-left
                transition-colors
                hover:bg-[var(--bg-hover)]
              "
              :class="selected?.id === p.id ? 'bg-[var(--accent-soft)]' : ''"
              @click="openPaste(p.id)"
            >
              <FileCode
                :size="14" :stroke-width="1.75" class="
                  shrink-0 text-[var(--fg-muted)]
                  group-hover:text-[var(--fg-primary)]
                "
              />
              <span class="min-w-0 flex-1 truncate text-[13px] tracking-tight">{{ p.title || p.id }}</span>
              <span class="mono-label tracking-normal normal-case">{{ p.lang }}</span>
              <span
                class="
                  font-mono text-[11px] text-[var(--fg-muted)] tabular-nums
                "
              >{{ formatBytes(p.size) }}</span>
              <span
                class="
                  w-8 text-right font-mono text-[11px] text-[var(--fg-muted)]
                  tabular-nums
                "
              >{{ formatExpiry(p.expiration) }}</span>
            </button>
            <div
              v-if="!pastes.length" class="
                rounded-md border border-dashed border-[var(--border-subtle)]
                px-3 py-10 text-center text-[12px] text-[var(--fg-muted)]
              "
            >
              No snippets yet.
            </div>
          </div>
        </section>

        <!-- Right: viewer -->
        <section class="bg-[var(--bg-base)]">
          <div v-if="selected" class="flex h-full flex-col">
            <div
              class="
                flex h-12 items-center justify-between gap-2 border-b
                border-[var(--border-subtle)] px-4
              "
            >
              <div class="flex min-w-0 items-center gap-2">
                <FileCode
                  :size="14" :stroke-width="1.75" class="
                    shrink-0 text-[var(--fg-muted)]
                  "
                />
                <span
                  class="truncate font-mono text-[13px] text-[var(--fg-muted)]"
                >{{ selected.title || selected.id }}</span>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <nav class="mr-2 flex items-center gap-3">
                  <button
                    v-for="m in (['highlight', 'preview', 'raw'] as const)"
                    :key="m"
                    type="button"
                    class="
                      relative pb-0.5 font-mono text-[11px] tracking-wider
                      uppercase transition-colors
                    "
                    :class="view === m ? 'text-[var(--fg-primary)]' : `
                      text-[var(--fg-muted)]
                      hover:text-[var(--fg-primary)]
                    `"
                    @click="view = m"
                  >
                    {{ m }}
                    <span
                      v-if="view === m" class="
                        absolute right-0 -bottom-px left-0 h-px
                        bg-[var(--accent)]
                      "
                    />
                  </button>
                </nav>
                <button type="button" class="icon-btn" title="Copy content" @click="copyText(selected.content)">
                  <Check v-if="copied" :size="14" :stroke-width="1.75" />
                  <Copy v-else :size="14" :stroke-width="1.75" />
                </button>
                <button type="button" class="icon-btn" title="Copy raw URL" @click="copyText(rawUrl(selected), 'Raw URL copied')">
                  <Link2 :size="14" :stroke-width="1.75" />
                </button>
                <button type="button" class="icon-btn" title="Download" @click="downloadPaste(selected)">
                  <Download :size="14" :stroke-width="1.75" />
                </button>
                <button
                  type="button" class="
                    icon-btn
                    hover:text-[var(--danger)]
                  " title="Delete" @click="removePaste(selected.id)"
                >
                  <Trash2 :size="14" :stroke-width="1.75" />
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-auto">
              <!-- eslint-disable vue/no-v-html -->
              <div v-show="view === 'highlight'" class="paste-code" v-html="highlighted" />
              <div v-show="view === 'preview'" class="md-body" v-html="rendered" />
              <!-- eslint-enable vue/no-v-html -->
              <pre v-show="view === 'raw'" class="paste-raw">{{ selected.content }}</pre>
            </div>

            <div
              class="
                flex items-center gap-2 border-t border-[var(--border-subtle)]
                px-4 py-2
              "
            >
              <span class="mono-label">/{{ selected.id }}</span>
              <span class="font-mono text-[11px] text-[var(--fg-muted)]">{{ formatBytes(selected.content.length) }} · {{ formatExpiry(selected.expiration) }} left</span>
              <code
                class="
                  ml-auto truncate font-mono text-[11px] text-[var(--fg-faint)]
                "
              >{{ curlHint(selected) }}</code>
            </div>
          </div>

          <div
            v-else class="
              grid h-full min-h-72 place-items-center text-[13px]
              text-[var(--fg-muted)]
            "
          >
            Select a snippet, or save a new one.
          </div>
        </section>
      </div>

      <template #fallback>
        <div class="grid h-[60vh] place-items-center text-[var(--fg-muted)]">
          <Loader :size="18" class="animate-spin" />
        </div>
      </template>
    </ClientOnly>
  </div>
</template>

<style>
/* Vitesse / antfu palette — scoped to .clip so it never leaks into the dashboard. */
.clip {
  --bg-base: #ffffff;
  --bg-inline: #f4f4f5;
  --bg-hover: #f4f4f5;
  --bg-code: #ffffff;
  --fg-primary: #11151c;
  --fg-muted: #75797f;
  --fg-faint: #a0a3a8;
  --border-subtle: #ededee;
  --border-strong: #dbdcdf;
  --accent: #4d9375;
  --accent-hover: #3f7c62;
  --accent-soft: #4d937514;
  --danger: #ab5959;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-family: var(--font-sans);
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.dark .clip {
  --bg-base: #121212;
  --bg-inline: #1b1b1c;
  --bg-hover: #171717;
  --bg-code: #121212;
  --fg-primary: #e9e6e0;
  --fg-muted: #64615d;
  --fg-faint: #4a4844;
  --border-subtle: #232323;
  --border-strong: #2f2f30;
  --accent: #4d9375;
  --accent-hover: #6cb196;
  --accent-soft: #4d937518;
  --danger: #cb7676;
}

.clip .mono-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fg-muted);
}

.clip .field {
  height: 2.25rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.375rem;
  background: var(--bg-base);
  padding: 0 0.5rem;
  font-size: 13px;
  color: var(--fg-primary);
  outline: none;
  transition: border-color 0.15s;
}
.clip textarea.field,
.clip input.field {
  background: var(--bg-inline);
  font-family: var(--font-mono);
  padding: 0.5rem 0.75rem;
}
.clip .field:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.clip .btn-accent {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border-radius: 0.375rem;
  background: var(--accent);
  padding: 0 0.625rem;
  height: 2.25rem;
  font-size: 12px;
  font-weight: 500;
  color: #fff;
  transition: background 0.15s;
}
.clip .btn-accent:hover {
  background: var(--accent-hover);
}
.clip .btn-accent:disabled {
  opacity: 0.6;
}

.clip .icon-btn {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.375rem;
  color: var(--fg-muted);
  transition:
    background 0.15s,
    color 0.15s;
}
.clip .icon-btn:hover {
  background: var(--bg-hover);
  color: var(--fg-primary);
}

/* Code views: Shiki sits transparent on the canvas (dual-theme via CSS vars). */
.clip .paste-code,
.clip .paste-raw,
.clip .md-body {
  max-height: calc(100vh - 9rem);
  overflow: auto;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}
.clip .paste-raw {
  padding: 1rem;
  font-family: var(--font-mono);
  white-space: pre;
  color: var(--fg-primary);
}
.clip .paste-code .shiki {
  padding: 1rem;
  background: transparent !important;
}
.clip .paste-code .shiki,
.clip .paste-code .shiki span {
  color: var(--shiki-light);
}
.dark .clip .paste-code .shiki,
.dark .clip .paste-code .shiki span {
  color: var(--shiki-dark) !important;
}

/* Markdown preview — Vitesse-tuned typography. */
.clip .md-body {
  padding: 1.25rem 1.5rem;
  font-family: var(--font-sans);
  font-size: 14.5px;
  color: var(--fg-primary);
}
.clip .md-body h1,
.clip .md-body h2,
.clip .md-body h3 {
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 1.4em 0 0.6em;
  line-height: 1.3;
}
.clip .md-body h1 {
  font-size: 1.5em;
}
.clip .md-body h2 {
  font-size: 1.25em;
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: 0.3em;
}
.clip .md-body h3 {
  font-size: 1.1em;
}
.clip .md-body p,
.clip .md-body ul,
.clip .md-body ol,
.clip .md-body blockquote {
  margin: 0.75em 0;
}
.clip .md-body ul,
.clip .md-body ol {
  padding-left: 1.4em;
}
.clip .md-body li {
  margin: 0.25em 0;
}
.clip .md-body a {
  color: var(--accent);
  text-decoration: none;
}
.clip .md-body a:hover {
  text-decoration: underline;
}
.clip .md-body code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--bg-inline);
  padding: 0.15em 0.35em;
  border-radius: 4px;
}
.clip .md-body pre {
  background: var(--bg-inline);
  border-radius: 8px;
  padding: 0;
  overflow: auto;
  margin: 0.9em 0;
}
.clip .md-body pre code {
  background: none;
  padding: 0;
}
.clip .md-body pre .shiki {
  padding: 0.9rem 1rem;
  background: transparent !important;
}
.clip .md-body pre .shiki,
.clip .md-body pre .shiki span {
  color: var(--shiki-light);
}
.dark .clip .md-body pre .shiki,
.dark .clip .md-body pre .shiki span {
  color: var(--shiki-dark) !important;
}
.clip .md-body blockquote {
  border-left: 3px solid var(--border-strong);
  padding-left: 1em;
  color: var(--fg-muted);
}
.clip .md-body table {
  border-collapse: collapse;
  font-size: 0.9em;
}
.clip .md-body th,
.clip .md-body td {
  border: 1px solid var(--border-subtle);
  padding: 0.4em 0.7em;
}
.clip .md-body hr {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 1.5em 0;
}
.clip .md-body img {
  max-width: 100%;
  border-radius: 8px;
}
</style>
