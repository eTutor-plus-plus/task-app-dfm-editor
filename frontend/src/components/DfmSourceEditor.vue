<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup, EditorView } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { StreamLanguage } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { translate, type Locale } from '../i18n'
import CopyButton from './CopyButton.vue'

const props = defineProps<{ modelValue: string; locale: Locale }>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  loadExample: []
}>()

const host = ref<HTMLDivElement | null>(null)
let editor: EditorView | undefined

const dfmLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match(/\b(?:fact|dimension|descriptive)\b/i)) return 'keyword'
    if (stream.match(/->|[-=]/)) return 'operator'
    if (stream.match(/[{}();]/)) return 'bracket'
    if (stream.match(/[A-Za-z0-9_]+/)) return 'variableName'
    stream.next()
    return null
  },
})

function prettifyDfm(source: string) {
  const tokens = source.match(/->|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{}();=,-]|[^\s{}();=,-]+/g) ?? []
  let output = ''
  let indent = 0

  function startLine() {
    if (output.length === 0 || output.endsWith('\n')) {
      output += '  '.repeat(indent)
    }
  }

  function trimTrailingSpaces() {
    output = output.replace(/[ \t]+$/, '')
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (token === '{' && tokens[index + 1]?.toLowerCase() === 'descriptive' && tokens[index + 2] === '}') {
      startLine()
      if (output.length > 0 && !output.endsWith(' ') && !output.endsWith('\n')) output += ' '
      output += `{${tokens[index + 1]}}`
      index += 2
      continue
    }

    if (token === '{') {
      trimTrailingSpaces()
      output += ' {\n'
      indent += 1
      continue
    }

    if (token === '}') {
      trimTrailingSpaces()
      if (output.length > 0 && !output.endsWith('\n')) output += '\n'
      indent = Math.max(0, indent - 1)
      startLine()
      output += '}'
      if (tokens[index + 1] === ';') {
        output += ';'
        index += 1
      }
      output += '\n'
      continue
    }

    if (token === ';') {
      trimTrailingSpaces()
      output += ';\n'
      continue
    }

    if (token === '-' || token === '=' || token === '->') {
      trimTrailingSpaces()
      output += ` ${token} `
      continue
    }

    if (token === ',') {
      trimTrailingSpaces()
      output += ', '
      continue
    }

    if (token === ')') {
      trimTrailingSpaces()
      output += ')'
      continue
    }

    startLine()
    if (output.length > 0 && !output.endsWith(' ') && !output.endsWith('\n') && !output.endsWith('(')) {
      output += ' '
    }
    output += token
  }

  return output.trimEnd() + (output.trim().length > 0 ? '\n' : '')
}

function prettify() {
  if (!editor) return
  const formatted = prettifyDfm(editor.state.doc.toString())
  if (formatted === editor.state.doc.toString()) return

  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: formatted },
    selection: { anchor: formatted.length },
  })
  editor.focus()
}

watch(() => props.modelValue, (value) => {
  if (!editor || editor.state.doc.toString() === value) return
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: value },
  })
})

onMounted(() => {
  if (!host.value) return

  editor = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        dfmLanguage,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': { fontFamily: 'ui-monospace, Consolas, monospace' },
          '.cm-content': { padding: '16px 0' },
          '.cm-gutters': { backgroundColor: '#f8fafc', border: 'none' },
        }),
      ],
    }),
  })
})

onBeforeUnmount(() => editor?.destroy())
</script>

<template>
  <div class="source-editor-container">
    <div class="editor-toolbar">
      <button class="example-button" type="button" @click="emit('loadExample')">
        {{ translate(locale, 'loadExample') }}
      </button>
      <div class="editor-format-actions">
        <button class="format-button" type="button" @click="prettify">
          {{ translate(locale, locale === 'de' ? 'format' : 'prettify') }}
        </button>
        <CopyButton
          :text="modelValue"
          :label="translate(locale, 'copySource')"
          :success-message="translate(locale, 'sourceCopied')"
          :error-message="translate(locale, 'sourceCopyFailed')"
        />
      </div>
    </div>
    <div ref="host" class="source-editor" :aria-label="translate(locale, 'editorLabel')" />
  </div>
</template>
