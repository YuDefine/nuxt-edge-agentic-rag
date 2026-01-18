#!/usr/bin/env npx tsx
/**
 * Create Admin Account Script
 *
 * 透過受保護的 setup endpoint 建立管理員帳號。
 * 需要設定 SETUP_SECRET_TOKEN 環境變數。
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts --email admin@example.com --password yourpassword
 *   npx tsx scripts/create-admin.ts -e admin@example.com -p yourpassword -n "Admin Name"
 *
 * Options:
 *   --email, -e     管理員 email（必填）
 *   --password, -p  密碼（必填，至少 8 字元）
 *   --name, -n      顯示名稱（選填，預設 "Admin"）
 *   --token, -t     Setup token（選填，預設從 SETUP_SECRET_TOKEN 環境變數讀取）
 *   --base-url, -u  API base URL（選填，預設 http://localhost:3010）
 *   --help, -h      顯示說明
 */

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--email' || arg === '-e') {
      result.email = args[++i]
    } else if (arg === '--password' || arg === '-p') {
      result.password = args[++i]
    } else if (arg === '--name' || arg === '-n') {
      result.name = args[++i]
    } else if (arg === '--token' || arg === '-t') {
      result.token = args[++i]
    } else if (arg === '--base-url' || arg === '-u') {
      result.baseUrl = args[++i]
    } else if (arg === '--help' || arg === '-h') {
      result.help = 'true'
    }
  }
  return result
}

function printHelp(): void {
  console.log(`
Create Admin Account Script

Usage:
  npx tsx scripts/create-admin.ts --email admin@example.com --password yourpassword

Options:
  --email, -e     管理員 email（必填）
  --password, -p  密碼（必填，至少 8 字元）
  --name, -n      顯示名稱（選填，預設 "Admin"）
  --token, -t     Setup token（選填，預設從 SETUP_SECRET_TOKEN 環境變數讀取）
  --base-url, -u  API base URL（選填，預設 http://localhost:3010）
  --help, -h      顯示說明

Prerequisites:
  1. 在 .env 設定 SETUP_SECRET_TOKEN=<your-secret-token>
  2. 確保 server 正在運行

Example:
  npx tsx scripts/create-admin.ts -e admin@company.com -p SecurePass123! -n "System Admin"
`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const email = args.email
  const password = args.password
  const name = args.name || 'Admin'
  const token = args.token || process.env.SETUP_SECRET_TOKEN
  const baseUrl = args.baseUrl || 'http://localhost:3010'

  if (!email) {
    console.error('錯誤: 必須提供 --email')
    printHelp()
    process.exit(1)
  }

  if (!password) {
    console.error('錯誤: 必須提供 --password')
    printHelp()
    process.exit(1)
  }

  if (password.length < 8) {
    console.error('錯誤: 密碼至少需要 8 字元')
    process.exit(1)
  }

  if (!token) {
    console.error('錯誤: 必須提供 --token 或設定 SETUP_SECRET_TOKEN 環境變數')
    process.exit(1)
  }

  console.log(`正在建立帳號: ${email}`)
  console.log(`API URL: ${baseUrl}`)

  try {
    const response = await fetch(`${baseUrl}/api/setup/create-admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Setup-Token': token,
      },
      body: JSON.stringify({ email, password, name }),
    })

    const data = await response.json().catch(() => ({}))

    if (response.ok) {
      console.log('✅ 帳號建立成功！')
      console.log(`   Email: ${email}`)
      console.log(`   Name: ${name}`)
      console.log('')
      console.log('下一步：')
      console.log(`1. 確保 ADMIN_EMAIL_ALLOWLIST 包含 ${email}`)
      console.log('2. 使用此帳號登入系統')
      console.log('3. 建議：移除 SETUP_SECRET_TOKEN 或刪除 setup endpoint')
    } else {
      if (response.status === 409) {
        console.log(`⚠️  帳號已存在: ${email}`)
        console.log('如需重設密碼，請使用忘記密碼功能或直接操作資料庫。')
      } else if (response.status === 401) {
        console.error('❌ Setup token 無效')
        process.exit(1)
      } else if (response.status === 503) {
        console.error('❌ Setup endpoint 未啟用（SETUP_SECRET_TOKEN 未設定）')
        process.exit(1)
      } else {
        console.error('❌ 建立失敗:', data.message || response.statusText)
        process.exit(1)
      }
    }
  } catch (error) {
    console.error('❌ 連線失敗:', error instanceof Error ? error.message : error)
    console.log('')
    console.log('請確認：')
    console.log(`1. Server 正在運行（${baseUrl}）`)
    console.log('2. 網路連線正常')
    process.exit(1)
  }
}

main()
