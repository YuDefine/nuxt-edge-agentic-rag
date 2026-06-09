/**
 * Prod chat traffic seeder — 在瀏覽器 console 執行
 *
 * 使用方式：
 * 1. 用 charles@yudefine.com.tw 登入 https://agentic.yudefine.com.tw
 * 2. 打開 DevTools Console (F12)
 * 3. 貼上這段 script 並 Enter 執行
 *
 * 每個請求都走完整 RAG pipeline (retrieval → judge → answer)，
 * 同時產生：
 * - Cloudflare AI Gateway analytics (→ /admin/usage 頁面)
 * - D1 conversations + messages + query_logs (→ chat history)
 */

;(async () => {
  const QUERIES = [
    // ─── 命中類：企業知識庫常見主題 ───
    { q: '請問特休假有幾天？', expect: 'hit' },
    { q: '病假超過三天需要什麼證明？', expect: 'hit' },
    { q: '婚假可以請幾天？需要什麼文件？', expect: 'hit' },
    { q: '員工請假的核准流程是什麼？', expect: 'hit' },
    { q: '產假天數和薪資規定是什麼？', expect: 'hit' },
    { q: '國內出差每日津貼上限多少？', expect: 'hit' },
    { q: '出差可以報銷哪些費用？', expect: 'hit' },
    { q: '差旅報銷需要附什麼單據？', expect: 'hit' },
    { q: '採購金額超過五萬需要怎麼處理？', expect: 'hit' },
    { q: '緊急採購的流程是什麼？', expect: 'hit' },
    { q: '新人入職第一天需要做什麼？', expect: 'hit' },
    { q: '公司發的筆電是什麼規格？', expect: 'hit' },
    { q: '門禁卡要在什麼時間前註冊？', expect: 'hit' },
    { q: '服務採購包含哪些類型？', expect: 'hit' },
    { q: '陪產假可以請幾天？', expect: 'hit' },

    // ─── 命中類：延伸問法 / 複合問題 ───
    { q: '請假流程中，誰負責最終審核？部門主管還是人資？', expect: 'hit' },
    { q: '如果出差去日本，每日津貼是多少？歐美呢？', expect: 'hit' },
    { q: '新人入職第一週要完成哪些事？包含帳號設定嗎？', expect: 'hit' },
    { q: '採購單要包含哪些資訊？有沒有金額門檻？', expect: 'hit' },
    { q: '差旅機票只能訂經濟艙嗎？有沒有例外？', expect: 'hit' },

    // ─── 未命中類：完全無關主題 ───
    { q: '台灣最高峰是哪座山？海拔多少？', expect: 'miss' },
    { q: '如何用 Python 寫一個 web scraper？', expect: 'miss' },
    { q: '量子電腦的運作原理是什麼？', expect: 'miss' },
    { q: '特斯拉 Model 3 的電池容量是多少？', expect: 'miss' },
    { q: '日本東京的平均氣溫是幾度？', expect: 'miss' },
    { q: '什麼是區塊鏈？比特幣和以太坊的差別？', expect: 'miss' },
    { q: 'NBA 歷史上最偉大的球員是誰？', expect: 'miss' },
    { q: '如何在家裡種香草植物？需要什麼土壤？', expect: 'miss' },
    { q: '火星上有水嗎？NASA 最新的發現是什麼？', expect: 'miss' },
    { q: '黑洞是如何形成的？', expect: 'miss' },

    // ─── 未命中類：技術問題 ───
    { q: 'Vue 3 Composition API 和 Options API 有什麼差異？', expect: 'miss' },
    { q: 'Docker container 和 VM 的差異是什麼？', expect: 'miss' },
    { q: 'TypeScript 的 generic 怎麼用？', expect: 'miss' },
    { q: '什麼是 GraphQL？跟 REST API 有什麼不同？', expect: 'miss' },
    { q: 'Kubernetes 的 Pod 生命週期是怎樣的？', expect: 'miss' },

    // ─── 邊界測試 ───
    { q: '請假', expect: 'hit' },
    { q: '?', expect: 'miss' },
    { q: '可以幫我整理一下公司所有的規章制度嗎？包括請假、出差、採購各方面', expect: 'hit' },
    { q: 'What is the leave policy?', expect: 'hit' },
    { q: '我下週一想請特休假，流程上需要提前幾天申請？有沒有相關規定？', expect: 'hit' },
  ]

  function shuffleArray(arr) {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  function randomDelay(min, max) {
    return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)))
  }

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]')
    if (meta) return meta.getAttribute('content')
    const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/)
    return match ? decodeURIComponent(match[1]) : null
  }

  const csrf = getCsrfToken()
  if (!csrf) {
    console.error('❌ 找不到 CSRF token。請確認已登入。')
    return
  }

  const shuffled = shuffleArray(QUERIES)
  const total = shuffled.length
  let success = 0
  let failed = 0
  let refused = 0

  console.log(`🚀 開始送出 ${total} 個 chat 請求...`)
  console.log(`   CSRF token: ${csrf.slice(0, 8)}...`)
  console.log('')

  for (let i = 0; i < shuffled.length; i++) {
    const { q, expect: exp } = shuffled[i]
    const label = `[${i + 1}/${total}] (${exp})`

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'csrf-token': csrf,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ query: q }),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        console.warn(`${label} ⚠️ ${res.status} — ${q.slice(0, 30)}...`, text.slice(0, 100))
        failed++
      } else {
        const contentType = res.headers.get('content-type') || ''

        if (contentType.includes('text/event-stream')) {
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let answer = ''
          let done = false

          while (!done) {
            const { value, done: streamDone } = await reader.read()
            done = streamDone
            if (value) {
              const chunk = decoder.decode(value, { stream: !done })
              const lines = chunk.split('\n')
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const evt = JSON.parse(line.slice(6))
                    if (evt.event === 'delta') answer += evt.data.content
                    if (evt.event === 'complete') answer = evt.data.answer
                    if (evt.event === 'refusal') {
                      refused++
                      answer = `[REFUSED: ${evt.data.reason}]`
                    }
                  } catch {}
                }
              }
            }
          }

          const preview = answer.slice(0, 60).replace(/\n/g, ' ')
          console.log(`${label} ✅ SSE — ${q.slice(0, 25)}... → ${preview}...`)
          success++
        } else {
          const data = await res.json()
          if (data.data?.refused) {
            refused++
            console.log(`${label} 🚫 拒答 — ${q.slice(0, 30)}...`)
          } else {
            const preview = (data.data?.answer || '').slice(0, 60).replace(/\n/g, ' ')
            console.log(`${label} ✅ — ${q.slice(0, 25)}... → ${preview}...`)
          }
          success++
        }
      }
    } catch (err) {
      console.error(`${label} ❌ 錯誤 — ${q.slice(0, 30)}...`, err.message)
      failed++
    }

    const delay = 2000 + Math.random() * 5000
    if (i < shuffled.length - 1) {
      await randomDelay(delay, delay + 2000)
    }
  }

  console.log('')
  console.log('═══════════════════════════════')
  console.log(`✅ 完成：${success} 成功 / ${failed} 失敗 / ${refused} 拒答`)
  console.log(`📊 Usage 頁面：${location.origin}/admin/usage`)
  console.log(`💬 Chat 歷史：${location.origin}/chat`)
  console.log('═══════════════════════════════')
})()
