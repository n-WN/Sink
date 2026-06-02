<script setup lang="ts">
import type { PasteListItem } from '#shared/schemas/paste'
import { ArrowLeft, Check, ClipboardList, Copy, Download, ExternalLink, Flame, KeyRound, Link2, Loader, Lock, Plus, Scissors, Share2, Trash2, Wand2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useAuthToken } from '@/composables/useAuthToken'
import { HIGHLIGHT_LANGS, highlightFallback, highlightToHtml, resolveLang } from '@/composables/useHighlighter'
import { detectLang } from '@/composables/useLangDetect'
import { renderMarkdown } from '@/composables/useMarkdown'

const props = defineProps<{ routeId?: string }>()

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

// Shared across the `/` and `/p/:id` pages so navigating between them does not re-auth,
// re-list, or flicker (the component remounts, but this state persists for the session).
const ready = useState('clip-ready', () => false)
const authed = useState('clip-authed', () => false)
const listed = useState('clip-listed', () => false)
const pastes = useState<PasteListItem[]>('clip-pastes', () => [])

const tokenInput = ref('')
const unlocking = ref(false)

const draft = reactive({ title: '', lang: 'auto', ttl: 86400, content: '', burn: false, password: '' })
const creating = ref(false)

const selected = ref<PasteFull | null>(null)
const view = ref<ViewMode>('highlight')
const highlighted = ref('')
const rendered = ref('')
const copied = ref(false)
let renderRun = 0

const origin = computed(() => (import.meta.client ? window.location.origin : ''))

function rawUrl(p: PasteFull): string {
  return `${origin.value}/api/paste/${p.id}/raw?k=${encodeURIComponent(p.readKey)}`
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
    listed.value = true
    if (props.routeId)
      await openPaste(props.routeId)
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
  listed.value = false
  pastes.value = []
  selected.value = null
  navigateTo('/')
}

async function createPaste() {
  if (!draft.content.trim()) {
    toast.error('Nothing to save')
    return
  }
  creating.value = true
  try {
    const lang = draft.lang === 'auto' ? await detectLang(draft.content) : draft.lang
    const res = await useAPI<{ paste: PasteListItem }>('/api/paste/create', {
      method: 'POST',
      body: {
        content: draft.content,
        lang,
        title: draft.title || undefined,
        ttl: draft.ttl,
        burn: draft.burn || undefined,
        password: draft.password || undefined,
      },
    })
    pastes.value = [res.paste, ...pastes.value]
    draft.content = ''
    draft.title = ''
    draft.password = ''
    draft.burn = false
    toast.success('Saved', { description: `/${res.paste.id}` })
    navigateTo(`/p/${res.paste.id}`)
  }
  catch (e) {
    toast.error('Failed to save', { description: e instanceof Error ? e.message : String(e) })
  }
  finally {
    creating.value = false
  }
}

let openRun = 0
async function openPaste(id: string) {
  const run = ++openRun
  try {
    const res = await useAPI<{ paste: PasteFull }>(`/api/paste/${id}`)
    if (run !== openRun)
      return // a newer selection won; drop this stale response
    selected.value = res.paste
    view.value = resolveLang(res.paste.lang) === 'markdown' ? 'preview' : 'highlight'
  }
  catch (e) {
    if (run !== openRun)
      return
    selected.value = null
    toast.error('Failed to open', { description: e instanceof Error ? e.message : String(e) })
  }
}

async function removePaste(id: string) {
  try {
    await useAPI(`/api/paste/${id}`, { method: 'DELETE' })
    pastes.value = pastes.value.filter(p => p.id !== id)
    toast.success('Deleted')
    if (selected.value?.id === id)
      navigateTo('/')
  }
  catch (e) {
    toast.error('Failed to delete', { description: e instanceof Error ? e.message : String(e) })
  }
}

