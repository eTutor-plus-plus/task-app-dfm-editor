<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  text: string
  label: string
  successMessage: string
  errorMessage: string
}>()

const copyStatus = ref<'success' | 'error' | null>(null)
let copyStatusTimeout: ReturnType<typeof setTimeout> | undefined
let copyRequestId = 0

function clearCopyStatus() {
  clearTimeout(copyStatusTimeout)
  copyStatusTimeout = undefined
  copyStatus.value = null
}

function resetCopyStatus() {
  copyRequestId += 1
  clearCopyStatus()
}

function showCopyStatus(status: NonNullable<typeof copyStatus.value>) {
  clearCopyStatus()
  copyStatus.value = status
  copyStatusTimeout = setTimeout(clearCopyStatus, 500)
}

async function copyText() {
  const requestId = ++copyRequestId
  clearCopyStatus()
  try {
    await navigator.clipboard.writeText(props.text)
    if (requestId === copyRequestId) showCopyStatus('success')
  } catch {
    if (requestId === copyRequestId) showCopyStatus('error')
  }
}

watch(() => props.text, resetCopyStatus)
onBeforeUnmount(resetCopyStatus)
</script>

<template>
  <button
    class="copy-button"
    :class="{ 'is-success': copyStatus === 'success', 'is-error': copyStatus === 'error' }"
    type="button"
    :disabled="!text"
    :aria-label="label"
    :title="label"
    @click="copyText"
  >
    <svg v-if="copyStatus === 'success'" class="copy-success-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12l5 5L19 7" />
    </svg>
    <svg v-else-if="copyStatus === 'error'" class="copy-error-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
    <svg v-else class="copy-default-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </svg>
  </button>
  <span class="copy-feedback" role="status" aria-atomic="true">{{ copyStatus === 'success' ? successMessage : copyStatus === 'error' ? errorMessage : '' }}</span>
</template>
