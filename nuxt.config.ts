// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-05-15",
  ssr: false,

  modules: [
    "@onmax/nuxt-better-auth",
    "@nuxt/ui",
    "nuxt-security",
    "@nuxt/image",
    "@vueuse/nuxt",
    "nuxt-charts",
    "@pinia/nuxt",
    "@pinia/colada-nuxt",
    "@nuxt/test-utils/module",
    "@sentry/nuxt/module",
    "evlog/nuxt",
  ],

  css: ["~/assets/css/main.css"],

  components: [
    {
      path: "~/components",
      pathPrefix: false,
    },
  ],

  typescript: {
    typeCheck: true,
  },

  runtimeConfig: {
    oauth: {
      google: {
        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID,
        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET,
      },
      github: {
        clientId: process.env.NUXT_OAUTH_GITHUB_CLIENT_ID,
        clientSecret: process.env.NUXT_OAUTH_GITHUB_CLIENT_SECRET,
      },
    },
    session: {
      maxAge: 60 * 60 * 24 * 7,
      password: process.env.NUXT_SESSION_PASSWORD || "",
    },
    public: {
      sentry: {
        dsn: process.env.NUXT_PUBLIC_SENTRY_DSN || "",
      },
    },
  },

  image: {
    quality: 80,
    format: ["webp", "jpg", "png"],
  },
  security: {
    rateLimiter: false,
    headers: {
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        "base-uri": ["'none'"],
        "font-src": ["'self'", "https:", "data:"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "img-src": ["'self'", "data:", "https:"],
        "object-src": ["'none'"],
        "script-src-attr": ["'none'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "upgrade-insecure-requests": true,
      },
      xFrameOptions: "DENY",
    },
    csrf: true,
  },
  sentry: {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
  },
  sourcemap: {
    client: "hidden",
  },
  evlog: {
    env: { service: "nuxt-edge-agentic-rag" },
    include: ["/api/**"],
  },

  devtools: {
    enabled: true,
  },

  nitro: {
    preset: "cloudflare_module",
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
});
