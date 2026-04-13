<script setup lang="ts">
  import AdminDashboardSummaryCard from '~/components/admin/dashboard/SummaryCard.vue'

  interface Props {
    tokensTotal: number
    neuronsUsed: number
    cacheHitRate: number
    requestsTotal: number
  }

  const props = defineProps<Props>()

  const cacheHitLabel = computed(() => {
    if (props.requestsTotal === 0) return '—'
    return `${Math.round(props.cacheHitRate * 100)}%`
  })

  const formattedTokens = computed(() => props.tokensTotal.toLocaleString('en-US'))
  const formattedNeurons = computed(() => props.neuronsUsed.toLocaleString('en-US'))
  const formattedRequests = computed(() => props.requestsTotal.toLocaleString('en-US'))
</script>

<template>
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
    <AdminDashboardSummaryCard
      label="累計 Tokens"
      :value="formattedTokens"
      description="Input + Output"
      icon="i-lucide-tally-5"
    />
    <AdminDashboardSummaryCard
      label="Neurons 已用"
      :value="formattedNeurons"
      description="Workers AI 計費單位"
      icon="i-lucide-cpu"
    />
    <AdminDashboardSummaryCard
      label="Cache 命中率"
      :value="cacheHitLabel"
      description="cached / total"
      icon="i-lucide-database"
    />
    <AdminDashboardSummaryCard
      label="累計請求"
      :value="formattedRequests"
      description="Chat + MCP"
      icon="i-lucide-activity"
    />
  </div>
</template>
