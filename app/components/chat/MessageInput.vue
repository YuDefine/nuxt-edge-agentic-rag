<script setup lang="ts">
  interface Props {
    disabled?: boolean
    loading?: boolean
    placeholder?: string
  }

  const props = withDefaults(defineProps<Props>(), {
    disabled: false,
    loading: false,
    placeholder: '輸入您的問題...',
  })

  const emit = defineEmits<{
    submit: [message: string]
    stop: []
  }>()

  const inputValue = ref('')
  const validationError = ref<string | null>(null)

  const MAX_LENGTH = 4000
  const TEXTAREA_ID = 'chat-message-input'

  function validateMessageInput(input: string): {
    valid: boolean
    error?: string
  } {
    const trimmed = input.trim()

    if (trimmed.length === 0) {
      return { valid: false, error: '請輸入訊息' }
    }

    if (trimmed.length > MAX_LENGTH) {
      return { valid: false, error: `訊息長度超過限制（最多 ${MAX_LENGTH} 字）` }
    }

    return { valid: true }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
      return
    }
    if (event.key === 'Escape' && inputValue.value.length > 0) {
      event.preventDefault()
      inputValue.value = ''
      validationError.value = null
    }
    // Shift+Enter allows default behavior (newline)
  }

  function handleSubmit() {
    if (props.disabled || props.loading) return

    const validation = validateMessageInput(inputValue.value)

    if (!validation.valid) {
      validationError.value = validation.error ?? '輸入無效'
      return
    }

    validationError.value = null
    const message = inputValue.value.trim()
    inputValue.value = ''
    emit('submit', message)
  }

  function isTypingElement(el: Element | null): boolean {
    if (!el) return false
    const tag = el.tagName
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      el.getAttribute('contenteditable') === 'true'
    )
  }

  function handleGlobalSlashKey(event: KeyboardEvent) {
    if (event.isComposing) return
    if (props.disabled || props.loading) return
    if (isTypingElement(document.activeElement)) return
    const target = document.getElementById(TEXTAREA_ID)
    if (!(target instanceof HTMLTextAreaElement)) return
    event.preventDefault()
    target.focus()
  }

  onKeyStroke('/', handleGlobalSlashKey)

  function focusAndClear() {
    inputValue.value = ''
    validationError.value = null
    const target = document.getElementById(TEXTAREA_ID)
    if (target instanceof HTMLTextAreaElement) {
      nextTick(() => {
        target.focus()
      })
    }
  }

  defineExpose({ focusAndClear })

  const canSubmit = computed(() => {
    return !props.disabled && !props.loading && inputValue.value.trim().length > 0
  })

  const characterCount = computed(() => inputValue.value.trim().length)
  const isNearLimit = computed(() => characterCount.value > MAX_LENGTH * 0.9)
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex gap-2">
      <UTextarea
        :id="TEXTAREA_ID"
        v-model="inputValue"
        :placeholder="placeholder"
        :disabled="disabled || loading"
        :rows="1"
        autoresize
        class="flex-1"
        @keydown="handleKeyDown"
      />
      <UButton
        v-if="loading"
        color="neutral"
        variant="outline"
        size="md"
        icon="i-lucide-square"
        @click="emit('stop')"
      >
        中斷
      </UButton>
      <UButton
        v-else
        color="neutral"
        variant="solid"
        size="md"
        icon="i-lucide-send"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        送出
      </UButton>
    </div>

    <div class="flex items-center justify-between">
      <div class="text-xs text-muted">
        <span v-if="validationError" class="text-error-700 dark:text-error-200">{{
          validationError
        }}</span>
        <span v-else>按 / 聚焦｜Enter 送出｜Shift+Enter 換行｜Esc 清空</span>
      </div>
      <div
        class="text-xs"
        :class="isNearLimit ? 'text-warning-700 dark:text-warning-200' : 'text-muted'"
      >
        {{ characterCount }} / {{ MAX_LENGTH }}
      </div>
    </div>
  </div>
</template>
