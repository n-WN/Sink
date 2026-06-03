<script setup lang="ts">
import { Check, ClipboardList, Copy, Download, File as FileIcon, Flame, Loader, LockKeyhole } from 'lucide-vue-next'
import { highlightFallback, highlightToHtml, resolveLang } from '@/composables/useHighlighter'
import { renderMarkdown } from '@/composables/useMarkdown'

definePageMeta({ layout: false })

type ViewMode = 'highlight' | 'raw' | 'preview'

const INLINE_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

interface SharedPaste {
  id: string
  kind: 'text' | 'file'
  content?: string
  lang: string
  title?: string
  burn: boolean
  hasPassword: boolean
  expiration: number
  size?: number
  mime?: string
  filename?: string
}

const route = useRoute()
const id = computed(() => String(route.params.id ?? ''))

const status = ref<'loading' | 'ok' | 'password' | 'error'>('loading')
const errorMsg = ref('')
const passwordInput = ref('')
const usedPassword = ref('')
const submitting = ref(false)

const paste = ref<SharedPaste | null>(null)
const view = ref<ViewMode>('highlight')
const highlighted = ref('')
const rendered = ref('')
const copied = ref(false)
let renderRun = 0

const isImage = computed(() => paste.value?.kind === 'file' && !!paste.value.mime && INLINE_IMAGE_MIME.has(paste.value.mime))
// The file is fetched as a blob (password via header, never in the URL) into an object URL.
const fileUrl = ref('')

function clearFileUrl() {
  if (fileUrl.value) {
    URL.revokeObjectURL(fileUrl.value)
    fileUrl.value = ''
  }
}

async function loadFile() {
  clearFileUrl()
  const headers: Record<string, string> = {}
  if (usedPassword.value)
    headers['x-paste-password'] = usedPassword.value
  const blob = await $fetch<Blob>(`/api/paste/${id.value}/raw`, { headers, responseType: 'blob' })
  fileUrl.value = URL.createObjectURL(blob)
}

useHead(() => ({ title: paste.value?.title ? `${paste.value.title} · clip` : `clip / ${id.value}` }))

function formatBytes(size: number): string {
  if (size < 1024)
    return `${size} B`
  if (size < 1024 * 1024)
    return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

let loadRun = 0
async function load(password?: string) {
  const run = ++loadRun
  const reqId = id.value
  submitting.value = true
  try {
    const res = await $fetch<SharedPaste>(`/api/paste/${reqId}/share`, {
      method: 'POST',
      body: { password },
    })
    if (run !== loadRun || reqId !== id.value)
      return // route changed mid-flight; drop stale response
    paste.value = res
    usedPassword.value = password ?? ''
    view.value = resolveLang(res.lang) === 'markdown' ? 'preview' : 'highlight'
    status.value = 'ok'
    if (res.kind === 'file')
      await loadFile()
    else
      await renderView()
  }
  catch (e: unknown) {
    if (run !== loadRun || reqId !== id.value)
      return
    const err = e as { status?: number, data?: { data?: { hasPassword?: boolean } } }
    if (err.status === 401 && err.data?.data?.hasPassword) {
      status.value = 'password'
      if (password)
        errorMsg.value = 'Wrong password'
    }
    else if (err.status === 404) {
      status.value = 'error'
      errorMsg.value = 'This snippet does not exist, has expired, or was burned after reading.'
    }
    else if (err.status === 401) {
      status.value = 'error'
      errorMsg.value = 'Access denied.'
    }
    else {
      status.value = 'error'
      errorMsg.value = 'Failed to load this snippet.'
    }
  }
  finally {
    submitting.value = false
  }
}

async function renderView() {
  if (!paste.value || paste.value.kind === 'file')
    return
  const run = ++renderRun
  const content = paste.value.content ?? ''
  if (view.value === 'highlight') {
    highlighted.value = highlightFallback(content)
    try {
      const html = await highlightToHtml(content, resolveLang(paste.value.lang))
      if (run === renderRun)
        highlighted.value = html
    }
    catch { /* keep fallback */ }
  }
  else if (view.value === 'preview') {
    try {
      const html = await renderMarkdown(content)
      if (run === renderRun)
        rendered.value = html
    }
    catch { /* ignore */ }
  }
}

watch(view, () => renderView())

// Re-fetch when navigating between /s links in the same tab (component is reused).
watch(() => route.params.id, () => {
  paste.value = null
  highlighted.value = ''
  rendered.value = ''
  passwordInput.value = ''
  errorMsg.value = ''
  clearFileUrl()
  status.value = 'loading'
  load()
})

onBeforeUnmount(clearFileUrl)

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  }
  catch { /* ignore */ }
}

