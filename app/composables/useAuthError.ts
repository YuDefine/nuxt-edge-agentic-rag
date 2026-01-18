function parseAuthError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('oauth') || msg.includes('google')) {
      return 'Google 登入失敗，請稍後再試'
    }
    return error.message
  }
  return '發生未知錯誤'
}

export function useAuthError() {
  return { parseAuthError }
}
