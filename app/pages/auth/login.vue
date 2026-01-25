<script setup lang="ts">
  // Legacy route - redirect to home
  definePageMeta({ auth: false })
  await navigateTo('/', { replace: true })
</script>

<template>
  <div />
</template>
