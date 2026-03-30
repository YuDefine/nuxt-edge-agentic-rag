<script setup lang="ts">
  /**
   * Dedicated refusal message component with distinct styling.
   * Used when the assistant refuses to answer a question.
   * Must be visually distinct from successful answers - no citations shown.
   */
  interface Props {
    content: string
    createdAt: string
  }

  defineProps<Props>()

  const emit = defineEmits<{
    retryFocus: []
  }>()

  const runtimeConfig = useRuntimeConfig().public
  const adminContactEmail = computed<string>(() => {
    const raw = (runtimeConfig as Record<string, unknown>).adminContactEmail
    return typeof raw === 'string' && raw.length > 0 ? raw : 'admin@example.com'
  })

  const documentListUrl = '/admin/documents'
  const { isAdmin } = useUserRole()
  const canBrowseDocuments = isAdmin

  function handleRetryFocus() {
    emit('retryFocus')
  }
</script>

<template>
  <div class="rounded-lg border border-default bg-muted px-4 py-3">
    <div class="mb-2 flex items-center gap-2">
      <UIcon name="i-lucide-circle-slash" class="size-4 text-muted" />
      <span class="text-xs font-medium text-muted">助理</span>
      <UBadge color="neutral" variant="subtle" size="xs">無法回答</UBadge>
    </div>

    <div class="text-sm whitespace-pre-wrap text-default">
      {{ content }}
    </div>

    <div class="mt-3 rounded-md bg-accented p-3">
      <p class="mb-2 flex items-center gap-1 text-xs font-medium text-default">
        <UIcon name="i-lucide-lightbulb" class="size-3.5" />
        可能的原因
      </p>
      <ul class="ml-4 list-outside list-disc space-y-1 text-xs text-muted">
        <li>您詢問的內容可能不在目前知識庫範圍內</li>
        <li>您的帳號權限可能無法存取相關文件</li>
        <li>問題敘述可能過於模糊或過於具體</li>
      </ul>
    </div>

    <div class="mt-3">
      <p class="mb-2 flex items-center gap-1 text-xs font-medium text-default">
        <UIcon name="i-lucide-compass" class="size-3.5" />
        建議的下一步
      </p>
      <div class="flex flex-wrap gap-2">
        <UButton
          color="neutral"
          variant="soft"
          size="xs"
          icon="i-lucide-pencil-line"
          @click="handleRetryFocus"
        >
          改換關鍵字重新提問
        </UButton>
        <UButton
          v-if="canBrowseDocuments"
          color="neutral"
          variant="soft"
          size="xs"
          icon="i-lucide-folder-open"
          :to="documentListUrl"
        >
          查看相關文件清單
        </UButton>
        <UButton
          color="neutral"
          variant="soft"
          size="xs"
          icon="i-lucide-mail"
          :to="`mailto:${adminContactEmail}?subject=${encodeURIComponent('知識庫查詢協助請求')}`"
          external
        >
          聯絡管理員
        </UButton>
      </div>
    </div>

    <div class="mt-3 text-xs text-muted">
      {{ new Date(createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) }}
    </div>
  </div>
</template>
