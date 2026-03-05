<script setup lang="ts">
  import { MCP_TOKEN_SCOPE_VALUES } from '~~/shared/schemas/knowledge-runtime'
  import { assertNever } from '~~/shared/utils/assert-never'

  /**
   * Displays the list of scopes granted to an MCP token as compact badges.
   * Known scopes get a human label; unknown scopes fall back to the raw value
   * (server is source of truth; UI degrades gracefully if a new scope is added
   * before the UI ships).
   */
  type KnownScope = (typeof MCP_TOKEN_SCOPE_VALUES)[number]

  interface Props {
    scopes: string[]
  }

  defineProps<Props>()

  function isKnownScope(scope: string): scope is KnownScope {
    return (MCP_TOKEN_SCOPE_VALUES as readonly string[]).includes(scope)
  }

  function getScopeLabel(scope: KnownScope): string {
    switch (scope) {
      case 'knowledge.search':
        return '搜尋'
      case 'knowledge.ask':
        return '問答'
      case 'knowledge.citation.read':
        return '引用讀取'
      case 'knowledge.category.list':
        return '分類列表'
      case 'knowledge.restricted.read':
        return '機敏讀取'
      default:
        return assertNever(scope, 'TokenScopeList.getScopeLabel')
    }
  }

  function displayScope(scope: string): string {
    return isKnownScope(scope) ? getScopeLabel(scope) : scope
  }
</script>

<template>
  <div v-if="scopes.length > 0" class="flex flex-wrap gap-1">
    <UBadge
      v-for="scope in scopes"
      :key="scope"
      color="neutral"
      variant="soft"
      size="sm"
      :title="scope"
    >
      {{ displayScope(scope) }}
    </UBadge>
  </div>
  <span v-else class="text-sm text-muted">無權限</span>
</template>
