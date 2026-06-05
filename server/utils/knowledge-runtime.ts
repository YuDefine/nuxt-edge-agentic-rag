import type { H3Event } from 'h3'

import {
  deriveAllowedAccessLevels,
  isAdminEmailAllowlisted,
  resolveKnowledgeRuntimeConfig,
} from '#shared/schemas/knowledge-runtime'

export function getKnowledgeRuntimeConfig(event?: H3Event) {
  const runtimeConfig = useRuntimeConfig(event)

  return resolveKnowledgeRuntimeConfig(runtimeConfig.knowledge)
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
