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

export interface KnowledgeRetrievalConfig {
  maxResults: number
  minScore: number
}

export interface KnowledgeDecisionThresholds {
  answerMin: number
  directAnswerMin: number
  judgeMin: number
}

export interface KnowledgeExecutionConfig {
  maxSelfCorrectionRetry: number
}

export interface KnowledgeModelRoles {
  agentJudge: string
  defaultAnswer: string
}

export interface KnowledgeGovernanceConfig {
  configSnapshotVersion: string
  environment: string
  execution: KnowledgeExecutionConfig
  features: KnowledgeFeatureFlags
  models: KnowledgeModelRoles
  retrieval: KnowledgeRetrievalConfig
  thresholds: KnowledgeDecisionThresholds
}

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
  governance: KnowledgeGovernanceConfig
  uploads: KnowledgeUploadsConfig
}

export interface KnowledgeGovernanceInput {
  execution?: Partial<KnowledgeExecutionConfig>
  models?: Partial<KnowledgeModelRoles>
  retrieval?: Partial<KnowledgeRetrievalConfig>
  thresholds?: Partial<KnowledgeDecisionThresholds>
}

export interface KnowledgeRuntimeConfigInput {
  adminEmailAllowlist?: string | string[]
  bindings?: Partial<KnowledgeBindingsConfig>
  environment?: string
  features?: Partial<
    Record<(typeof KNOWLEDGE_FEATURE_FLAG_VALUES)[number], boolean | string | undefined>
  >
  governance?: KnowledgeGovernanceInput
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
  governance: z.object({
    configSnapshotVersion: z.string().min(1),
    environment: z.enum(KNOWLEDGE_ENVIRONMENT_VALUES),
    execution: z.object({
      maxSelfCorrectionRetry: z.number().int().min(0),
    }),
    features: z.object({
      adminDashboard: z.boolean(),
      cloudFallback: z.boolean(),
      mcpSession: z.boolean(),
      passkey: z.boolean(),
    }),
    models: z.object({
      agentJudge: z.string().min(1),
      defaultAnswer: z.string().min(1),
    }),
    retrieval: z.object({
      maxResults: z.number().int().min(1),
      minScore: z.number().min(0).max(1),
    }),
    thresholds: z.object({
      answerMin: z.number().min(0).max(1),
      directAnswerMin: z.number().min(0).max(1),
      judgeMin: z.number().min(0).max(1),
    }),
  }),
  uploads: z.object({
    accountId: z.string(),
    accessKeyId: z.string(),
    bucketName: z.string(),
    presignExpiresSeconds: z.number().int().min(1).max(604800),
    secretAccessKey: z.string(),
  }),
})

export const DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG: Readonly<KnowledgeRetrievalConfig> = Object.freeze(
  {
    maxResults: 8,
    minScore: 0.2,
  }
)

export const DEFAULT_KNOWLEDGE_DECISION_THRESHOLDS: Readonly<KnowledgeDecisionThresholds> =
  Object.freeze({
    answerMin: 0.55,
    directAnswerMin: 0.7,
    judgeMin: 0.45,
  })

export const DEFAULT_KNOWLEDGE_EXECUTION_CONFIG: Readonly<KnowledgeExecutionConfig> = Object.freeze(
  {
    maxSelfCorrectionRetry: 1,
  }
)

