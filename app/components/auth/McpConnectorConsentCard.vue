<script setup lang="ts">
  const props = defineProps<{
    accountLabel: string
    actionErrorMessage: string
    approving: boolean
    authorization: {
      clientId: string
      clientName: string
      grantedScopes: string[]
      redirectUri: string
    }
    denying: boolean
  }>()

  const emit = defineEmits<{
    approve: []
    deny: []
  }>()

  const scopeLabels: Record<string, string> = {
    'knowledge.ask': '提出知識問答',
    'knowledge.category.list': '讀取分類清單',
    'knowledge.citation.read': '讀取引用片段',
    'knowledge.restricted.read': '讀取 restricted 引用內容',
    'knowledge.search': '搜尋知識內容',
  }

  const redirectHost = computed(() => {
    try {
      return new URL(props.authorization.redirectUri).host
    } catch {
      return props.authorization.redirectUri
    }
  })
</script>

<template>
  <UCard class="w-full">
    <template #header>
      <div class="text-center">
        <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <UIcon name="i-lucide-shield-check" class="size-6 text-default" />
        </div>
        <h1 class="text-2xl font-bold text-default">授權 {{ props.authorization.clientName }}</h1>
        <p class="mt-2 text-sm text-muted">這次授權將代表你目前登入的本地帳號存取 MCP tools。</p>
      </div>
    </template>

    <div class="flex flex-col gap-4">
      <div class="rounded-md border border-default bg-elevated p-4">
        <p class="text-xs font-medium text-muted">目前授權帳號</p>
        <p class="mt-1 text-sm font-medium text-default">{{ props.accountLabel }}</p>
      </div>

      <div class="rounded-md border border-default bg-elevated p-4">
        <p class="text-xs font-medium text-muted">連接器</p>
        <p class="mt-1 text-sm font-medium text-default">{{ props.authorization.clientName }}</p>
        <p class="mt-2 text-xs text-muted">Redirect URI：{{ redirectHost }}</p>
      </div>

      <div class="rounded-md border border-default bg-elevated p-4">
        <p class="text-xs font-medium text-muted">請求權限</p>
        <ul class="mt-3 flex flex-col gap-2">
          <li
            v-for="scope in props.authorization.grantedScopes"
            :key="scope"
            class="rounded-md border border-default bg-default/30 px-3 py-2"
          >
            <p class="text-sm font-medium text-default">{{ scopeLabels[scope] ?? scope }}</p>
            <p class="mt-1 text-xs text-muted">{{ scope }}</p>
          </li>
        </ul>
      </div>

      <LazyUAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-badge-alert"
        title="授權後，連接器將以你的角色與 guest policy 存取知識工具。"
        description="若你是訪客，browse-only 或 no-access 限制仍會照常套用。"
      />

      <LazyUAlert
        v-if="props.actionErrorMessage"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-circle"
        :title="props.actionErrorMessage"
      />
    </div>

    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 md:flex-row md:justify-end">
        <UButton
          color="neutral"
          variant="outline"
          size="md"
          block
          class="md:w-auto"
          :disabled="props.approving"
          :loading="props.denying"
          @click="emit('deny')"
        >
          拒絕
        </UButton>
        <UButton
          color="neutral"
          variant="solid"
          size="md"
          block
          class="md:w-auto"
          icon="i-lucide-check"
          :loading="props.approving"
          :disabled="props.denying"
          @click="emit('approve')"
        >
          允許並繼續
        </UButton>
      </div>
    </template>
  </UCard>
</template>
