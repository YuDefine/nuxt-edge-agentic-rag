export async function requireRuntimeAdminSession(event: Parameters<typeof requireUserSession>[0]) {
  const session = await requireUserSession(event)

  if (!getRuntimeAdminAccess(session.user.email ?? null)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Runtime admin access is required',
    })
  }

  return session
}
