import {
  createKnowledgeRuntimeConfig,
  deriveAllowedAccessLevels,
  isAdminEmailAllowlisted,
} from '../../shared/schemas/knowledge-runtime'

export function getKnowledgeRuntimeConfig() {
  const runtimeConfig = useRuntimeConfig()

  return createKnowledgeRuntimeConfig(runtimeConfig.knowledge)
}

export function getKnowledgeGovernanceConfig() {
  return getKnowledgeRuntimeConfig().governance
}

export function getKnowledgeUploadConfig() {
  return getKnowledgeRuntimeConfig().uploads
}

export function getRuntimeAdminAccess(email: string | null | undefined): boolean {
  const knowledgeRuntimeConfig = getKnowledgeRuntimeConfig()

  return isAdminEmailAllowlisted(email, knowledgeRuntimeConfig.adminEmailAllowlist)
}

export function getAllowedAccessLevels(input: {
  channel: string
  isAdmin?: boolean
  isAuthenticated: boolean
  tokenScopes?: string[]
}): string[] {
  return deriveAllowedAccessLevels(input)
}
