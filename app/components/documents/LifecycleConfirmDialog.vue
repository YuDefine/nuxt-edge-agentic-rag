<script setup lang="ts">
  import { assertNever } from '~~/shared/utils/assert-never'

  type LifecycleAction = 'delete' | 'archive' | 'unarchive'
  type DialogTone = 'error' | 'warning' | 'info'
  type ConfirmColor = 'error' | 'neutral'

  interface Props {
    open: boolean
    action: LifecycleAction
    documentTitle: string
    /** Delete only: number of versions that will be removed. Pass null when unknown. */
    versionCount?: number | null
    /** Delete only: number of source_chunks that will be removed. Pass null when unknown. */
    sourceChunkCount?: number | null
    /** When true, disables confirm (e.g. while the mutation is pending) */
    loading?: boolean
  }

  const props = withDefaults(defineProps<Props>(), {
    versionCount: null,
    sourceChunkCount: null,
    loading: false,
  })

  const emit = defineEmits<{
    'update:open': [value: boolean]
    confirm: []
    cancel: []
  }>()

  const { user } = useUserSession()

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  })

  const adminEmail = computed(() => user.value?.email ?? '未知帳號')

  interface DialogCopy {
    title: string
    icon: string
    tone: DialogTone
    confirmLabel: string
    confirmColor: ConfirmColor
    impactLines: string[]
  }

  const copy = computed<DialogCopy>(() => {
    switch (props.action) {
      case 'delete': {
        const hasCounts = props.versionCount !== null && props.sourceChunkCount !== null
        const impactDetail = hasCounts
          ? `將一併移除 ${props.versionCount} 個版本與 ${props.sourceChunkCount} 個原文片段`
          : '將一併移除此文件的所有版本與對應原文片段'
        return {
          title: '刪除文件',
          icon: 'i-lucide-trash-2',
          tone: 'error',
          confirmLabel: '刪除',
          confirmColor: 'error',
          impactLines: [
            `此操作將永久刪除「${props.documentTitle}」`,
            impactDetail,
            '此動作無法復原',
          ],
        }
      }
      case 'archive':
        return {
          title: '封存文件',
          icon: 'i-lucide-archive',
          tone: 'warning',
          confirmLabel: '封存',
          confirmColor: 'neutral',
          impactLines: [
            `封存「${props.documentTitle}」後，此文件將不再出現於對外檢索`,
            '引用資料仍保留至保留期限期滿',
            '後續可隨時解除封存',
          ],
        }
      case 'unarchive':
        return {
          title: '解除封存',
          icon: 'i-lucide-archive-restore',
          tone: 'info',
          confirmLabel: '解除封存',
          confirmColor: 'neutral',
          impactLines: [
            `解除封存「${props.documentTitle}」後，此文件將回到對外檢索流程`,
            '若索引已因保留期限被清除，請重新上傳版本',
          ],
        }
      default:
        return assertNever(props.action, 'LifecycleConfirmDialog copy')
    }
  })

  const toneIconClass = computed(() => {
    switch (copy.value.tone) {
      case 'error':
        return 'text-error'
      case 'warning':
        return 'text-warning'
      case 'info':
        return 'text-muted'
      default:
        return assertNever(copy.value.tone, 'LifecycleConfirmDialog toneIconClass')
    }
  })

  const describedById = useId()

  function handleConfirm() {
    emit('confirm')
  }

  function handleCancel() {
    isOpen.value = false
    emit('cancel')
  }
</script>

<template>
  <UModal v-model:open="isOpen">
    <template #content>
      <UCard :aria-describedby="describedById">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon :name="copy.icon" class="size-5" :class="toneIconClass" aria-hidden="true" />
            <h3 class="text-lg font-semibold text-default">{{ copy.title }}</h3>
          </div>
        </template>

        <div :id="describedById" class="flex flex-col gap-4">
          <ul class="list-disc space-y-1 pl-5 text-sm text-default marker:text-muted">
            <li v-for="(line, index) in copy.impactLines" :key="index">
              {{ line }}
            </li>
          </ul>

          <div class="rounded-lg border border-default bg-muted p-3">
            <p class="text-xs text-muted">執行操作的管理員帳號</p>
            <p class="mt-1 text-sm font-medium text-default">{{ adminEmail }}</p>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              size="md"
              :disabled="loading"
              @click="handleCancel"
            >
              取消
            </UButton>
            <UButton
              :color="copy.confirmColor"
              variant="solid"
              size="md"
              :loading="loading"
              :disabled="loading"
              @click="handleConfirm"
            >
              {{ copy.confirmLabel }}
            </UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
