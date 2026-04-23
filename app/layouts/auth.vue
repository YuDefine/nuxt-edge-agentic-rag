<template>
  <div class="relative flex min-h-screen items-center justify-center bg-muted">
    <header class="absolute top-4 right-4">
      <UColorModeButton />
    </header>
    <main id="main-content" tabindex="-1" class="w-full max-w-md p-6">
      <slot />
    </main>
  </div>
</template>
