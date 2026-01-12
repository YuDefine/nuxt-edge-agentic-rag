import { defineServerAuth } from '@onmax/nuxt-better-auth/config'

export default defineServerAuth(({ runtimeConfig }) => {
  const hasGoogleOAuth = Boolean(
    runtimeConfig.oauth.google.clientId && runtimeConfig.oauth.google.clientSecret
  )

  return {
    emailAndPassword: { enabled: true },
    ...(hasGoogleOAuth
      ? {
          socialProviders: {
            google: {
              clientId: runtimeConfig.oauth.google.clientId,
              clientSecret: runtimeConfig.oauth.google.clientSecret,
            },
          },
        }
      : {}),
  }
})
