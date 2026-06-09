<script setup lang="ts">
  import { zh_tw } from '@nuxt/ui/locale'

  useSeoMeta({
    description: '知識問答系統 — AI 驅動的文件檢索與問答平台',
  })
</script>

<template>
  <UApp :locale="zh_tw">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
