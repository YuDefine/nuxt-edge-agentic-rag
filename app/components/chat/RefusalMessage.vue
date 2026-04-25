<script setup lang="ts">
  import { assertRefusalReasonNever, type RefusalReason } from '#shared/types/observability'
  import { formatTimeShort } from '~/utils/format-datetime'

  /**
   * Dedicated refusal message component with distinct styling.
   * Used when the assistant refuses to answer a question.
   * Must be visually distinct from successful answers - no citations shown.
   *
   * persist-refusal-and-label-new-chat: when `reason` is supplied, the
   * "可能的原因" and "建議的下一步" sections render reason-specific copy
   * (one bucket per known RefusalReason). Unknown / missing `reason`
   * falls back to the generic copy that existed before this change.
   */
  interface Props {
    content: string
    createdAt: string
    /**
     * Specific RefusalReason for this turn. Sourced from the live SSE
     * `refusal` event or from `messages.refusal_reason` on conversation
     * reload. `null` / `undefined` triggers the generic fallback copy.
     */
    reason?: RefusalReason | null
  }

  const props = defineProps<Props>()

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

  interface NextStep {
    kind: 'retry' | 'browse-documents' | 'contact-admin'
  }

  interface ReasonCopy {
    headline: string
    causes: string[]
    nextSteps: NextStep[]
  }

  const GENERIC_COPY: ReasonCopy = {
    headline: '可能的原因',
    causes: [
      '您詢問的內容可能不在目前知識庫範圍內',
      '您的帳號權限可能無法存取相關文件',
      '問題敘述可能過於模糊或過於具體',
    ],
    nextSteps: [{ kind: 'retry' }, { kind: 'browse-documents' }, { kind: 'contact-admin' }],
  }

  // persist-refusal-and-label-new-chat: reason → copy via switch +
  // assertRefusalReasonNever (matches `app/utils/debug-labels.ts` and the
  // Exhaustiveness Rule in `.claude/rules/development.md`). Adding a new
  // RefusalReason in `shared/types/observability.ts` will fail compilation
  // here until a matching case is added — no silent fallback to GENERIC_COPY.
  function getReasonCopy(reason: RefusalReason | null | undefined): ReasonCopy {
    if (!reason) {
      return GENERIC_COPY
    }
    switch (reason) {
      case 'restricted_scope':
        return {
          headline: '為什麼無法回答',
          causes: [
            '您的提問內含敏感資訊（例如 API key、密碼、信用卡號等）',
            '系統不會處理也不會留下原始內容',
            '所有相關紀錄已自動遮罩',
          ],
          nextSteps: [{ kind: 'retry' }, { kind: 'contact-admin' }],
        }
      case 'no_citation':
        return {
          headline: '為什麼無法回答',
          causes: ['知識庫中沒有與您的提問相符的文件', '可能的關鍵字尚未建檔，或主題不在範圍內'],
          nextSteps: [{ kind: 'retry' }, { kind: 'browse-documents' }],
        }
      case 'sensitive_governance':
        return {
          headline: '為什麼無法回答',
          causes: ['您的提問涉及敏感治理範疇，目前不開放於知識庫回應', '相關內容受存取規範限制'],
          nextSteps: [{ kind: 'retry' }, { kind: 'contact-admin' }],
        }
      case 'low_confidence':
        return {
          headline: '為什麼無法回答',
          causes: [
            '系統找到相關文件，但內容不足以支撐確切答案',
            '為避免誤導，這次選擇拒答而非提供推測',
          ],
          nextSteps: [{ kind: 'retry' }, { kind: 'browse-documents' }],
        }
      case 'pipeline_error':
        return {
          headline: '為什麼無法回答',
          causes: ['系統暫時無法處理這次請求', '多半為一次性的網路或計算資源異常'],
          nextSteps: [{ kind: 'retry' }, { kind: 'contact-admin' }],
        }
      default:
        return assertRefusalReasonNever(reason, 'getReasonCopy')
    }
  }

  const reasonCopy = computed(() => getReasonCopy(props.reason))

  // Filter next-step buttons based on viewer permission. Browse-documents
  // is admin-only; the rest always render. canBrowseDocuments is a Ref,
  // so we read `.value` inside the computed for the predicate to be
  // truthy/falsy on the actual boolean rather than on the ref object.
  const visibleNextSteps = computed(() =>
    reasonCopy.value.nextSteps.filter(
      (step) => step.kind !== 'browse-documents' || canBrowseDocuments.value,
    ),
  )

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
        {{ reasonCopy.headline }}
      </p>
      <ul class="ml-4 list-outside list-disc space-y-1 text-xs text-muted">
        <li v-for="cause in reasonCopy.causes" :key="cause">{{ cause }}</li>
      </ul>
    </div>

    <div class="mt-3">
      <p class="mb-2 flex items-center gap-1 text-xs font-medium text-default">
        <UIcon name="i-lucide-compass" class="size-3.5" />
        建議的下一步
      </p>
      <div class="flex flex-wrap gap-2">
        <template v-for="step in visibleNextSteps" :key="step.kind">
          <UButton
            v-if="step.kind === 'retry'"
            color="neutral"
            variant="soft"
            size="xs"
            icon="i-lucide-pencil-line"
            @click="handleRetryFocus"
          >
            改換關鍵字重新提問
          </UButton>
          <UButton
            v-else-if="step.kind === 'browse-documents'"
            color="neutral"
            variant="soft"
            size="xs"
            icon="i-lucide-folder-open"
            :to="documentListUrl"
          >
            查看相關文件清單
          </UButton>
          <UButton
            v-else-if="step.kind === 'contact-admin'"
            color="neutral"
            variant="soft"
            size="xs"
            icon="i-lucide-mail"
            :to="`mailto:${adminContactEmail}?subject=${encodeURIComponent('知識庫查詢協助請求')}`"
            external
          >
            聯絡管理員
          </UButton>
        </template>
      </div>
    </div>

    <div class="mt-3 text-xs text-muted">
      {{ formatTimeShort(createdAt) }}
    </div>
  </div>
</template>