// Single render path, guarded against out-of-order async results (Codex finding).
async function renderViewFor(paste: PasteFull | null, mode: ViewMode) {
  const run = ++renderRun
  if (!paste) {
    highlighted.value = ''
    rendered.value = ''
    return
  }
  if (mode === 'highlight') {
    highlighted.value = highlightFallback(paste.content)
    try {
      const html = await highlightToHtml(paste.content, resolveLang(paste.lang))
      if (run === renderRun)
        highlighted.value = html
    }
    catch { /* keep fallback */ }
  }
  else if (mode === 'preview') {
    rendered.value = ''
    try {
      const html = await renderMarkdown(paste.content)
      if (run === renderRun)
        rendered.value = html
    }
    catch (e) {
      toast.error('Failed to render', { description: e instanceof Error ? e.message : String(e) })
    }
  }
}

watch([selected, view], ([paste, mode]) => {
  void renderViewFor(paste as PasteFull | null, mode as ViewMode)
}, { flush: 'post' })

// Drive selection from the route so snippets are deep-linkable and back/forward work.
watch(() => props.routeId, (id) => {
  if (!authed.value)
    return
  if (id)
    openPaste(id)
  else
    selected.value = null
})

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

function viewUrl(p: PasteFull): string {
  return `${origin.value}/s/${p.id}?k=${encodeURIComponent(p.readKey)}`
}

const shareOpen = ref(false)
const shortening = ref(false)
const shortLink = ref('')

function passwordHint(p: PasteFull) {
  if (p.hasPassword)
    toast.info('Password-protected', { description: 'Share the read password separately.' })
}

function copyViewUrl(p: PasteFull) {
  copyText(viewUrl(p), 'View link copied')
  passwordHint(p)
  shareOpen.value = false
}

function copyRawUrl(p: PasteFull) {
  copyText(rawUrl(p), 'Raw link copied')
  passwordHint(p)
  shareOpen.value = false
}

// Integrate with the link shortener: turn the share view URL into a short slug, then copy it.
// The clipboard write must START inside the click's user-activation window, so we hand the
// Clipboard API a deferred Blob promise rather than awaiting the network first (a plain
// writeText after `await` is rejected by the browser as a non-user-gesture write).
async function shorten(p: PasteFull) {
  shortening.value = true
  shortLink.value = ''
  const linkPromise = useAPI<{ shortLink: string }>('/api/link/create', {
    method: 'POST',
    body: { url: viewUrl(p), comment: `paste:${p.id}`, expiration: p.expiration },
  }).then(res => res.shortLink)

  try {
    let writePromise: Promise<void> | undefined
    const canDeferredWrite = import.meta.client && window.isSecureContext
      && typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
    if (canDeferredWrite) {
      writePromise = navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': linkPromise.then(l => new Blob([l], { type: 'text/plain' })) }),
      ])
    }

    shortLink.value = await linkPromise // surfaces network errors

    if (writePromise) {
      await writePromise
      toast.success('Short link copied')
      passwordHint(p)
      shareOpen.value = false
    }
    else {
      // Clipboard unavailable: keep the menu open with the copyable field.
      toast.info('Short link ready', { description: 'Copy it from the field below.' })
    }
  }
  catch (e) {
    if (shortLink.value) {
      // Link created but the clipboard write was blocked — show it for manual copy.
      toast.warning('Copy blocked', { description: 'Copy the short link from the field below.' })
    }
    else {
      toast.error('Failed to shorten', { description: e instanceof Error ? e.message : String(e) })
    }
  }
  finally {
    shortening.value = false
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
  // Only auth + list once per session; remounts (page switches) reuse shared state.
  if (!ready.value) {
    authed.value = await checkAuth()
    if (authed.value && !listed.value) {
      await loadList()
      listed.value = true
    }
    ready.value = true
  }
  if (authed.value && props.routeId)
    await openPaste(props.routeId)
})
</script>

