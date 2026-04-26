import { z } from 'zod'

export const KNOWLEDGE_ACCESS_LEVEL_VALUES = ['internal', 'restricted'] as const
export const KNOWLEDGE_CHANNEL_VALUES = ['web', 'mcp'] as const
export const KNOWLEDGE_ENVIRONMENT_VALUES = ['local', 'staging', 'production'] as const
export const KNOWLEDGE_FEATURE_FLAG_VALUES = [
  'passkey',
  'mcpSession',
  'cloudFallback',
  'adminDashboard',
  'queryRewriting',
] as const
export const MCP_TOKEN_SCOPE_VALUES = [
  'knowledge.search',
  'knowledge.ask',
  'knowledge.citation.read',
  'knowledge.category.list',
  'knowledge.restricted.read',
] as const

export type KnowledgeEnvironment = (typeof KNOWLEDGE_ENVIRONMENT_VALUES)[number]

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
  environment: KnowledgeEnvironment
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

export interface KnowledgeAutoRagConfig {
  apiToken: string
}

export interface KnowledgeAiGatewayConfig {
  id: string
  cacheEnabled: boolean
}

export interface KnowledgeFeatureFlags {
  adminDashboard: boolean
  cloudFallback: boolean
  mcpSession: boolean
  passkey: boolean
  /**
   * workers-ai-grounded-answering §S-FF (change rag-query-rewriting):
   * gate for the optional LLM-based query rewriting step inside
   * `retrieveVerifiedEvidence`. Default `false` in production until
   * acceptance evidence demonstrates retrieval quality improvement.
   */
  queryRewriting: boolean
}

export interface McpConnectorClientConfig {
  clientId: string
  enabled: boolean
  allowedScopes: string[]
  environments: KnowledgeEnvironment[]
  name: string
  redirectUris: string[]
}

export interface KnowledgeMcpConnectorsConfig {
  oauth: {
    accessTokenTtlSeconds: number
    authorizationCodeTtlSeconds: number
  }
  clients: McpConnectorClientConfig[]
}

export interface KnowledgeMcpConfig {
  sessionTtlMs: number
}

export interface KnowledgeRuntimeConfig {
  adminEmailAllowlist: string[]
  aiGateway: KnowledgeAiGatewayConfig
  autoRag: KnowledgeAutoRagConfig
  bindings: KnowledgeBindingsConfig
  environment: KnowledgeEnvironment
  features: KnowledgeFeatureFlags
  governance: KnowledgeGovernanceConfig
  mcp: KnowledgeMcpConfig
  mcpConnectors: KnowledgeMcpConnectorsConfig
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
  aiGateway?: {
    id?: string
    cacheEnabled?: boolean | string
  }
  autoRag?: Partial<KnowledgeAutoRagConfig>
  bindings?: Partial<KnowledgeBindingsConfig>
  environment?: string
  features?: Partial<
    Record<(typeof KNOWLEDGE_FEATURE_FLAG_VALUES)[number], boolean | string | undefined>
  >
  governance?: KnowledgeGovernanceInput
  mcp?: {
    sessionTtlMs?: number | string
  }
  mcpConnectors?: {
    oauth?: {
      accessTokenTtlSeconds?: number | string
      authorizationCodeTtlSeconds?: number | string
    }
    clients?: Array<{
      clientId?: string
      enabled?: boolean | string
      allowedScopes?: string[]
      environments?: string[]
      name?: string
      redirectUris?: string[]
    }>
  }
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
  aiGateway: z.object({
    id: z.string(),
    cacheEnabled: z.boolean(),
  }),
  autoRag: z.object({
    apiToken: z.string(),
  }),
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
    queryRewriting: z.boolean(),
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
      queryRewriting: z.boolean(),
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
  mcp: z.object({
    sessionTtlMs: z.number().int().min(1000).max(86_400_000),
  }),
  mcpConnectors: z.object({
    oauth: z.object({
      accessTokenTtlSeconds: z.number().int().min(1).max(86400),
      authorizationCodeTtlSeconds: z.number().int().min(1).max(3600),
    }),
    clients: z.array(
      z.object({
        clientId: z.string().trim().min(1),
        enabled: z.boolean(),
        allowedScopes: z.array(z.enum(MCP_TOKEN_SCOPE_VALUES)),
        environments: z.array(z.enum(KNOWLEDGE_ENVIRONMENT_VALUES)).min(1),
        name: z.string().trim().min(1),
        redirectUris: z.array(z.string().url()).min(1),
      }),
    ),
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
  },
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
  },
)