function download() {
  if (!paste.value)
    return
  const blob = new Blob([paste.value.content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${paste.value.title || paste.value.id}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  load()
})
</script>

<template>
  <div
    class="
      clip flex min-h-[100dvh] flex-col bg-[var(--bg-base)] font-sans
      text-[var(--fg-primary)] antialiased
    "
  >
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
        <span class="mono-label">shared</span>
      </div>
      <span v-if="paste" class="mono-label">{{ paste.kind === 'file' ? (paste.mime || 'file') : resolveLang(paste.lang) }}</span>
    </header>

    <ClientOnly>
      <div
        v-if="status === 'loading'" class="
          grid flex-1 place-items-center text-[var(--fg-muted)]
        "
      >
        <Loader :size="18" class="animate-spin" />
      </div>

      <!-- Password prompt -->
      <div
        v-else-if="status === 'password'" class="
          grid flex-1 place-items-center px-4
        "
      >
        <div
          class="
            w-full max-w-sm rounded-xl border border-[var(--border-subtle)] p-6
          "
        >
          <div class="flex items-center gap-2">
            <LockKeyhole
              :size="15" :stroke-width="1.75" class="text-[var(--accent)]"
            />
            <h2 class="text-[17px] font-semibold tracking-[-0.02em]">
              Password required
            </h2>
          </div>
          <p class="mt-1 text-[14px] tracking-[-0.016em] text-[var(--fg-muted)]">
            This snippet is protected.
          </p>
          <form class="mt-5" @submit.prevent="load(passwordInput)">
            <input
              v-model="passwordInput"
              type="password"
              placeholder="read password"
              autocomplete="off"
              class="field w-full"
            >
            <p v-if="errorMsg" class="mt-1.5 text-[12px] text-[var(--danger)]">
              {{ errorMsg }}
            </p>
            <button
              type="submit" :disabled="submitting" class="
                btn-accent mt-4 w-full justify-center
              "
            >
              <Loader v-if="submitting" :size="14" class="animate-spin" />
              View
            </button>
          </form>
        </div>
      </div>

      <!-- Error -->
      <div
        v-else-if="status === 'error'" class="
          grid flex-1 place-items-center px-4 text-center
        "
      >
        <div class="max-w-sm">
          <Flame
            :size="22" :stroke-width="1.5" class="
              mx-auto text-[var(--fg-faint)]
            "
          />
          <p class="mt-3 text-[14px] text-[var(--fg-muted)]">
            {{ errorMsg }}
          </p>
        </div>
      </div>

      <!-- Snippet -->
      <div
        v-else-if="paste" class="
          mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col
        "
      >
        <div
          class="
            flex h-12 shrink-0 items-center justify-between gap-2 border-b
            border-[var(--border-subtle)] px-4
          "
        >
          <span class="truncate font-mono text-[13px] text-[var(--fg-muted)]">{{ paste.title || paste.id }}</span>
          <div class="flex shrink-0 items-center gap-1">
            <nav
              v-if="paste.kind !== 'file'" class="mr-2 flex items-center gap-3"
            >
              <button
                v-for="m in (['highlight', 'preview', 'raw'] as const)"
                :key="m"
                type="button"
                class="
                  relative pb-0.5 font-mono text-[11px] tracking-wider uppercase
                  transition-colors
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
                    absolute right-0 -bottom-px left-0 h-px bg-[var(--accent)]
                  "
                />
              </button>
            </nav>
            <button v-if="paste.kind !== 'file'" type="button" class="icon-btn" title="Copy content" @click="copyText(paste.content ?? '')">
              <Check v-if="copied" :size="14" :stroke-width="1.75" />
              <Copy v-else :size="14" :stroke-width="1.75" />
            </button>
            <a
              v-if="paste.kind === 'file'" :href="fileUrl" :download="paste.filename || paste.id" class="
                icon-btn
              " title="Download"
            >
              <Download :size="14" :stroke-width="1.75" />
            </a>
            <button v-else type="button" class="icon-btn" title="Download" @click="download">
              <Download :size="14" :stroke-width="1.75" />
            </button>
          </div>
        </div>

        <div class="min-h-0 min-w-0 flex-1 overflow-auto">
          <template v-if="paste.kind === 'file'">
            <div class="grid h-full place-items-center p-6">
              <img
                v-if="isImage" :src="fileUrl" :alt="paste.filename || paste.id" class="
                  max-h-full max-w-full rounded-md object-contain
                "
              >
              <div v-else class="flex flex-col items-center gap-3 text-center">
                <FileIcon
                  :size="40" :stroke-width="1.25" class="text-[var(--fg-faint)]"
                />
                <div class="font-mono text-[13px] text-[var(--fg-muted)]">
                  {{ paste.filename || paste.id }}
                </div>
                <a
                  :href="fileUrl" :download="paste.filename || paste.id" class="
                    btn-accent
                  "
                >
                  <Download :size="14" :stroke-width="1.75" /> Download
                </a>
              </div>
            </div>
          </template>
          <template v-else>
            <!-- eslint-disable vue/no-v-html -->
            <div v-show="view === 'highlight'" class="paste-code" v-html="highlighted" />
            <div v-show="view === 'preview'" class="md-body" v-html="rendered" />
            <!-- eslint-enable vue/no-v-html -->
            <pre v-show="view === 'raw'" class="paste-raw">{{ paste.content }}</pre>
          </template>
        </div>

        <div
          class="
            flex shrink-0 items-center gap-2 border-t
            border-[var(--border-subtle)] px-4 py-2
          "
        >
          <span class="font-mono text-[11px] text-[var(--fg-muted)]">{{ formatBytes(paste.size ?? paste.content?.length ?? 0) }}</span>
          <span
            v-if="paste.burn" class="
              inline-flex items-center gap-1 font-mono text-[11px]
              text-[var(--danger)]
            "
          >
            <Flame :size="11" :stroke-width="2" /> burned after this view
          </span>
        </div>
      </div>

      <template #fallback>
        <div class="grid flex-1 place-items-center text-[var(--fg-muted)]">
          <Loader :size="18" class="animate-spin" />
        </div>
      </template>
    </ClientOnly>
  </div>
</template>
