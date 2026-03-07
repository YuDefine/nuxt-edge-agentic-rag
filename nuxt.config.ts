import { createKnowledgeRuntimeConfig } from './shared/schemas/knowledge-runtime'

// https://nuxt.com/docs/api/configuration/nuxt-config
const knowledgeRuntimeConfig = createKnowledgeRuntimeConfig({
  adminEmailAllowlist: process.env.ADMIN_EMAIL_ALLOWLIST,
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
  compatibilityDate: '2025-05-15',
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
    '@nuxt/hints',
    '@nuxtjs/mcp-toolkit',
  ],

  // NuxtHub - auto-detects environment:
  // - Local: SQLite file + fs-based KV/blob in .data/
  // - Production: D1 + KV + R2 via wrangler.jsonc bindings
  hub: {
    db: 'sqlite',
    kv: process.env.NODE_ENV === 'development' ? { driver: 'fs-lite', base: '.data/kv' } : true,
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
    typeCheck: true,
  },

  experimental: {
    serverAppConfig: false,
  },

  runtimeConfig: {
    knowledge: knowledgeRuntimeConfig,
    oauth: {
      google: {
        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID,
        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET,
      },
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
    public: {
      adminContactEmail: process.env.NUXT_PUBLIC_ADMIN_CONTACT_EMAIL || '',
      // Client-visible mirror of `runtimeConfig.adminDashboardEnabled`.
      // The server flag is the authoritative gate (API 404s when off);
      // the public mirror only lets the UI hide the nav entry and skip
      // a doomed API call.
      adminDashboardEnabled:
        (process.env.NUXT_ADMIN_DASHBOARD_ENABLED ?? 'true').toLowerCase() !== 'false',
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
    // MCP 是無狀態 API，使用 Bearer token 認證，不需要 CSRF
    '/api/mcp/**': { csurf: false },
    // dev endpoints 僅在 local 環境啟用，不需要 CSRF
    '/api/_dev/**': { csurf: false },
    // Nuxt DevTools 內部 hint endpoints（lazy-load 追蹤等），僅 dev mode
    ...(process.env.NODE_ENV !== 'production' && {
      '/__nuxt_hints/**': { csurf: false },
    }),
  },
  sourcemap: {
    client: 'hidden',
  },
  evlog: {
    env: { service: 'nuxt-edge-agentic-rag' },
    include: ['/api/**'],
  },

  devtools: {
    enabled: true,
  },

  nitro: {
    preset: 'cloudflare_module',
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
    experimental: {
      tasks: true,
    },
    // Cloudflare Workers Cron Trigger → Nitro scheduled task.
    // Cron expression also declared in wrangler.jsonc (`triggers.crons`);
    // both must stay in sync.
    scheduledTasks: {
      // Daily at 03:00 UTC.
      '0 3 * * *': ['retention:cleanup'],
    },
  },
})
