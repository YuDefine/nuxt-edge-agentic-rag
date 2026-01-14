import { z } from 'zod'

export const KNOWLEDGE_ACCESS_LEVEL_VALUES = ['internal', 'restricted'] as const
export const KNOWLEDGE_CHANNEL_VALUES = ['web', 'mcp'] as const
export const KNOWLEDGE_ENVIRONMENT_VALUES = ['local', 'staging', 'production'] as const
export const KNOWLEDGE_FEATURE_FLAG_VALUES = [
  'passkey',
  'mcpSession',
  'cloudFallback',
  'adminDashboard',
] as const
export const MCP_TOKEN_SCOPE_VALUES = [
  'knowledge.search',
  'knowledge.ask',
  'knowledge.citation.read',
  'knowledge.category.list',
  'knowledge.restricted.read',
] as const

export interface KnowledgeBindingsConfig {
  aiSearchIndex: string
  d1Database: string
  documentsBucket: string
  rateLimitKv: string
}

export interface KnowledgeUploadsConfig {
  accountId: string
  accessKeyId: string
  bucketName: string
  presignExpiresSeconds: number
  secretAccessKey: string
}

export interface KnowledgeFeatureFlags {
  adminDashboard: boolean
  cloudFallback: boolean
  mcpSession: boolean
  passkey: boolean
}

export interface KnowledgeRuntimeConfig {
  adminEmailAllowlist: string[]
  bindings: KnowledgeBindingsConfig
  environment: string
  features: KnowledgeFeatureFlags
  uploads: KnowledgeUploadsConfig
}

export interface KnowledgeRuntimeConfigInput {
  adminEmailAllowlist?: string | string[]
  bindings?: Partial<KnowledgeBindingsConfig>
  environment?: string
  features?: Partial<
    Record<(typeof KNOWLEDGE_FEATURE_FLAG_VALUES)[number], boolean | string | undefined>
  >
  uploads?: Partial<KnowledgeUploadsConfig> & {
    presignExpiresSeconds?: number | string
  }
}

export interface AllowedAccessContext {
  channel: string
  isAdmin?: boolean
  isAuthenticated: boolean
  tokenScopes?: string[]
}

const knowledgeRuntimeConfigSchema = z.object({
  adminEmailAllowlist: z.array(z.email()),
  bindings: z.object({
    aiSearchIndex: z.string(),
    d1Database: z.string(),
    documentsBucket: z.string(),
    rateLimitKv: z.string(),
  }),
  environment: z.enum(KNOWLEDGE_ENVIRONMENT_VALUES),
  features: z.object({
    adminDashboard: z.boolean(),
    cloudFallback: z.boolean(),
    mcpSession: z.boolean(),
    passkey: z.boolean(),
  }),
  uploads: z.object({
    accountId: z.string(),
    accessKeyId: z.string(),
    bucketName: z.string(),
    presignExpiresSeconds: z.number().int().min(1).max(604800),
    secretAccessKey: z.string(),
  }),
})

function parseBooleanFlag(value: boolean | string | undefined): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true'
  }

  return false
}

function parsePositiveInteger(value: number | string | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }

  return fallback
}

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase()
}

export function parseAdminEmailAllowlist(input?: string | string[]): string[] {
  const values = Array.isArray(input)
    ? input
    : (input ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)

  return [...new Set(values.map((value) => normalizeEmailAddress(value)))]
}

export function createKnowledgeFeatureFlags(
  overrides?: KnowledgeRuntimeConfigInput['features']
): KnowledgeFeatureFlags {
  return {
    adminDashboard: parseBooleanFlag(overrides?.adminDashboard),
    cloudFallback: parseBooleanFlag(overrides?.cloudFallback),
    mcpSession: parseBooleanFlag(overrides?.mcpSession),
    passkey: parseBooleanFlag(overrides?.passkey),
  }
}

export function createKnowledgeRuntimeConfig(
  input: KnowledgeRuntimeConfigInput = {}
): KnowledgeRuntimeConfig {
  return knowledgeRuntimeConfigSchema.parse({
    adminEmailAllowlist: parseAdminEmailAllowlist(input.adminEmailAllowlist),
    bindings: {
      aiSearchIndex: input.bindings?.aiSearchIndex ?? '',
      d1Database: input.bindings?.d1Database ?? '',
      documentsBucket: input.bindings?.documentsBucket ?? '',
      rateLimitKv: input.bindings?.rateLimitKv ?? '',
    },
    environment: z
      .enum(KNOWLEDGE_ENVIRONMENT_VALUES)
      .catch('local')
      .parse(input.environment ?? 'local'),
    features: createKnowledgeFeatureFlags(input.features),
    uploads: {
      accountId: input.uploads?.accountId ?? '',
      accessKeyId: input.uploads?.accessKeyId ?? '',
      bucketName: input.uploads?.bucketName ?? '',
      presignExpiresSeconds: parsePositiveInteger(input.uploads?.presignExpiresSeconds, 900),
      secretAccessKey: input.uploads?.secretAccessKey ?? '',
    },
  })
}

export function deriveAllowedAccessLevels(input: AllowedAccessContext): string[] {
  if (!input.isAuthenticated) {
    return []
  }

  if (input.channel === 'web') {
    return input.isAdmin ? ['internal', 'restricted'] : ['internal']
  }

  if (input.channel === 'mcp') {
    return input.tokenScopes?.includes('knowledge.restricted.read')
      ? ['internal', 'restricted']
      : ['internal']
  }

  return []
}

export function isAdminEmailAllowlisted(
  email: string | null | undefined,
  allowlist: string[]
): boolean {
  if (!email) {
    return false
  }

  return allowlist.includes(normalizeEmailAddress(email))
}
