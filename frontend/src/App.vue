<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import packageInfo from '../package.json'
import type { DfmGraph, ParseError } from './types'
import { translate, type Locale } from './i18n'

const DfmGraphView = defineAsyncComponent(() => import('./components/DfmGraphView.vue'))
const DfmSourceEditor = defineAsyncComponent(() => import('./components/DfmSourceEditor.vue'))
const editorVersion = packageInfo.version

const example = `fact Sales {
    Revenue;
    {descriptive} Salesperson;
};

dimension Time {
    Day - Month - Year;
};

Sales - Time;
`

const source = ref(example)
const notes = ref('')
const locale = ref<Locale>('de')
const graph = ref<DfmGraph | null>(null)
const lastRenderedSource = ref<string | null>(null)
const parseError = ref<ParseError | null>(null)
const copyStatus = ref<'notesCopied' | 'notesCopyFailed' | null>(null)
const isLoading = ref(false)
const status = computed(() => {
  if (isLoading.value) return translate(locale.value, 'analyzing')
  if (parseError.value) return translate(locale.value, 'parseErrorStatus')
  if (graph.value && lastRenderedSource.value !== source.value) {
    return translate(locale.value, 'changesNotRun')
  }
  return translate(locale.value, 'ready')
})
const elementCount = computed(() => {
  if (!graph.value) return null
  return graph.value.nodes.length === 1
    ? translate(locale.value, 'oneElement')
    : translate(locale.value, 'manyElements', { count: graph.value.nodes.length })
})

let requestController: AbortController | undefined

function toggleLocale() {
  locale.value = locale.value === 'de' ? 'en' : 'de'
}

function resetEditor() {
  requestController?.abort()
  requestController = undefined
  source.value = ''
  graph.value = null
  lastRenderedSource.value = ''
  parseError.value = null
  isLoading.value = false
}

function isParseError(value: unknown): value is ParseError {
  return typeof value === 'object'
    && value !== null
    && 'message' in value
    && typeof value.message === 'string'
    && (!('line' in value) || value.line === null || typeof value.line === 'number')
    && (!('column' in value) || value.column === null || typeof value.column === 'number')
}

function isDfmGraph(value: unknown): value is DfmGraph {
  if (typeof value !== 'object' || value === null || !('nodes' in value) || !('edges' in value)) {
    return false
  }
  return Array.isArray(value.nodes)
    && value.nodes.every((node) =>
      typeof node === 'object'
      && node !== null
      && 'id' in node
      && typeof node.id === 'string'
      && 'label' in node
      && typeof node.label === 'string'
      && 'type' in node
      && typeof node.type === 'string')
    && Array.isArray(value.edges)
    && value.edges.every((edge) =>
      typeof edge === 'object'
      && edge !== null
      && 'source' in edge
      && typeof edge.source === 'string'
      && 'target' in edge
      && typeof edge.target === 'string')
}

async function visualize() {
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  const sourceToVisualize = source.value
  isLoading.value = true
  parseError.value = null

  try {
    const response = await fetch('/api/dfm/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: sourceToVisualize,
      signal: controller.signal,
    })
    const body: unknown = await response.json()

    if (!response.ok) {
      parseError.value = isParseError(body)
        ? body
        : { message: translate(locale.value, 'requestFailed', { status: response.status }) }
      graph.value = null
      return
    }

    if (!isDfmGraph(body)) {
      parseError.value = { message: translate(locale.value, 'invalidGraph') }
      graph.value = null
      return
    }
    graph.value = body
    lastRenderedSource.value = sourceToVisualize
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    parseError.value = { message: translate(locale.value, 'visualizationFailed') }
    graph.value = null
  } finally {
    if (!controller.signal.aborted) isLoading.value = false
  }
}

watch(source, () => {
  parseError.value = null
})

watch(notes, () => {
  copyStatus.value = null
})

watch(locale, (selectedLocale) => {
  document.documentElement.lang = selectedLocale
  document.querySelector('meta[name="description"]')?.setAttribute(
    'content',
    translate(selectedLocale, 'appDescription'),
  )
})

async function copyNotes() {
  try {
    await navigator.clipboard.writeText(notes.value)
    copyStatus.value = 'notesCopied'
  } catch {
    copyStatus.value = 'notesCopyFailed'
  }
}

onBeforeUnmount(() => {
  requestController?.abort()
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">DIMENSIONAL FACT MODEL</p>
        <h1>DFM Editor</h1>
      </div>
      <div class="topbar-actions">
        <button
          class="language-button"
          type="button"
          :aria-label="translate(locale, locale === 'de' ? 'switchToEnglish' : 'switchToGerman')"
          @click="toggleLocale"
        >
          {{ translate(locale, locale === 'de' ? 'languageEnglish' : 'languageGerman') }}
        </button>
      </div>
    </header>

    <div class="workspace">
      <section class="panel editor-panel" aria-labelledby="editor-title">
        <div class="panel-heading">
          <div class="editor-heading-content">
            <p class="eyebrow">{{ translate(locale, 'input') }}</p>
            <h2 id="editor-title">{{ translate(locale, 'notation') }}</h2>
          </div>
          <span class="status-indicator" :class="{ 'has-error': parseError }">
            {{ status }}
          </span>
        </div>
        <DfmSourceEditor v-model="source" :locale="locale" @load-example="source = example" />
        <div class="editor-actions">
          <button class="run-button" type="button" :disabled="isLoading" @click="visualize">
            {{ translate(locale, 'execute') }}
          </button>
          <button class="reset-button" type="button" @click="resetEditor">
            {{ translate(locale, 'resetEditor') }}
          </button>
        </div>
      </section>

      <section class="panel graph-panel" aria-labelledby="graph-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">{{ translate(locale, 'preview') }}</p>
            <h2 id="graph-title">{{ translate(locale, 'graphTitle') }}</h2>
          </div>
          <span v-if="elementCount" class="graph-count">{{ elementCount }}</span>
        </div>
        <div v-if="parseError" class="error-message" role="alert">
          <strong>{{ parseError.message }}</strong>
          <span v-if="parseError.line">
            {{ translate(locale, 'lineColumn', { line: parseError.line, column: parseError.column ?? '?' }) }}
          </span>
        </div>
        <DfmGraphView :graph="graph" :locale="locale" />
      </section>
    </div>

    <section class="panel notes-panel" aria-labelledby="notes-title">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">{{ translate(locale, 'notesEyebrow') }}</p>
          <h2 id="notes-title">{{ translate(locale, 'notesTitle') }}</h2>
        </div>
        <div class="notes-actions">
          <span v-if="copyStatus" class="notes-feedback" role="status">
            {{ translate(locale, copyStatus) }}
          </span>
          <button
            class="copy-notes-button"
            type="button"
            :disabled="!notes"
            :aria-label="translate(locale, 'copyNotes')"
            :title="translate(locale, 'copyNotes')"
            @click="copyNotes"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="8" y="8" width="13" height="13" rx="2" />
              <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        </div>
      </div>
      <textarea
        v-model="notes"
        class="notes-textarea"
        rows="6"
        :aria-label="translate(locale, 'notesTitle')"
        :placeholder="translate(locale, 'notesPlaceholder')"
      />
    </section>

    <footer class="app-footer">
      <span>{{ translate(locale, 'editorVersion', { version: editorVersion }) }}</span>
      <a
        href="https://www.dke.uni-linz.ac.at/legal_notice.html?lang=de"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ translate(locale, 'legalNotice') }}
      </a>
    </footer>
  </main>
</template>
