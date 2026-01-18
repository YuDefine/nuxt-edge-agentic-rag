import { z } from 'zod'

/**
 * 受保護的管理員帳號建立 endpoint
 *
 * 需要在 header 中提供 SETUP_SECRET_TOKEN
 * 僅供首次設定使用，建立帳號後建議移除此 endpoint 或停用 token
 *
 * NOTE: 此 endpoint 只在 NUXT_KNOWLEDGE_ENVIRONMENT=local 時可用。
 * Production/staging 環境下 emailAndPassword 已依 v1.0.0 spec 停用。
 *
 * Usage:
 *   curl -X POST http://localhost:3010/api/setup/create-admin \
 *     -H "Content-Type: application/json" \
 *     -H "X-Setup-Token: your-secret-token" \
 *     -d '{"email":"admin@example.com","password":"password123","name":"Admin"}'
 */

const bodySchema = z.object({
  email: z.string().email('請輸入有效的 Email'),
  password: z.string().min(8, '密碼至少需要 8 字元'),
  name: z.string().min(1, '請輸入名稱').default('Admin'),
})

export default defineEventHandler(async (event) => {
  // 驗證 setup token
  const setupToken = process.env.SETUP_SECRET_TOKEN
  if (!setupToken) {
    throw createError({
      statusCode: 503,
      message: 'Setup endpoint 未啟用（SETUP_SECRET_TOKEN 未設定）',
    })
  }

  const providedToken = getHeader(event, 'x-setup-token')
  if (providedToken !== setupToken) {
    throw createError({
      statusCode: 401,
      message: '無效的 setup token',
    })
  }

  // 驗證請求 body
  const body = await readValidatedBody(event, bodySchema.parse)

  // 使用 Better Auth 的 internal API 建立帳號
  const auth = serverAuth(event)

  try {
    // 呼叫 sign-up API
    const response = await auth.api.signUpEmail({
      body: {
        email: body.email,
        password: body.password,
        name: body.name,
      },
    })

    return {
      success: true,
      message: '帳號建立成功',
      user: {
        id: response.user.id,
        email: response.user.email,
        name: response.user.name,
      },
    }
  } catch (error: unknown) {
    // 處理已存在的帳號
    if (error instanceof Error && error.message.includes('already exists')) {
      throw createError({
        statusCode: 409,
        message: '帳號已存在',
      })
    }

    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : '建立帳號失敗',
    })
  }
})
