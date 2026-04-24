import { fileURLToPath } from 'node:url'

import { createNitroRollupConfig } from './build/nitro/rollup'
import { createKnowledgeRuntimeConfig } from './shared/schemas/knowledge-runtime'
import { parseMcpConnectorClientsEnv } from './shared/utils/mcp-connector-client-registry'

const isVitest = process.env.VITEST === 'true'
const disableNuxtHints =
  process.env.NUXT_DISABLE_HINTS === 'true' || process.env.PLAYWRIGHT === 'true'
const mcpToolkitProviderPath = (provider: 'cloudflare' | 'node') =>
  fileURLToPath(
    new URL(
      `./node_modules/@nuxtjs/mcp-toolkit/dist/runtime/server/mcp/providers/${provider}.js`,
      import.meta.url,
    ),
  )
const mcpToolkitCloudflareProvider = mcpToolkitProviderPath('cloudflare')
const mcpToolkitNodeProvider = mcpToolkitProviderPath('node')
const mcpAgentsCompatProvider = fileURLToPath(
  new URL('./server/utils/mcp-agents-compat.ts', import.meta.url),
)
const devMcpAuthSigningKey = 'dev-only-mcp-auth-context-signing-key-keep-out-of-production'
const isLocalEnvironment = (process.env.NUXT_KNOWLEDGE_ENVIRONMENT ?? 'local') === 'local'

