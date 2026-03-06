#!/usr/bin/env npx tsx
/**
 * Create MCP Token Script
 *
 * 建立 MCP API Token 用於測試 #4 權限驗證。
 * 需要 admin session cookie。
 *
 * Usage:
 *   npx tsx scripts/create-mcp-token.ts --name "Test Token" --scopes "knowledge.search,knowledge.ask"
 *   npx tsx scripts/create-mcp-token.ts --name "Full Access" --scopes "knowledge.search,knowledge.ask,knowledge.restricted.read"
 *
 * Options:
 *   --name, -n       Token 名稱（必填）
 *   --scopes, -s     Scopes（逗號分隔，必填）
 *   --cookie, -c     Session cookie（選填，預設從 MCP_TEST_COOKIE 環境變數讀取）
 *   --base-url, -u   API base URL（選填，預設 https://agentic.yudefine.com.tw）
 *   --help, -h       顯示說明
 *
 * Available Scopes:
 *   - knowledge.search       搜尋知識庫
 *   - knowledge.ask          問答
 *   - knowledge.citation.read 讀取引用
 *   - knowledge.category.list 列出分類
 *   - knowledge.restricted.read 讀取受限內容（#4 驗證用）
 */

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--name' || arg === '-n') {
      result.name = args[++i]
    } else if (arg === '--scopes' || arg === '-s') {
      result.scopes = args[++i]
    } else if (arg === '--cookie' || arg === '-c') {
      result.cookie = args[++i]
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
Create MCP Token Script

Usage:
  npx tsx scripts/create-mcp-token.ts --name "Test Token" --scopes "knowledge.search,knowledge.ask"

Options:
  --name, -n       Token 名稱（必填）
  --scopes, -s     Scopes（逗號分隔，必填）
  --cookie, -c     Session cookie（選填，預設從 MCP_TEST_COOKIE 環境變數讀取）
  --base-url, -u   API base URL（選填，預設 https://agentic.yudefine.com.tw）
  --help, -h       顯示說明

Available Scopes:
  - knowledge.search         搜尋知識庫
  - knowledge.ask            問答
  - knowledge.citation.read  讀取引用
  - knowledge.category.list  列出分類
  - knowledge.restricted.read 讀取受限內容（用於 #4 驗證）

Examples:
  # 建立無 restricted 權限的 token（用於測試 existence-hiding）
  npx tsx scripts/create-mcp-token.ts -n "Limited Token" -s "knowledge.search,knowledge.ask"

  # 建立有 restricted 權限的 token（用於對照）
  npx tsx scripts/create-mcp-token.ts -n "Full Token" -s "knowledge.search,knowledge.ask,knowledge.restricted.read"
`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const name = args.name
  const scopes = args.scopes
  const cookie = args.cookie || process.env.MCP_TEST_COOKIE
  const baseUrl = args.baseUrl || 'https://agentic.yudefine.com.tw'

  if (!name) {
    console.error('錯誤: 必須提供 --name')
    printHelp()
    process.exit(1)
  }

  if (!scopes) {
    console.error('錯誤: 必須提供 --scopes')
    printHelp()
    process.exit(1)
  }

  if (!cookie) {
    console.error('錯誤: 必須提供 --cookie 或設定 MCP_TEST_COOKIE 環境變數')
    console.log('')
    console.log('取得 cookie 方式：')
    console.log('1. 在瀏覽器登入')
    console.log('2. 開啟開發者工具 > Application > Cookies')
    console.log('3. 複製 better-auth.session_token 的值')
    process.exit(1)
  }

  const scopeArray = scopes.split(',').map((s) => s.trim())

  console.log(`正在建立 MCP Token: ${name}`)
  console.log(`Scopes: ${scopeArray.join(', ')}`)
  console.log(`API URL: ${baseUrl}`)
  console.log('')

  try {
    // Note: Cookie format is "better-auth.session_token=xxx"
    const cookieHeader = cookie.includes('=') ? cookie : `better-auth.session_token=${cookie}`

    const response = await fetch(`${baseUrl}/api/admin/mcp-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        name,
        scopes: scopeArray,
      }),
    })

    const data = (await response.json().catch(() => ({}))) as {
      token?: string
      id?: string
      message?: string
    }

    if (response.ok && data.token) {
      console.log('✅ Token 建立成功！')
      console.log('')
      console.log('Token（請妥善保存，只會顯示一次）：')
      console.log(`   ${data.token}`)
      console.log('')
      console.log('測試命令（JSON-RPC over /mcp）：')
      console.log(`   curl -s -X POST "${baseUrl}/mcp" \\`)
      console.log(`     -H "Authorization: Bearer ${data.token}" \\`)
      console.log('     -H "Content-Type: application/json" \\')
      console.log(
        '     -d \'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"searchKnowledge","arguments":{"query":"test"}}}\''
      )
    } else {
      if (response.status === 401 || response.status === 403) {
        console.error('❌ 權限不足（需要 admin 權限）')
      } else if (response.status === 404) {
        console.error('❌ API endpoint 不存在（可能尚未部署）')
      } else {
        console.error('❌ 建立失敗:', data.message || response.statusText)
      }
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ 連線失敗:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
