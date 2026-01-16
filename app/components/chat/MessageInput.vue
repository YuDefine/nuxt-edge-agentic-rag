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
  }>()

  const inputValue = ref('')
  const validationError = ref<string | null>(null)

  const MAX_LENGTH = 4000

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
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
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
        v-model="inputValue"
        :placeholder="placeholder"
        :disabled="disabled || loading"
        :rows="3"
        autoresize
        class="flex-1"
        @keydown="handleKeyDown"
      />
      <UButton
        color="primary"
        variant="solid"
        size="md"
        icon="i-lucide-send"
        :disabled="!canSubmit"
        :loading="loading"
        @click="handleSubmit"
      >
        送出
      </UButton>
    </div>

    <div class="flex items-center justify-between">
      <div class="text-xs text-muted">
        <span v-if="validationError" class="text-error">{{ validationError }}</span>
        <span v-else>Enter 送出，Shift+Enter 換行</span>
      </div>
      <div class="text-xs" :class="isNearLimit ? 'text-warning' : 'text-muted'">
        {{ characterCount }} / {{ MAX_LENGTH }}
      </div>
    </div>
  </div>
</template>
