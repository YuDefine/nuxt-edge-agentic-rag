#!/usr/bin/env node
/**
 * REST-based rewriter acceptance（TD-060 第二輪 / change rag-query-rewriting 6.4-6.5）。
 *
 * 為什麼走 REST 而非 app endpoint：local `wrangler dev` 的 AI Search namespace
 * binding 回空（local proxy 限制），無法在本機重現 staging retrieval。但
 * AutoRAG REST API（`/autorag/rags/<index>/search`）與 Workers AI REST
 * (`/ai/run/<model>`) 都對 `agentic-rag` index + judge model 完全可用，且
 * retrieval_score 由 (query, index) 決定、rewriter 由 (prompt, model) 決定，
 * 與「用 binding 還是 REST」無關 —— 故 REST 量到的 baseline/rewritten
 * retrieval_score 等同 app pipeline 在 staging 的結果。
 *
 * 本 script 對每筆 fixture：
 *   1. baseline:  AutoRAG /search(original)  → top_score
 *   2. rewrite:   Workers AI run(judge model, 自家 rewriter prompt) → rewritten query
 *   3. rewritten: AutoRAG /search(rewritten) → top_score
 * 輸出 NDJSON + 統計（≥0.55 占比 baseline vs rewritten、改善、fallback rate）。
 *
 * 與 app pipeline 的已知差異（evidence note 須標註）：
 *   - app retrieval 帶 `filters`（access-level / doc-status）+ `score_threshold`；
 *     REST /search 是 raw retrieve（無 filter）。對 top semantic score 影響小
 *     （top match 通常是 public 採購文件），但 evidence 不等於 app endpoint。
 *   - rewriter model / prompt / temperature 與 app `rewriteForRetrieval` 一致
 *     （`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, json_schema, temperature 0）。
 *
 * 用法：
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *   node scripts/acceptance/rest-rewriter-acceptance.mjs > /tmp/rest-acceptance.ndjson
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN
const INDEX = process.env.AI_SEARCH_INDEX ?? 'agentic-rag'
const JUDGE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' // governance.models.agentJudge (workers-ai.ts:65)
const SCORE_TARGET = 0.55 // acceptance target: ≥0.55 占比 ≥50%
const CASES_PATH =
  process.env.CASES_PATH ?? resolve(repoRoot, 'test/fixtures/acceptance/seed/cases.json')

if (!ACCOUNT_ID || !API_TOKEN) {
  process.stderr.write('Missing env: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN\n')
  process.exit(2)
}

const CF_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`

// 自家 rewriter prompt（與 server/utils/knowledge-query-rewriter.ts 逐字一致）。
const REWRITER_SYSTEM_PROMPT =
  '你是知識索引的查詢重述器。把使用者問題改寫成「索引文件裡可能出現的題目句式」。' +
  '不要新增、不要假設、不要擴展同義詞。只做形式正規化。回傳 JSON：{"rewritten": "..."}。'
const REWRITER_USER_EXAMPLES = [
  '範例：',
  '- "PO 和 PR 差別" → {"rewritten": "PO 採購單與 PR 請購單的角色差異"}',
  '- "庫存不足怎麼辦" → {"rewritten": "庫存不足處理流程"}',
  '- "怎麼請假" → {"rewritten": "請假申請流程"}',
].join('\n')

function log(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

async function autoragSearch(query) {
  const res = await fetch(`${CF_BASE}/autorag/rags/${INDEX}/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) return { topScore: null, results: 0, err: `${res.status}` }
  const j = await res.json()
  const data = j.result?.data ?? []
  const topScore = data.length ? data[0].score : null
  return { topScore, results: data.length, err: null }
}

// 用 judge model 經 Workers AI REST 重現 app rewriteForRetrieval（同 prompt/model/schema）。
async function rewrite(normalizedQuery) {
  const userPrompt = [REWRITER_USER_EXAMPLES, '', `使用者問題：${normalizedQuery}`].join('\n')
  try {
    const res = await fetch(`${CF_BASE}/ai/run/${JUDGE_MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_completion_tokens: 256,
        temperature: 0,
        messages: [
          { role: 'system', content: REWRITER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            type: 'object',
            additionalProperties: false,
            required: ['rewritten'],
            properties: { rewritten: { type: 'string' } },
          },
        },
      }),
    })
    if (!res.ok) return { rewritten: normalizedQuery, status: 'fallback_error' }
    const j = await res.json()
    // Workers AI 可能回 { result: { response: {rewritten} | "json-string" } }
    const raw = j.result?.response
    let parsed = raw
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw)
      } catch {
        return { rewritten: normalizedQuery, status: 'fallback_parse' }
      }
    }
    const value = parsed?.rewritten
    if (typeof value !== 'string' || !value.trim()) {
      return { rewritten: normalizedQuery, status: 'fallback_parse' }
    }
    return { rewritten: value.trim(), status: 'success' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      rewritten: normalizedQuery,
      status: /timed?\s*out|abort/i.test(msg) ? 'fallback_timeout' : 'fallback_error',
    }
  }
}

async function main() {
  const fixture = JSON.parse(readFileSync(CASES_PATH, 'utf8'))
  const cases = (fixture.cases ?? []).filter((c) => (c.channel ?? 'web') === 'web')
  process.stderr.write(
    `[rest-acceptance] ${cases.length} web cases, index=${INDEX}, judge=${JUDGE_MODEL}\n`,
  )

  const rows = []
  for (const c of cases) {
    const baseStart = Date.now()
    const base = await autoragSearch(c.prompt)
    const baseMs = Date.now() - baseStart

    const rw = await rewrite(c.prompt)

    const rwStart = Date.now()
    const after = await autoragSearch(rw.rewritten)
    const rwMs = Date.now() - rwStart

    const row = {
      caseId: c.caseId,
      registryId: c.registryId,
      original: c.prompt,
      rewritten: rw.rewritten,
      rewriter_status: rw.status,
      baseline_score: base.topScore,
      rewritten_score: after.topScore,
      improvement:
        base.topScore != null && after.topScore != null
          ? Number((after.topScore - base.topScore).toFixed(4))
          : null,
      baseline_latency_ms: baseMs,
      rewritten_latency_ms: rwMs,
    }
    rows.push(row)
    log(row)
    process.stderr.write(
      `  ${c.caseId}: base=${base.topScore?.toFixed(3) ?? 'n/a'} → rw=${after.topScore?.toFixed(3) ?? 'n/a'} [${rw.status}]\n`,
    )
  }

  // 統計
  const valid = rows.filter((r) => r.baseline_score != null && r.rewritten_score != null)
  const baseHit = valid.filter((r) => r.baseline_score >= SCORE_TARGET).length
  const rwHit = valid.filter((r) => r.rewritten_score >= SCORE_TARGET).length
  const fallback = rows.filter((r) => r.rewriter_status !== 'success').length
  const avgBase = valid.reduce((s, r) => s + r.baseline_score, 0) / (valid.length || 1)
  const avgRw = valid.reduce((s, r) => s + r.rewritten_score, 0) / (valid.length || 1)
  const improved = valid.filter((r) => r.improvement > 0).length
  const degraded = valid.filter((r) => r.improvement < 0).length
  const latencies = rows.map((r) => r.rewritten_latency_ms).sort((a, b) => a - b)
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0

  const summary = {
    _summary: true,
    total: rows.length,
    valid: valid.length,
    baseline_ge_055_pct: Number(((baseHit / valid.length) * 100).toFixed(1)),
    rewritten_ge_055_pct: Number(((rwHit / valid.length) * 100).toFixed(1)),
    target_pct: 50,
    avg_baseline: Number(avgBase.toFixed(4)),
    avg_rewritten: Number(avgRw.toFixed(4)),
    improved_count: improved,
    degraded_count: degraded,
    rewriter_fallback_rate_pct: Number(((fallback / rows.length) * 100).toFixed(1)),
    rewritten_p95_latency_ms: p95,
  }
  log(summary)
  process.stderr.write(
    `\n[rest-acceptance] DONE\n` +
      `  baseline ≥0.55: ${summary.baseline_ge_055_pct}% | rewritten ≥0.55: ${summary.rewritten_ge_055_pct}% (target ≥50%)\n` +
      `  avg: ${summary.avg_baseline} → ${summary.avg_rewritten} | improved ${improved} / degraded ${degraded}\n` +
      `  rewriter fallback: ${summary.rewriter_fallback_rate_pct}% (target <10%) | rewritten p95: ${p95}ms\n`,
  )
}

main().catch((e) => {
  process.stderr.write(`[rest-acceptance] FATAL: ${e}\n`)
  process.exit(1)
})
