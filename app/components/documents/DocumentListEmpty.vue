<script setup lang="ts">
  interface Props {
    showUploadAction?: boolean
  }

  defineProps<Props>()

  const emit = defineEmits<{
    upload: []
  }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 text-center">
    <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
      <UIcon name="i-lucide-file-plus" class="size-8 text-default" />
    </div>
    <h3 class="mb-2 text-lg font-semibold text-default">開始建立知識庫</h3>
    <p class="mb-6 max-w-sm text-sm text-muted">
      上傳文件後，系統會自動分析並建立索引，讓使用者可以透過問答查詢相關內容。
    </p>
    <UButton
      v-if="showUploadAction"
      color="neutral"
      variant="solid"
      size="md"
      icon="i-lucide-upload"
      @click="emit('upload')"
    >
      上傳第一份文件
    </UButton>
  </div>
</template>
