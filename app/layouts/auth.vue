<template>
  <div class="relative flex min-h-screen items-center justify-center bg-muted">
    <div class="absolute top-4 right-4">
      <UColorModeButton />
    </div>
    <div class="w-full max-w-md p-6">
      <slot />
    </div>
  </div>
</template>
