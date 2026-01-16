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
  <div class="flex flex-col items-center justify-center py-12 text-center">
    <div class="mb-4 rounded-full bg-neutral-100 p-4 dark:bg-neutral-800">
      <UIcon name="i-lucide-file-text" class="size-8 text-muted" />
    </div>
    <h3 class="mb-2 text-lg font-medium text-default">尚無文件</h3>
    <p class="mb-6 max-w-sm text-sm text-muted">目前沒有任何文件。上傳文件後即可在此管理。</p>
    <UButton
      v-if="showUploadAction"
      color="primary"
      variant="solid"
      size="md"
      icon="i-lucide-upload"
      @click="emit('upload')"
    >
      上傳文件
    </UButton>
  </div>
</template>
