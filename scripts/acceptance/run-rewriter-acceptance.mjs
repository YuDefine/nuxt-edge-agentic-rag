#!/usr/bin/env node
/**
 * Rewriter acceptance driver（TD-060 第二輪 / change rag-query-rewriting 6.4）。
 *
 * 對一個跑著 query rewriting feature flag 的 endpoint（wrangler dev local 或
 * staging）跑 `test/fixtures/acceptance/seed/cases.json` 的 web-channel cases，
 * 觸發完整 retrieve pipeline（normalize → rewriter → AI Search）。
 *
 * retrieval_score / rewriter_status 不由本 script 解析 response 取得 —— 它們
 * 由 pipeline 寫進 D1（query_logs + query_log_debug），跑完後用
 * `wrangler d1 execute ... --command "SELECT ..."` 撈統計（見 6.5）。
 *
 * 本 script 只負責：mint dev-login session → 逐 case POST /api/chat → 記錄
 * 每筆 client-side latency + http status + 是否觸發成功，輸出 NDJSON 供統計。
 *
 * 用法：
 *   BASE_URL=http://127.0.0.1:8799 \
 *   DEV_LOGIN_EMAIL=admin@test.local DEV_LOGIN_PASSWORD=testpass123 \
 *   node scripts/acceptance/run-rewriter-acceptance.mjs > /tmp/acceptance-run.ndjson
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8799'
const DEV_LOGIN_EMAIL = process.env.DEV_LOGIN_EMAIL ?? 'admin@test.local'
const DEV_LOGIN_PASSWORD = process.env.DEV_LOGIN_PASSWORD ?? 'testpass123'
// 若直接帶現成 cookie（staging 模式），跳過 dev-login mint
const PRESET_COOKIE = process.env.SESSION_COOKIE ?? ''
const CASES_PATH =
  process.env.CASES_PATH ?? resolve(repoRoot, 'test/fixtures/acceptance/seed/cases.json')

function log(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

async function mintCookie() {
  if (PRESET_COOKIE) return PRESET_COOKIE
  const res = await fetch(`${BASE_URL}/api/_dev/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEV_LOGIN_EMAIL, password: DEV_LOGIN_PASSWORD, as: 'admin' }),
  })
  if (!res.ok) {
    throw new Error(`dev-login failed: ${res.status} ${await res.text()}`)
  }
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean)
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('dev-login returned no set-cookie')
  return cookie
}

// nuxt-security csurf dual-token: GET / (帶 session) 收 csrf= cookie + <meta name="csrf-token">，
// mutation 必須同時帶 csrf cookie + csrf-token header，否則 403 "CSRF Cookie not found"。
async function harvestCsrf(sessionCookie) {
  const res = await fetch(`${BASE_URL}/`, { headers: { Cookie: sessionCookie } })
  const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean)
  // nuxt-security 預設 cookie 名為 `__Host-csrf`（Secure prefix）；舊版可能用 `csrf=`。
  // Secure cookie 不會被 curl/fetch 自動 replay over HTTP，故手動 extract + 顯式送。
  const csrfCookie = setCookies
    .map((c) => c.split(';')[0])
    .find((c) => /(?:^|\b)(?:__Host-|__Secure-)?csrf=/.test(c))
  const html = await res.text()
  const m = html.match(/csrf-token"\s+content="([^"]+)"/)
  return { csrfCookie: csrfCookie ?? '', csrfToken: m?.[1] ?? '' }
}

async function runCase(cookie, csrf, c) {
  const started = Date.now()
  let status = 0
  let ok = false
  let errText = ''
  const fullCookie = csrf.csrfCookie ? `${cookie}; ${csrf.csrfCookie}` : cookie
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: fullCookie,
        ...(csrf.csrfToken ? { 'csrf-token': csrf.csrfToken } : {}),
      },
      body: JSON.stringify({ query: c.prompt }),
    })
    status = res.status
    ok = res.ok
    if (!ok) errText = (await res.text()).slice(0, 200)
    else await res.text() // drain body
  } catch (e) {
    errText = String(e).slice(0, 200)
  }
  const latencyMs = Date.now() - started
  return {
    caseId: c.caseId,
    registryId: c.registryId,
    prompt: c.prompt,
    status,
    ok,
    latencyMs,
    errText,
  }
}

async function main() {
  const fixture = JSON.parse(readFileSync(CASES_PATH, 'utf8'))
  const cases = (fixture.cases ?? []).filter((c) => (c.channel ?? 'web') === 'web')
  process.stderr.write(`[acceptance] ${cases.length} web cases from ${CASES_PATH}\n`)
  process.stderr.write(
    `[acceptance] BASE_URL=${BASE_URL}, mode=${PRESET_COOKIE ? 'preset-cookie' : 'dev-login'}\n`,
  )

  const cookie = await mintCookie()
  process.stderr.write(`[acceptance] session ready (cookie len ${cookie.length})\n`)

  const csrf = await harvestCsrf(cookie)
  process.stderr.write(
    `[acceptance] csrf: cookie=${csrf.csrfCookie ? 'ok' : 'none'} token=${csrf.csrfToken ? 'ok' : 'none'}\n`,
  )

  let okCount = 0
  for (const c of cases) {
    const r = await runCase(cookie, csrf, c)
    if (r.ok) okCount++
    log(r)
    process.stderr.write(`  ${r.ok ? '✓' : '✗'} ${r.caseId} http=${r.status} ${r.latencyMs}ms\n`)
  }
  process.stderr.write(`[acceptance] done: ${okCount}/${cases.length} ok\n`)
}

main().catch((e) => {
  process.stderr.write(`[acceptance] FATAL: ${e}\n`)
  process.exit(1)
})