export const DEFAULT_KNOWLEDGE_MODEL_ROLES: Readonly<KnowledgeModelRoles> = Object.freeze({
  agentJudge: 'agentJudge',
  defaultAnswer: 'defaultAnswer',
})

export const DEFAULT_MCP_SESSION_TTL_MS = 1_800_000

export function parseBooleanFlag(value: boolean | string | undefined, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }

  return fallback
}

export function parsePositiveInteger(value: number | string | undefined, fallback: number): number {
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

function parseStringArray(values?: string[]): string[] {
  if (!Array.isArray(values)) {
    return []
  }

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
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

export function resolveAdminEmailAllowlist(input: {
  configuredAllowlist?: string | string[]
  runtimeAllowlist?: string | string[]
}): string[] {
  const runtimeAllowlist = parseAdminEmailAllowlist(input.runtimeAllowlist)
  if (runtimeAllowlist.length > 0) {
    return runtimeAllowlist
  }

  return parseAdminEmailAllowlist(input.configuredAllowlist)
}

export function resolveKnowledgeRuntimeConfig(
  knowledge: KnowledgeRuntimeConfigInput | undefined,
  runtimeAllowlist = process.env.ADMIN_EMAIL_ALLOWLIST,
) {
  const configuredKnowledge = knowledge ?? {}

  return createKnowledgeRuntimeConfig({
    ...configuredKnowledge,
    adminEmailAllowlist: resolveAdminEmailAllowlist({
      configuredAllowlist: configuredKnowledge.adminEmailAllowlist,
      runtimeAllowlist,
    }),
  })
}

export function createKnowledgeFeatureFlags(
  overrides?: KnowledgeRuntimeConfigInput['features'],
): KnowledgeFeatureFlags {
  return {
    adminDashboard: parseBooleanFlag(overrides?.adminDashboard),
    cloudFallback: parseBooleanFlag(overrides?.cloudFallback),
    mcpSession: parseBooleanFlag(overrides?.mcpSession),
    passkey: parseBooleanFlag(overrides?.passkey),
    queryRewriting: parseBooleanFlag(overrides?.queryRewriting),
  }
}

export function buildKnowledgeConfigSnapshotVersion(input: {
  environment: KnowledgeEnvironment
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
      (featureName) => `features.${featureName}=${input.features[featureName] ? 'on' : 'off'}`,
    ),
  ].join(';')
}

export function createKnowledgeGovernanceConfig(input: {
  environment: KnowledgeEnvironment
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
  input: KnowledgeRuntimeConfigInput = {},
): KnowledgeRuntimeConfig {
  const environment = z
    .enum(KNOWLEDGE_ENVIRONMENT_VALUES)
    .catch('local')
    .parse(input.environment ?? 'local')
  const features = createKnowledgeFeatureFlags(input.features)

  return knowledgeRuntimeConfigSchema.parse({
    adminEmailAllowlist: parseAdminEmailAllowlist(input.adminEmailAllowlist),
    aiGateway: {
      id: input.aiGateway?.id ?? '',
      cacheEnabled: parseBooleanFlag(input.aiGateway?.cacheEnabled, true),
    },
    autoRag: {
      apiToken: input.autoRag?.apiToken ?? '',
    },
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
    mcp: {
      sessionTtlMs: parsePositiveInteger(input.mcp?.sessionTtlMs, DEFAULT_MCP_SESSION_TTL_MS),
    },
    mcpConnectors: {
      oauth: {
        accessTokenTtlSeconds: parsePositiveInteger(
          input.mcpConnectors?.oauth?.accessTokenTtlSeconds,
          600,
        ),
        authorizationCodeTtlSeconds: parsePositiveInteger(
          input.mcpConnectors?.oauth?.authorizationCodeTtlSeconds,
          120,
        ),
      },
      clients: (input.mcpConnectors?.clients ?? []).map((client) => ({
        clientId: client.clientId?.trim() ?? '',
        enabled: parseBooleanFlag(client.enabled, false),
        allowedScopes: parseStringArray(client.allowedScopes),
        environments: parseStringArray(client.environments) as KnowledgeEnvironment[],
        name: client.name?.trim() ?? '',
        redirectUris: parseStringArray(client.redirectUris),
      })),
    },
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
  allowlist: string[],
): boolean {
  if (!email) {
    return false
  }

  return allowlist.includes(normalizeEmailAddress(email))
}

function formatGovernedNumber(value: number): string {
  return `${Number(value.toFixed(2))}`
}