export const DEFAULT_KNOWLEDGE_MODEL_ROLES: Readonly<KnowledgeModelRoles> = Object.freeze({
  agentJudge: 'agentJudge',
  defaultAnswer: 'defaultAnswer',
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

export function buildKnowledgeConfigSnapshotVersion(input: {
  environment: string
  execution: KnowledgeExecutionConfig
  features: KnowledgeFeatureFlags
  models: KnowledgeModelRoles
  retrieval: KnowledgeRetrievalConfig
  thresholds: KnowledgeDecisionThresholds
}): string {
  return [
    'kgov-v1',
    `env=${input.environment}`,
    `retrieval.maxResults=${input.retrieval.maxResults}`,
    `retrieval.minScore=${formatGovernedNumber(input.retrieval.minScore)}`,
    `thresholds.directAnswerMin=${formatGovernedNumber(input.thresholds.directAnswerMin)}`,
    `thresholds.judgeMin=${formatGovernedNumber(input.thresholds.judgeMin)}`,
    `thresholds.answerMin=${formatGovernedNumber(input.thresholds.answerMin)}`,
    `execution.maxSelfCorrectionRetry=${input.execution.maxSelfCorrectionRetry}`,
    `models.defaultAnswer=${input.models.defaultAnswer}`,
    `models.agentJudge=${input.models.agentJudge}`,
    ...KNOWLEDGE_FEATURE_FLAG_VALUES.map(
      (featureName) => `features.${featureName}=${input.features[featureName] ? 'on' : 'off'}`
    ),
  ].join(';')
}

export function createKnowledgeGovernanceConfig(input: {
  environment: string
  features: KnowledgeFeatureFlags
  governance?: KnowledgeGovernanceInput
}): KnowledgeGovernanceConfig {
  const retrieval = {
    maxResults:
      input.governance?.retrieval?.maxResults ?? DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.maxResults,
    minScore: input.governance?.retrieval?.minScore ?? DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.minScore,
  }
  const thresholds = {
    answerMin:
      input.governance?.thresholds?.answerMin ?? DEFAULT_KNOWLEDGE_DECISION_THRESHOLDS.answerMin,
    directAnswerMin:
      input.governance?.thresholds?.directAnswerMin ??
      DEFAULT_KNOWLEDGE_DECISION_THRESHOLDS.directAnswerMin,
    judgeMin:
      input.governance?.thresholds?.judgeMin ?? DEFAULT_KNOWLEDGE_DECISION_THRESHOLDS.judgeMin,
  }
  const execution = {
    maxSelfCorrectionRetry:
      input.governance?.execution?.maxSelfCorrectionRetry ??
      DEFAULT_KNOWLEDGE_EXECUTION_CONFIG.maxSelfCorrectionRetry,
  }
  const models = {
    agentJudge: input.governance?.models?.agentJudge ?? DEFAULT_KNOWLEDGE_MODEL_ROLES.agentJudge,
    defaultAnswer:
      input.governance?.models?.defaultAnswer ?? DEFAULT_KNOWLEDGE_MODEL_ROLES.defaultAnswer,
  }

  return {
    configSnapshotVersion: buildKnowledgeConfigSnapshotVersion({
      environment: input.environment,
      execution,
      features: input.features,
      models,
      retrieval,
      thresholds,
    }),
    environment: input.environment,
    execution,
    features: input.features,
    models,
    retrieval,
    thresholds,
  }
}

export function createKnowledgeRuntimeConfig(
  input: KnowledgeRuntimeConfigInput = {}
): KnowledgeRuntimeConfig {
  const environment = z
    .enum(KNOWLEDGE_ENVIRONMENT_VALUES)
    .catch('local')
    .parse(input.environment ?? 'local')
  const features = createKnowledgeFeatureFlags(input.features)

  return knowledgeRuntimeConfigSchema.parse({
    adminEmailAllowlist: parseAdminEmailAllowlist(input.adminEmailAllowlist),
    bindings: {
      aiSearchIndex: input.bindings?.aiSearchIndex ?? '',
      d1Database: input.bindings?.d1Database ?? '',
      documentsBucket: input.bindings?.documentsBucket ?? '',
      rateLimitKv: input.bindings?.rateLimitKv ?? '',
    },
    environment,
    features,
    governance: createKnowledgeGovernanceConfig({
      environment,
      features,
      governance: input.governance,
    }),
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

function formatGovernedNumber(value: number): string {
  return `${Number(value.toFixed(2))}`
}
