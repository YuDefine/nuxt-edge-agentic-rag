<script setup lang="ts">
  import * as z from 'zod'
  import { MCP_TOKEN_SCOPE_VALUES } from '~~/shared/schemas/knowledge-runtime'

  /**
   * Modal for creating a new MCP token.
   *
   * One-time reveal contract (see proposal §1.5): after a successful create
   * call the server returns the plaintext `token`. The modal shows it ONCE
   * with a copy action. Closing the modal discards it forever — there is no
   * way to recover the plaintext afterwards. The UI explicitly warns users.
   */

  interface TokenCreateResponse {
    createdAt: string
    expiresAt: string | null
    id: string
    name: string
    scopes: string[]
    token: string // plaintext — only present at create time
  }

  interface Props {
    open: boolean
  }

  const props = defineProps<Props>()
  const emit = defineEmits<{
    'update:open': [value: boolean]
    created: []
  }>()

  const SCOPE_LABELS: Record<(typeof MCP_TOKEN_SCOPE_VALUES)[number], string> = {
    'knowledge.search': '搜尋',
    'knowledge.ask': '問答',
    'knowledge.citation.read': '引用讀取',
    'knowledge.category.list': '分類列表',
    'knowledge.restricted.read': '機敏讀取',
  }

  const VALID_SCOPES = MCP_TOKEN_SCOPE_VALUES.map((value) => ({
    value,
    label: `${SCOPE_LABELS[value]}（${value}）`,
  }))

  const schema = z.object({
    name: z.string().min(1, '請輸入 token 名稱'),
    scopes: z.array(z.string()).min(1, '至少選擇一個 scope'),
    expiresInDays: z
      .string()
      .optional()
      .refine((v) => !v || (/^\d+$/.test(v) && Number(v) > 0), '到期天數必須為正整數，或留空'),
  })

  interface FormState {
    name: string
    scopes: string[]
    expiresInDays: string
  }

  const state = reactive<FormState>({
    name: '',
    scopes: [],
    expiresInDays: '',
  })

  const submitting = ref(false)
  const submitError = ref<string | null>(null)
  const created = ref<TokenCreateResponse | null>(null)
  const copied = ref(false)

  function resetForm() {
    state.name = ''
    state.scopes = []
    state.expiresInDays = ''
    submitError.value = null
    created.value = null
    copied.value = false
  }

  watch(
    () => props.open,
    (value) => {
      if (!value) {
        // Small timeout to avoid flashing inputs while modal fades out
        resetForm()
      }
    },
  )

  const { $csrfFetch } = useNuxtApp()

  async function handleSubmit() {
    submitting.value = true
    submitError.value = null

    try {
      const payload: Record<string, unknown> = {
        name: state.name,
        scopes: state.scopes,
      }

      if (state.expiresInDays && /^\d+$/.test(state.expiresInDays)) {
        const parsed = Number(state.expiresInDays)
        if (parsed > 0) payload.expiresInDays = parsed
      }

      const result = await $csrfFetch<TokenCreateResponse>('/api/admin/mcp-tokens', {
        method: 'POST',
        body: payload,
      })

      created.value = result
      emit('created')
    } catch (error) {
      const fetchErr = error as { data?: { statusMessage?: string } }
      submitError.value = fetchErr?.data?.statusMessage ?? '建立 token 失敗'
    } finally {
      submitting.value = false
    }
  }

  async function handleCopy() {
    if (!created.value) return
    try {
      await navigator.clipboard.writeText(created.value.token)
      copied.value = true
      window.setTimeout(() => {
        copied.value = false
      }, 2500)
    } catch {
      // Clipboard API may be unavailable (insecure context); user can still
      // select + copy manually from the revealed text.
      copied.value = false
    }
  }

  function handleClose() {
    emit('update:open', false)
  }
</script>

<template>
  <UModal
    :open="props.open"
    title="建立 Legacy MCP Token"
    :dismissible="!submitting"
    @update:open="(value) => emit('update:open', value)"
  >
    <template #body>
      <!-- Reveal state: token was just created -->
      <div v-if="created" class="flex flex-col gap-4">
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="僅顯示此一次"
          description="關閉此視窗後，系統將不再保留明文 token。請立即複製並妥善保存。"
        />

        <div>
          <p class="mb-1 text-sm font-medium text-default">明文 Token</p>
          <div
            class="flex items-center gap-2 rounded-md border border-default bg-muted p-3 font-mono text-sm break-all text-default"
          >
            <code class="flex-1 break-all">{{ created.token }}</code>
            <UButton
              :color="copied ? 'success' : 'neutral'"
              variant="outline"
              size="xs"
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              :aria-label="copied ? '已複製' : '複製 token'"
              @click="handleCopy"
            >
              {{ copied ? '已複製' : '複製' }}
            </UButton>
          </div>
        </div>

        <dl class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt class="text-muted">名稱</dt>
            <dd class="font-medium text-default">{{ created.name }}</dd>
          </div>
          <div>
            <dt class="text-muted">Scopes</dt>
            <dd class="font-medium text-default">{{ created.scopes.join(', ') }}</dd>
          </div>
          <div>
            <dt class="text-muted">到期時間</dt>
            <dd class="font-medium text-default">{{ created.expiresAt ?? '不過期' }}</dd>
          </div>
        </dl>
      </div>

      <!-- Create form -->
      <UForm
        v-else
        :state="state"
        :schema="schema"
        class="flex flex-col gap-4"
        @submit="handleSubmit"
      >
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-badge-alert"
          title="這不是 remote connector 的正式登入方式"
          description="請只在 migration、內部驗證、Inspector 或非使用者型 automation 情境下建立這種 static bearer token。"
        />

        <UFormField label="名稱" name="name" required>
          <UInput
            v-model="state.name"
            color="neutral"
            variant="outline"
            size="md"
            placeholder="例如：CI token"
          />
        </UFormField>

        <UFormField label="Scopes" name="scopes" required hint="至少選擇一項">
          <div class="flex flex-col gap-2">
            <UCheckbox
              v-for="scope in VALID_SCOPES"
              :key="scope.value"
              :model-value="state.scopes.includes(scope.value)"
              :label="scope.label"
              color="primary"
              size="md"
              @update:model-value="
                (checked) => {
                  if (checked) {
                    if (!state.scopes.includes(scope.value)) state.scopes.push(scope.value)
                  } else {
                    state.scopes = state.scopes.filter((s) => s !== scope.value)
                  }
                }
              "
            />
          </div>
        </UFormField>

        <UFormField label="到期天數" name="expiresInDays" hint="留空代表永不過期">
          <UInput
            v-model="state.expiresInDays"
            type="number"
            color="neutral"
            variant="outline"
            size="md"
            placeholder="例如：30"
          />
        </UFormField>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-alert-circle"
          :description="submitError"
        />
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <template v-if="created">
          <UButton
            color="neutral"
            variant="solid"
            size="md"
            :disabled="submitting"
            @click="handleClose"
          >
            關閉
          </UButton>
        </template>
        <template v-else>
          <UButton color="neutral" variant="ghost" size="md" @click="handleClose">取消</UButton>
          <UButton
            color="primary"
            variant="solid"
            size="md"
            :loading="submitting"
            @click="handleSubmit"
          >
            建立 Token
          </UButton>
        </template>
      </div>
    </template>
  </UModal>
</template>
