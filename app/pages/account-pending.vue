<script setup lang="ts">
  /**
   * B16 §8.3 — Guest "account pending" surface.
   *
   * Rendered when `guest_policy === 'no_access'`. The route is accessible
   * to any signed-in user so that Guests redirected here from
   * `GuestAccessGate` land on a meaningful page rather than hitting a 403.
   * Admin / Member roles should ideally never reach this page; if they do
   * (e.g. direct URL entry), they can just navigate back to `/`.
   */
  definePageMeta({
    // Auth middleware kicks unauthenticated users to /; this page is
    // designed for already-signed-in guests.
    auth: true,
  })

  const { signOut, user } = useUserSession()

  // TODO: surface a configurable support email via runtime config; for
  // v1.0.0 we hard-code a placeholder so the UI is complete and the Admin
  // can post-install replace the string before production go-live.
  const SUPPORT_EMAIL = 'support@example.com'

  async function handleSignOut() {
    await signOut()
    await navigateTo('/')
  }
</script>

<template>
  <div class="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
    <UCard class="mx-auto w-full max-w-md">
      <template #header>
        <div class="flex flex-col items-center text-center">
          <div class="mb-4 flex size-14 items-center justify-center rounded-full bg-warning/10">
            <UIcon name="i-lucide-hourglass" class="size-7 text-warning" aria-hidden="true" />
          </div>
          <h1 class="text-xl font-bold text-default md:text-2xl">帳號待審核</h1>
          <p class="mt-2 text-sm text-muted">Account pending review</p>
        </div>
      </template>

      <div class="flex flex-col gap-4 text-sm text-default md:text-base">
        <p>您的帳號目前為訪客狀態，系統暫不開放訪客存取。請聯絡管理員開通成員身分後再嘗試使用。</p>
        <div class="rounded-md border border-default bg-elevated p-3">
          <p class="text-xs font-medium text-muted md:text-sm">您目前登入的帳號</p>
          <p class="mt-1 truncate text-sm font-medium text-default md:text-base">
            {{ user?.email ?? '（未取得 email）' }}
          </p>
        </div>
        <div class="flex flex-col gap-1">
          <p class="text-xs font-medium text-muted md:text-sm">聯絡管理員</p>
          <a
            :href="`mailto:${SUPPORT_EMAIL}?subject=申請成員身分`"
            class="text-sm font-medium break-all text-default underline underline-offset-2 hover:text-muted md:text-base"
          >
            {{ SUPPORT_EMAIL }}
          </a>
        </div>
      </div>

      <template #footer>
        <div class="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <UButton
            color="neutral"
            variant="outline"
            size="md"
            block
            class="md:w-auto"
            icon="i-lucide-log-out"
            @click="handleSignOut"
          >
            登出
          </UButton>
          <UButton
            color="neutral"
            variant="solid"
            size="md"
            block
            class="md:w-auto"
            :to="`mailto:${SUPPORT_EMAIL}?subject=申請成員身分`"
            external
            icon="i-lucide-mail"
          >
            聯絡管理員
          </UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