// https://nuxt.com/docs/api/configuration/nuxt-config
const knowledgeRuntimeConfig = createKnowledgeRuntimeConfig({
  adminEmailAllowlist: process.env.ADMIN_EMAIL_ALLOWLIST,
  aiGateway: {
    id: process.env.NUXT_KNOWLEDGE_AI_GATEWAY_ID,
    cacheEnabled: process.env.NUXT_KNOWLEDGE_AI_GATEWAY_CACHE_ENABLED,
  },
  autoRag: {
    apiToken: process.env.NUXT_KNOWLEDGE_AUTO_RAG_API_TOKEN,
  },
  bindings: {
    aiSearchIndex: process.env.NUXT_KNOWLEDGE_AI_SEARCH_INDEX,
    d1Database: process.env.NUXT_KNOWLEDGE_D1_DATABASE || 'DB',
    documentsBucket: process.env.NUXT_KNOWLEDGE_DOCUMENTS_BUCKET || 'BLOB',
    rateLimitKv: process.env.NUXT_KNOWLEDGE_RATE_LIMIT_KV || 'KV',
  },
  environment: process.env.NUXT_KNOWLEDGE_ENVIRONMENT,
  features: {
    adminDashboard: process.env.NUXT_KNOWLEDGE_FEATURE_ADMIN_DASHBOARD,
    cloudFallback: process.env.NUXT_KNOWLEDGE_FEATURE_CLOUD_FALLBACK,
    mcpSession: process.env.NUXT_KNOWLEDGE_FEATURE_MCP_SESSION,
    passkey: process.env.NUXT_KNOWLEDGE_FEATURE_PASSKEY,
  },
  mcp: {
    sessionTtlMs: process.env.NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS
      ? Number(process.env.NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS)
      : undefined,
  },
  mcpConnectors: {
    oauth: {
      accessTokenTtlSeconds: process.env.NUXT_KNOWLEDGE_MCP_ACCESS_TOKEN_TTL_SECONDS
        ? Number(process.env.NUXT_KNOWLEDGE_MCP_ACCESS_TOKEN_TTL_SECONDS)
        : undefined,
      authorizationCodeTtlSeconds: process.env.NUXT_KNOWLEDGE_MCP_AUTHORIZATION_CODE_TTL_SECONDS
        ? Number(process.env.NUXT_KNOWLEDGE_MCP_AUTHORIZATION_CODE_TTL_SECONDS)
        : undefined,
    },
    clients: parseMcpConnectorClientsEnv(process.env.NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON),
  },
  uploads: {
    accountId: process.env.NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID,
    accessKeyId: process.env.NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID,
    bucketName: process.env.NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME,
    presignExpiresSeconds: process.env.NUXT_KNOWLEDGE_UPLOADS_PRESIGN_EXPIRES_SECONDS
      ? Number(process.env.NUXT_KNOWLEDGE_UPLOADS_PRESIGN_EXPIRES_SECONDS)
      : undefined,
    secretAccessKey: process.env.NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY,
  },
})

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: false,

  modules: [
    // NuxtHub must be first for better-auth to receive D1 binding
    '@nuxthub/core',
    '@onmax/nuxt-better-auth',
    '@nuxt/ui',
    'nuxt-security',
    '@nuxt/image',
    '@vueuse/nuxt',
    'nuxt-charts',
    '@pinia/nuxt',
    '@pinia/colada-nuxt',
    '@nuxt/test-utils/module',
    'evlog/nuxt',
    ...(!disableNuxtHints ? ['@nuxt/hints'] : []),
    '@nuxtjs/mcp-toolkit',
    '@nuxt/a11y',
  ],

  // NuxtHub - auto-detects environment:
  // - Local: SQLite file + fs-based KV/blob in .data/
  // - Production: D1 + KV + R2 via wrangler.jsonc bindings
  hub: {
    db: 'sqlite',
    kv: isLocalEnvironment ? { driver: 'fs-lite', base: '.data/kv' } : true,
    blob: true,
    dir: '.data',
  },

  // Enable KV for better-auth session caching
  auth: {
    secondaryStorage: true,
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-TW' },
      title: '知識問答系統',
    },
  },

  css: ['~/assets/css/main.css'],

  components: [
    {
      path: '~/components',
      pathPrefix: true,
    },
  ],

  typescript: {
    typeCheck: process.env.PLAYWRIGHT !== 'true',
  },

  experimental: {
    serverAppConfig: false,
  },

  runtimeConfig: {
    knowledge: knowledgeRuntimeConfig,
    // Cloudflare account-level credentials for Analytics API (AI Gateway
    // usage read). Populated via `wrangler secret put CLOUDFLARE_ACCOUNT_ID`
    // and `... CLOUDFLARE_API_TOKEN_ANALYTICS`. Token scope MUST be
    // `Account → Analytics → Read` only — do **not** reuse the deploy
    // token. Secrets unused by any handler in an environment stay empty
    // and `/api/admin/usage` returns 503 in that case (see usage.get.ts).
    cloudflare: {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
      analyticsApiToken: process.env.CLOUDFLARE_API_TOKEN_ANALYTICS ?? '',
    },
    oauth: {
      google: {
        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID,
        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET,
      },
    },
    // passkey-authentication: WebAuthn Relying Party configuration.
    // Both values are required when `knowledge.features.passkey = true`
    // (see `server/auth.config.ts`). RP ID must equal the eTLD+1 of the
    // browser origin (e.g. `localhost` for local, `example.com` for
    // production). RP Name is displayed by the OS passkey UI.
    passkey: {
      rpId: process.env.NUXT_PASSKEY_RP_ID ?? '',
      rpName: process.env.NUXT_PASSKEY_RP_NAME ?? '',
    },
    session: {
      maxAge: 60 * 60 * 24 * 7,
      password: process.env.NUXT_SESSION_PASSWORD || '',
    },
    // Admin summary dashboard feature gate (server-side truth).
    //
    // Defaults to true for local so admin can validate the surface; set
    // `NUXT_ADMIN_DASHBOARD_ENABLED=false` to hide the page and navigation
    // entry. The API 404s when this is false.
    //
    // Kept separate from `knowledge.features.adminDashboard` (which tracks
    // the production v1.0.0 release flag) so this post-core change can
    // toggle independently without editing the governance schema.
    adminDashboardEnabled:
      (process.env.NUXT_ADMIN_DASHBOARD_ENABLED ?? 'true').toLowerCase() !== 'false',
    // observability-and-debug §1.3 — production kill-switch for the debug
    // surfaces. Local environment ignores this flag and serves the debug UI
    // to any admin. In production, the flag must be true for
    // `requireInternalDebugAccess()` to grant access; defaults to false.
    debugSurfaceEnabled: process.env.NUXT_DEBUG_SURFACE_ENABLED === 'true',
    // Shared secret for Nuxt -> Durable Object MCP auth-context envelopes.
    // Production/staging MUST set NUXT_MCP_AUTH_SIGNING_KEY to a distinct
    // high-entropy value; local dev gets a deterministic fallback only when
    // NUXT_ENV_DEV=true.
    mcpAuthSigningKey:
      process.env.NUXT_MCP_AUTH_SIGNING_KEY ||
      (process.env.NUXT_ENV_DEV === 'true' ? devMcpAuthSigningKey : ''),
    // Local-only convenience password used by `/api/_dev/login` when browser-
    // initiated test helpers omit the field. Keep aligned with `e2e/helpers.ts`.
    devLoginPassword: process.env.E2E_PASSWORD || 'testpass123',
    public: {
      adminContactEmail: process.env.NUXT_PUBLIC_ADMIN_CONTACT_EMAIL || '',
      // Client-visible mirror of `runtimeConfig.adminDashboardEnabled`.
      // The server flag is the authoritative gate (API 404s when off);
      // the public mirror only lets the UI hide the nav entry and skip
      // a doomed API call.
      adminDashboardEnabled:
        (process.env.NUXT_ADMIN_DASHBOARD_ENABLED ?? 'true').toLowerCase() !== 'false',
      // Client-visible effective access for observability debug surfaces.
      // Mirrors `requireInternalDebugAccess()` semantics in
      // `server/utils/debug-surface-guard.ts`: non-production is always
      // allowed (so admins can exercise the UI during dev / staging),
      // production only when the operator flips
      // `NUXT_DEBUG_SURFACE_ENABLED=true`. The server guard stays the
      // authoritative gate; this mirror only lets the UI hide the nav
      // entry so admins don't click into a 403.
      debugSurfaceEnabled:
        (process.env.NUXT_KNOWLEDGE_ENVIRONMENT ?? 'local') !== 'production' ||
        process.env.NUXT_DEBUG_SURFACE_ENABLED === 'true',
      // passkey-authentication: client-visible mirror of
      // `knowledge.features.passkey` (Decision 4: dual gate — server
      // plugin registration + UI conditional render). The server plugin
      // is the authoritative gate (endpoints 404 when off); this public
      // mirror only lets the UI hide the passkey buttons and skip a
      // doomed WebAuthn ceremony. Reads the same env var as the
      // governance flag via `createKnowledgeFeatureFlags` parsing.
      knowledge: {
        features: {
          passkey: (process.env.NUXT_KNOWLEDGE_FEATURE_PASSKEY ?? 'false').toLowerCase() === 'true',
        },
      },
    },
  },

  image: {
    quality: 80,
    format: ['webp', 'jpg', 'png'],
  },

  icon: {
    clientBundle: {
      scan: true,
      sizeLimitKb: 256,
    },
  },
  security: {
    rateLimiter: false,
    headers: {
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        'base-uri': ["'none'"],
        'connect-src': ["'self'", 'https://api.iconify.design'],
        'font-src': ["'self'", 'https:', 'data:'],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'img-src': ["'self'", 'data:', 'https:'],
        'object-src': ["'none'"],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'upgrade-insecure-requests': true,
      },
      xFrameOptions: 'DENY',
    },
    csrf: true,
  },

  routeRules: {
    // better-auth 有自己的 CSRF 保護，關閉 nuxt-security 的 CSRF 避免衝突
    '/api/auth/**': { csurf: false },
    // setup endpoint 用 secret token 保護，不需要 CSRF
    '/api/setup/**': { csurf: false },
    // MCP 是無狀態 API，使用 Bearer token 認證，不需要 CSRF。
    // @nuxtjs/mcp-toolkit 將 endpoint 掛在 `/mcp`（JSON-RPC, Bearer 認證）、
    // `/mcp/:handler`（同上）、`/mcp/deeplink`（GET，state-free HTML redirect）、
    // `/mcp/badge.svg`（GET，純 SVG 生成）。舊 `/api/mcp/**` 豁免路徑自
    // 2b083ac 遷移至 toolkit 後已失效，外部 MCP client 被 nuxt-security csurf
    // 擋下（HTTP 403 CSRF Token Mismatch）。
    // 新增任何 `/mcp/**` 路由前必須確認：要嘛 Bearer 認證、要嘛 GET-only 且不存取
    // session cookie，否則會從此洞滲漏 CSRF。
    '/mcp/**': { csurf: false },
    // dev endpoints 僅在 local 環境啟用，不需要 CSRF
    '/api/_dev/**': { csurf: false },
    // Nuxt DevTools 內部 hint endpoints（lazy-load 追蹤等），僅 dev mode
    ...(process.env.NODE_ENV !== 'production' && {
      '/__nuxt_hints/**': { csurf: false },
    }),
  },
  sourcemap: {
    client: false,
  },

  vite: {
    resolve: {
      alias: {
        // `vite-plugin-checker` injects `/@vite-plugin-checker-runtime`, but
        // Nuxt's asset base rewrites the import to `/_nuxt/...` during dev.
        // Alias it back so the virtual module can resolve and the dev overlay
        // stops blanking the entire SPA.
        '/_nuxt/@vite-plugin-checker-runtime': '/@vite-plugin-checker-runtime',
      },
    },
    build: {
      rollupOptions: isVitest
        ? undefined
        : {
            onwarn(warning, defaultHandler) {
              const message = typeof warning.message === 'string' ? warning.message : ''

              if (
                message.includes('Sourcemap is likely to be incorrect') &&
                (message.includes('nuxt:module-preload-polyfill') ||
                  message.includes('@tailwindcss/vite:generate:build'))
              ) {
                return
              }

              defaultHandler(warning)
            },
          },
    },
  },
  evlog: {
    env: { service: 'nuxt-edge-agentic-rag' },
    include: ['/api/**'],
  },

  devtools: {
    enabled: process.env.NUXT_DEVTOOLS_ENABLED !== 'false' && process.env.PLAYWRIGHT !== 'true',
  },

  nitro: {
    preset: 'cloudflare_module',
    alias: {
      [mcpToolkitCloudflareProvider]: mcpToolkitNodeProvider,
      'agents/mcp': mcpAgentsCompatProvider,
    },
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
    experimental: {
      tasks: true,
    },
    esbuild: {
      options: {
        target: 'es2022',
      },
    },
    // Cloudflare Workers Cron Trigger → Nitro scheduled task.
    // Cron expression also declared in wrangler.jsonc (`triggers.crons`);
    // both must stay in sync.
    scheduledTasks: {
      // Daily at 03:00 UTC.
      '0 3 * * *': ['retention-cleanup'],
    },
    rollupConfig: isVitest ? {} : createNitroRollupConfig(),
  },
})
