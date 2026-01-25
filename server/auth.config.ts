import { defineServerAuth } from '@onmax/nuxt-better-auth/config'
import { admin } from 'better-auth/plugins'

export default defineServerAuth(({ db, runtimeConfig }) => {
  const googleOAuth = runtimeConfig.oauth?.google
  const socialProviders =
    googleOAuth?.clientId && googleOAuth?.clientSecret
      ? {
          google: {
            clientId: googleOAuth.clientId,
            clientSecret: googleOAuth.clientSecret,
          },
        }
      : undefined

  // v1.0.0 spec: Google OAuth is the only interactive login path.
  // emailAndPassword is only enabled in local environment for setup endpoint.
  const knowledgeEnv = runtimeConfig.knowledge?.environment ?? 'local'
  const enableEmailAndPassword = knowledgeEnv === 'local'

  return {
    database: db,
    emailAndPassword: { enabled: enableEmailAndPassword },
    plugins: [admin()],
    ...(socialProviders ? { socialProviders } : {}),
    // Admin role is managed via DB directly:
    // - Local dev: use seed script or /api/_dev/login
    // - Production: use /api/setup/create-admin for bootstrap
  }
})
