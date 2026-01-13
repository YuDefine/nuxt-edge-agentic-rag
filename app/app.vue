<script setup lang="ts">
  import { zh_tw } from '@nuxt/ui/locale'

  useSeoMeta({
    title: 'nuxt-edge-agentic-rag',
    description: 'nuxt-edge-agentic-rag',
  })
</script>

<template>
  <UApp :locale="zh_tw">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
