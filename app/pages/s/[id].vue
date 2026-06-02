<script setup lang="ts">
import { Check, ClipboardList, Copy, Download, Flame, Loader, LockKeyhole } from 'lucide-vue-next'
import { highlightFallback, highlightToHtml, resolveLang } from '@/composables/useHighlighter'
import { renderMarkdown } from '@/composables/useMarkdown'

definePageMeta({ layout: false })

type ViewMode = 'highlight' | 'raw' | 'preview'

interface SharedPaste {
  id: string
  content: string
  lang: string
  title?: string
  burn: boolean
  hasPassword: boolean
  expiration: number
}

const route = useRoute()
const id = computed(() => String(route.params.id ?? ''))
const key = computed(() => String(route.query.k ?? ''))

const status = ref<'loading' | 'ok' | 'password' | 'error'>('loading')
const errorMsg = ref('')
const passwordInput = ref('')
const submitting = ref(false)

const paste = ref<SharedPaste | null>(null)
const view = ref<ViewMode>('highlight')
const highlighted = ref('')
const rendered = ref('')
const copied = ref(false)
let renderRun = 0

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
  const reqKey = key.value
  submitting.value = true
  try {
    const res = await $fetch<SharedPaste>(`/api/paste/${reqId}/share`, {
      method: 'POST',
      body: { k: reqKey, password },
    })
    if (run !== loadRun || reqId !== id.value || reqKey !== key.value)
      return // route changed mid-flight; drop stale response
    paste.value = res
    view.value = resolveLang(res.lang) === 'markdown' ? 'preview' : 'highlight'
    status.value = 'ok'
    await renderView()
  }
  catch (e: unknown) {
    if (run !== loadRun || reqId !== id.value || reqKey !== key.value)
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
      errorMsg.value = 'Invalid or missing share key.'
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
  if (!paste.value)
    return
  const run = ++renderRun
  if (view.value === 'highlight') {
    highlighted.value = highlightFallback(paste.value.content)
    try {
      const html = await highlightToHtml(paste.value.content, resolveLang(paste.value.lang))
      if (run === renderRun)
        highlighted.value = html
    }
    catch { /* keep fallback */ }
  }
  else if (view.value === 'preview') {
    try {
      const html = await renderMarkdown(paste.value.content)
      if (run === renderRun)
        rendered.value = html
    }
    catch { /* ignore */ }
  }
}

watch(view, () => renderView())

// Re-fetch when navigating between /s links in the same tab (component is reused).
watch([() => route.params.id, () => route.query.k], () => {
  paste.value = null
  highlighted.value = ''
  rendered.value = ''
  passwordInput.value = ''
  errorMsg.value = ''
  if (!key.value) {
    status.value = 'error'
    errorMsg.value = 'Missing share key.'
    return
  }
  status.value = 'loading'
  load()
})

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
  if (!key.value) {
    status.value = 'error'
    errorMsg.value = 'Missing share key.'
    return
  }
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
      <span v-if="paste" class="mono-label">{{ resolveLang(paste.lang) }}</span>
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
            <nav class="mr-2 flex items-center gap-3">
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
            <button type="button" class="icon-btn" title="Copy content" @click="copyText(paste.content)">
              <Check v-if="copied" :size="14" :stroke-width="1.75" />
              <Copy v-else :size="14" :stroke-width="1.75" />
            </button>
            <button type="button" class="icon-btn" title="Download" @click="download">
              <Download :size="14" :stroke-width="1.75" />
            </button>
          </div>
        </div>

        <div class="min-h-0 min-w-0 flex-1 overflow-auto">
          <!-- eslint-disable vue/no-v-html -->
          <div v-show="view === 'highlight'" class="paste-code" v-html="highlighted" />
          <div v-show="view === 'preview'" class="md-body" v-html="rendered" />
          <!-- eslint-enable vue/no-v-html -->
          <pre v-show="view === 'raw'" class="paste-raw">{{ paste.content }}</pre>
        </div>

        <div
          class="
            flex shrink-0 items-center gap-2 border-t
            border-[var(--border-subtle)] px-4 py-2
          "
        >
          <span class="font-mono text-[11px] text-[var(--fg-muted)]">{{ formatBytes(paste.content.length) }}</span>
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
