<script setup lang="ts">
  import {
    isBlockedPositiveIntegerInputKey,
    normalizePositiveIntegerInputValue,
  } from '~/utils/positive-integer-input'

  interface Props {
    disabled?: boolean
    placeholder?: string
  }

  const props = defineProps<Props>()
  const model = defineModel<string>({ default: '' })

  function handleUpdate(value: number | string): void {
    model.value = normalizePositiveIntegerInputValue(value)
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (isBlockedPositiveIntegerInputKey(event.key)) {
      event.preventDefault()
    }
  }
</script>

<template>
  <UInput
    :model-value="model"
    type="number"
    color="neutral"
    variant="outline"
    size="md"
    :min="1"
    :step="1"
    inputmode="numeric"
    pattern="[0-9]*"
    :disabled="props.disabled"
    :placeholder="props.placeholder"
    @update:model-value="handleUpdate"
    @keydown="handleKeydown"
  />
</template>
