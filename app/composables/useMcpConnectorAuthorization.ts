import { buildMcpConnectorRedirectUrl } from '#shared/utils/mcp-connector-redirect'
import { getErrorMessage } from '#shared/utils/error-message'

interface McpAuthorizationResponse {
  data: {
    clientId: string
    clientName: string
    grantedScopes: string[]
    redirectUri: string
    state: string | null
    userId: string
  }
}

interface AuthorizationRequestParams {
  codeChallenge: string | null
  codeChallengeMethod: string | null
  clientId: string
  redirectUri: string
  resource: string | null
  scope: string
  state: string | null
}

function readQueryValue(value: string | null | Array<string | null> | undefined): string | null {
  if (Array.isArray(value)) {
    const first = value[0]

    return typeof first === 'string' && first.trim().length > 0 ? first.trim() : null
  }

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function useMcpConnectorAuthorization() {
  const route = useRoute()
  const { loggedIn } = useUserSession()

  const authorization = ref<McpAuthorizationResponse['data'] | null>(null)
  const loadError = ref<unknown>(null)
  const actionError = ref<unknown>(null)
  const isLoading = ref(false)
  const isApproving = ref(false)
  const isDenying = ref(false)

  const request = computed<AuthorizationRequestParams | null>(() => {
    const clientId = readQueryValue(route.query.client_id)
    const codeChallenge = readQueryValue(route.query.code_challenge)
    const codeChallengeMethod = readQueryValue(route.query.code_challenge_method)
    const redirectUri = readQueryValue(route.query.redirect_uri)
    const resource = readQueryValue(route.query.resource)
    const scope = readQueryValue(route.query.scope)
    const state = readQueryValue(route.query.state)

    if (!clientId || !redirectUri || !scope) {
      return null
    }

    return {
      codeChallenge,
      codeChallengeMethod,
      clientId,
      redirectUri,
      resource,
      scope,
      state,
    }
  })

  const queryErrorMessage = computed(() =>
    request.value === null ? '此 MCP 授權連結缺少必要參數，請從連接器重新發起授權。' : '',
  )

  async function loadAuthorization() {
    if (!loggedIn.value || request.value === null) {
      authorization.value = null
      loadError.value = null
      isLoading.value = false
      return
    }

    isLoading.value = true
    loadError.value = null

    try {
      const response = await $fetch<McpAuthorizationResponse>('/api/auth/mcp/authorize', {
        query: {
          client_id: request.value.clientId,
          redirect_uri: request.value.redirectUri,
          scope: request.value.scope,
          ...(request.value.resource ? { resource: request.value.resource } : {}),
          ...(request.value.state ? { state: request.value.state } : {}),
        },
      })
      authorization.value = response.data
    } catch (error) {
      authorization.value = null
      loadError.value = error
    } finally {
      isLoading.value = false
    }
  }

  async function approveAuthorization() {
    if (request.value === null || authorization.value === null) {
      return
    }
    if (isApproving.value || isDenying.value) {
      return
    }

    isApproving.value = true
    actionError.value = null

    try {
      const response = await $fetch<{
        data: {
          clientId: string
          code: string
          redirectUri: string
          state: string | null
        }
      }>('/api/auth/mcp/authorize', {
        method: 'POST',
        body: {
          approved: true,
          ...(request.value.codeChallenge ? { codeChallenge: request.value.codeChallenge } : {}),
          ...(request.value.codeChallengeMethod
            ? { codeChallengeMethod: request.value.codeChallengeMethod }
            : {}),
          clientId: authorization.value.clientId,
          redirectUri: authorization.value.redirectUri,
          ...(request.value.resource ? { resource: request.value.resource } : {}),
          scope: authorization.value.grantedScopes.join(' '),
          state: authorization.value.state,
        },
      })

      await navigateTo(
        buildMcpConnectorRedirectUrl({
          code: response.data.code,
          redirectUri: response.data.redirectUri,
          state: response.data.state,
        }),
        { external: true, replace: true },
      )
    } catch (error) {
      actionError.value = error
    } finally {
      isApproving.value = false
    }
  }

  async function denyAuthorization() {
    if (authorization.value === null) {
      return
    }
    if (isApproving.value || isDenying.value) {
      return
    }

    isDenying.value = true
    actionError.value = null

    try {
      await navigateTo(
        buildMcpConnectorRedirectUrl({
          error: 'access_denied',
          redirectUri: authorization.value.redirectUri,
          state: authorization.value.state,
        }),
        { external: true, replace: true },
      )
    } catch (error) {
      actionError.value = error
      isDenying.value = false
    }
  }

  watch(
    () => [loggedIn.value, route.fullPath] as const,
    async ([isLoggedIn]) => {
      if (!isLoggedIn) {
        authorization.value = null
        loadError.value = null
        isLoading.value = false
        return
      }

      await loadAuthorization()
    },
    { immediate: true },
  )

  const loadErrorMessage = computed(() =>
    loadError.value ? getErrorMessage(loadError.value, '暫時無法載入授權資訊，請稍後再試') : '',
  )
  const actionErrorMessage = computed(() =>
    actionError.value ? getErrorMessage(actionError.value, '暫時無法完成授權，請稍後再試') : '',
  )
  const localAccountRequired = computed(
    () => loadErrorMessage.value === 'MCP authorization requires a local account',
  )

  return {
    actionErrorMessage,
    approveAuthorization,
    authorization,
    denyAuthorization,
    isApproving,
    isDenying,
    isLoading,
    loadAuthorization,
    loadErrorMessage,
    localAccountRequired,
    queryErrorMessage,
  }
}