<template>
  <div
    class="
      clip flex h-[100dvh] flex-col bg-[var(--bg-base)] font-sans
      text-[var(--fg-primary)] antialiased
    "
  >
    <!-- Top bar -->
    <header
      class="
        flex h-12 shrink-0 items-center justify-between border-b
        border-[var(--border-subtle)] px-4
      "
    >
      <div class="flex items-center gap-2">
        <NuxtLink to="/" aria-label="clip home" class="flex items-center gap-2">
          <ClipboardList
            :size="16" :stroke-width="1.75" class="text-[var(--accent)]"
          />
          <span class="font-mono text-[13px] font-medium tracking-tight">clip</span>
        </NuxtLink>
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
          grid flex-1 place-items-center text-[var(--fg-muted)]
        "
      >
        <Loader :size="18" class="animate-spin" />
      </div>

      <!-- Auth gate -->
      <div v-else-if="!authed" class="grid flex-1 place-items-center px-4">
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
        v-else
        class="
          grid min-h-0 flex-1 grid-cols-1 gap-px overflow-hidden
          bg-[var(--border-subtle)]
          lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]
        "
      >
        <!-- Left: composer + list (hidden on phones while a snippet is open) -->
        <section
          class="
            min-h-0 min-w-0 flex-col gap-4 overflow-auto bg-[var(--bg-base)] p-4
          "
          :class="selected ? `
            hidden
            lg:flex
          ` : 'flex'"
        >
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
                block h-40 w-full resize-y bg-transparent p-3 font-mono
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
                v-model="draft.lang" aria-label="Language" class="
                  field min-w-0 flex-1
                "
              >
                <option value="auto">
                  Auto-detect
                </option>
                <option v-for="l in HIGHLIGHT_LANGS" :key="l.id" :value="l.id">
                  {{ l.label }}
                </option>
              </select>
              <select
                v-model.number="draft.ttl" aria-label="Expiry" class="
                  field min-w-0 flex-1
                "
              >
                <option v-for="t in TTL_OPTIONS" :key="t.value" :value="t.value">
                  {{ t.label }}
                </option>
              </select>
            </div>
            <div
              class="
                flex items-center gap-3 border-t border-[var(--border-subtle)]
                px-3 py-2
              "
            >
              <label class="flex cursor-pointer items-center gap-1.5" title="Delete after the first read via the shared link">
                <input
                  v-model="draft.burn" type="checkbox" class="
                    accent-[var(--accent)]
                  "
                >
                <Flame
                  :size="13" :stroke-width="1.75" class="text-[var(--fg-muted)]"
                />
                <span class="mono-label tracking-normal normal-case">burn</span>
              </label>
              <div class="flex min-w-0 flex-1 items-center gap-1.5">
                <KeyRound
                  :size="13" :stroke-width="1.75" class="
                    shrink-0 text-[var(--fg-muted)]
                  "
                />
                <input
                  v-model="draft.password" type="password" autocomplete="off" placeholder="read password (optional)" class="
                    w-full min-w-0 bg-transparent text-[12px] outline-none
                    placeholder:text-[var(--fg-faint)]
                  "
                >
              </div>
              <button
                type="button" :disabled="creating" class="btn-accent shrink-0" @click="createPaste"
              >
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
              @click="navigateTo(`/p/${p.id}`)"
            >
              <Flame
                v-if="p.burn" :size="13" :stroke-width="1.75" class="
                  shrink-0 text-[var(--danger)]
                "
              />
              <KeyRound
                v-else-if="p.hasPassword" :size="13" :stroke-width="1.75" class="
                  shrink-0 text-[var(--fg-muted)]
                "
              />
              <span class="min-w-0 flex-1 truncate text-[13px] tracking-tight">{{ p.title || p.id }}</span>
              <span class="mono-label tracking-normal normal-case">{{ p.lang }}</span>
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

        <!-- Right: viewer (full screen on phones; empty prompt hidden on phones) -->
        <section
          class="min-h-0 min-w-0 overflow-hidden bg-[var(--bg-base)]"
          :class="selected ? 'block' : `
            hidden
            lg:block
          `"
        >
          <div v-if="selected" class="flex h-full min-h-0 min-w-0 flex-col">
            <div
              class="
                flex h-12 shrink-0 items-center justify-between gap-2 border-b
                border-[var(--border-subtle)] px-4
              "
            >
              <div class="flex min-w-0 items-center gap-2">
                <span
                  class="
                    contents
                    lg:hidden
                  "
                >
                  <button type="button" class="icon-btn" title="Back" @click="navigateTo('/')">
                    <ArrowLeft :size="15" :stroke-width="1.75" />
                  </button>
                </span>
                <Flame
                  v-if="selected.burn" :size="14" :stroke-width="1.75" class="
                    shrink-0 text-[var(--danger)]
                  "
                />
                <KeyRound
                  v-else-if="selected.hasPassword" :size="14" :stroke-width="1.75" class="
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
                <div class="relative">
                  <button type="button" class="icon-btn" title="Share" @click="shareOpen = !shareOpen">
                    <Share2 :size="14" :stroke-width="1.75" />
                  </button>
                  <template v-if="shareOpen">
                    <div class="fixed inset-0 z-10" @click="shareOpen = false; shortLink = ''" />
                    <div class="share-menu">
                      <button type="button" class="share-item" @click="copyViewUrl(selected)">
                        <ExternalLink :size="13" :stroke-width="1.75" /> View link
                      </button>
                      <button type="button" class="share-item" @click="copyRawUrl(selected)">
                        <Link2 :size="13" :stroke-width="1.75" /> Raw link
                      </button>
                      <button type="button" class="share-item" :disabled="shortening" @click="shorten(selected)">
                        <Scissors :size="13" :stroke-width="1.75" /> {{ shortening ? 'Shortening…' : 'Short link' }}
                      </button>
                      <div
                        v-if="shortLink" class="
                          mt-1 border-t border-[var(--border-subtle)] p-1.5
                        "
                      >
                        <input
                          :value="shortLink"
                          readonly
                          aria-label="Short URL"
                          class="field w-full"
                          @focus="(e) => (e.target as HTMLInputElement).select()"
                        >
                        <button type="button" class="share-item mt-1" @click="copyText(shortLink, 'Short link copied')">
                          <Copy :size="13" :stroke-width="1.75" /> Copy short link
                        </button>
                      </div>
                    </div>
                  </template>
                </div>
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

            <div class="min-h-0 min-w-0 flex-1 overflow-auto">
              <!-- eslint-disable vue/no-v-html -->
              <div v-show="view === 'highlight'" class="paste-code" v-html="highlighted" />
              <div v-show="view === 'preview'" class="md-body" v-html="rendered" />
              <!-- eslint-enable vue/no-v-html -->
              <pre v-show="view === 'raw'" class="paste-raw">{{ selected.content }}</pre>
            </div>

            <div
              class="
                flex shrink-0 items-center gap-2 border-t
                border-[var(--border-subtle)] px-4 py-2
              "
            >
              <span class="mono-label">/{{ selected.id }}</span>
              <span class="font-mono text-[11px] text-[var(--fg-muted)]">{{ resolveLang(selected.lang) }} · {{ formatBytes(selected.content.length) }} · {{ formatExpiry(selected.expiration) }} left</span>
              <span
                v-if="selected.burn" class="
                  ml-auto inline-flex items-center gap-1 font-mono text-[11px]
                  text-[var(--danger)]
                "
              >
                <Flame :size="11" :stroke-width="2" /> burns on first read
              </span>
            </div>
          </div>

          <div
            v-else class="
              grid h-full min-h-0 place-items-center text-[13px]
              text-[var(--fg-muted)]
            "
          >
            <span class="inline-flex items-center gap-2"><Wand2 :size="15" :stroke-width="1.75" /> Select a snippet, or save a new one.</span>
          </div>
        </section>
      </div>

      <template #fallback>
        <div class="grid flex-1 place-items-center text-[var(--fg-muted)]">
          <Loader :size="18" class="animate-spin" />
        </div>
      </template>
    </ClientOnly>
  </div>
</template>
