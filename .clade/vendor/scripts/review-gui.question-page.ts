// 🔒 LOCKED — managed by clade · Source: vendor/scripts/review-gui.question-page.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/review-gui.question-page.ts
/**
 * review-gui question page —— 把 impeccable 的 `serve-question` 決策頁嵌進 `/decisions` 的一題。
 *
 * ## 問題
 *
 * `/design` 的決策頁是一個獨立的本機 HTTP server（impeccable `scripts/serve-question.mjs`），
 * 目前由 agent 自己 `--start` 再另外架一條 tailnet proxy 把 URL 給人。那條路徑有兩個結構性
 * 缺陷，而它們在 2026-08-28 同一輪裡各發作了一次：
 *
 * 1. **生命週期對不上。** question server 有 idle-grace 與 timeout，而 `/decisions` 的使用情境
 *    是回到電腦或滑手機時才點開 —— 中間可能隔幾小時。agent 先開好等人，等到的多半是一個
 *    已經自己收掉的 port。同一天還有另一個版本：前景指令 timeout 把 process tree 收掉，
 *    連 server 一起殺，而使用者看到的只是「打不開」。
 * 2. **URL 是第二條通道。** 決策頁的網址活在對話裡，而待拍板事項的正規入口是 `/decisions`。
 *    同一個待決策點在兩個地方長得不一樣，人會以為那是兩件事 —— 這正是 `\my` 與 `/decisions`
 *    同源的那條決策要消除的東西。
 *
 * ## 做法
 *
 * span 記的是**怎麼重建這一頁**（payload 檔的 repo-relative 路徑），NEVER 記 port。
 * 點開那一秒才 spawn，拿到 port 後走既有的 preview proxy（`review-gui.preview-proxy.ts`）
 * 曝露給瀏覽器，然後 iframe 它。
 *
 * 記 port 會過期，而過期的 port 與活著的 port 在 span 裡長得一模一樣 —— 那是本檔存在的
 * 全部理由。**NEVER** 把 port 寫進 span payload，即使「開的當下就知道」。
 *
 * 答案不經過這裡：`serve-question` 把答案寫 `.impeccable/questions/<key>.answer.json`，
 * agent 的 `--wait` 讀那個檔。review-gui 只負責讓人看得到、點得到。
 *
 * ## 暴露面
 *
 * 這條會 spawn 本機程序，所以與 `validateDevServerSpawnRequest` 同一個等級的 gate：
 * script 路徑**固定由 repo root 推導**、不接受 request 指定；payload 路徑必須 resolve 進
 * `<repoRoot>/.impeccable/questions/`。少了任一條，這就是任意本機命令執行入口。
 *
 * 本檔只放純函式（存在性檢查由呼叫端注入），fixtures 可直測 —— 形狀同
 * `review-gui.dev-servers.ts`。
 */
import path from 'node:path'

/** payload 與答案檔的所在目錄，相對於 repo root。`serve-question` 自己也寫在這裡。 */
export const QUESTION_DIR = path.join('.impeccable', 'questions')

/**
 * `serve-question.mjs` 的解析順序，逐字對齊 clade `design/decision-page.md` § 路徑解析。
 *
 * 順序是契約不是偏好：consumer 用 copy mode 裝在 `.claude/skills/`，而 `.agents/` 與
 * `.cursor/` 是投影。先命中 copy 的那份，才不會在投影落後時跑到舊版腳本。
 */
export const IMPECCABLE_SKILL_DIRS = [
  path.join('.claude', 'skills', 'impeccable'),
  path.join('.agents', 'skills', 'impeccable'),
  path.join('.cursor', 'skills', 'impeccable'),
] as const

const SERVE_QUESTION_REL = path.join('scripts', 'serve-question.mjs')

/** span payload 裡的 `question_page`。**沒有 port 欄位**，理由見檔頭。 */
export interface QuestionPageRef {
  /** payload JSON 的 repo-relative 路徑，必須落在 {@link QUESTION_DIR} 底下。 */
  payload_path: string
  /** 給人看的一句話，說明這一頁在問什麼。`/decisions` 的卡片標題用它。 */
  label?: string | null
}

export interface QuestionPageSpawnRequest {
  /** 該題所在 repo 的絕對根目錄，由 roster 解析而來（NEVER 取自 request body）。 */
  repoRoot: string
  /** 取自 span payload 的 `question_page.payload_path`。 */
  payloadPath: string
}

export interface QuestionPageSpawnPlan {
  /** `serve-question.mjs` 的絕對路徑。 */
  scriptPath: string
  /** payload JSON 的絕對路徑。 */
  payloadAbs: string
  /** spawn 的 cwd，等於 repoRoot。 */
  cwd: string
}

/**
 * 讀出 span payload 的 `question_page`，形狀不對就回 null。
 *
 * fail closed：一個讀不出 payload_path 的 ref 會讓卡片畫出一個開不起來的按鈕，
 * 那比沒有按鈕更糟 —— 人會以為是自己網路的問題。
 */
export function readQuestionPageRef(payload: unknown): QuestionPageRef | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as Record<string, unknown>).question_page
  if (!raw || typeof raw !== 'object') return null
  const payloadPath = (raw as Record<string, unknown>).payload_path
  if (typeof payloadPath !== 'string' || !payloadPath.trim()) return null
  const label = (raw as Record<string, unknown>).label
  return {
    payload_path: payloadPath.trim(),
    label: typeof label === 'string' && label.trim() ? label.trim() : null,
  }
}

/**
 * 把 spawn 請求算成一個可執行的 plan，或回拒絕理由。
 *
 * `exists` 由呼叫端注入（`fs.existsSync`），讓本函式維持純函式可測 —— 形狀同
 * `review-gui.dev-servers.ts` 的其餘部分。
 *
 * 拒絕理由寫成給人讀的一句話而不是錯誤碼：它會原樣出現在 `/decisions` 的卡片上，
 * 而那裡沒有第二個地方可以查代碼的意思。
 */
export function planQuestionPageSpawn(
  req: QuestionPageSpawnRequest,
  exists: (absPath: string) => boolean,
): QuestionPageSpawnPlan | { error: string } {
  const repoRoot = path.resolve(req.repoRoot)

  // 路徑守衛。resolve 之後比對前綴，而不是對原字串檢查 `..` —— 後者擋不掉 symlink 與
  // 多重編碼，而這條的失敗模式是任意檔案被當成 payload 餵給一個會 spawn 的端點。
  const questionDir = path.join(repoRoot, QUESTION_DIR)
  const payloadAbs = path.resolve(repoRoot, req.payloadPath)
  const withinQuestionDir =
    payloadAbs.startsWith(questionDir + path.sep) && path.extname(payloadAbs) === '.json'
  if (!withinQuestionDir) {
    return {
      error: `payload 必須是 ${QUESTION_DIR}/ 底下的 .json —— 收到 ${req.payloadPath}，拒絕啟動`,
    }
  }
  if (!exists(payloadAbs)) {
    return { error: `找不到 payload：${req.payloadPath}（決策頁的內容就是它，沒有它開不出來）` }
  }

  // script 路徑固定由 repo root 推導，NEVER 由 request 指定 —— 那等於讓呼叫端挑要跑哪支程式。
  const scriptPath = resolveServeQuestionScript(repoRoot, exists)
  if (!scriptPath) {
    return {
      error:
        '這個 repo 沒有安裝 impeccable（找不到 serve-question.mjs）—— ' +
        `依序找過 ${IMPECCABLE_SKILL_DIRS.join('、')}`,
    }
  }

  return { scriptPath, payloadAbs, cwd: repoRoot }
}

/** 依 {@link IMPECCABLE_SKILL_DIRS} 的順序找 `serve-question.mjs`，都沒有就回 null。 */
export function resolveServeQuestionScript(
  repoRoot: string,
  exists: (absPath: string) => boolean,
): string | null {
  for (const dir of IMPECCABLE_SKILL_DIRS) {
    const candidate = path.join(path.resolve(repoRoot), dir, SERVE_QUESTION_REL)
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * 從 `serve-question --start` 的 stdout 撈 port 與 key。
 *
 * 它印的是 `QUESTION URL: http://127.0.0.1:<port>/` 與 `QUESTION KEY: <key>`。
 * 解析 stdout 而不是要它寫檔：那是第三方 skill 的腳本，clade 規約明寫 NEVER 改它 ——
 * 整合只能做在我們這一側。
 */
export function parseQuestionServerStart(
  stdout: string,
): { port: number; key: string } | { error: string } {
  const portMatch = stdout.match(/QUESTION URL:\s*https?:\/\/[^:]+:(\d+)/)
  const keyMatch = stdout.match(/QUESTION KEY:\s*(\S+)/)
  if (!portMatch || !keyMatch) {
    // headless 偵測是最常見的一種，訊息裡直接講怎麼解，否則畫面上只會是一句「啟動失敗」。
    const headless = /no browser detected/i.test(stdout)
    return {
      error: headless
        ? 'serve-question 判定這台機器沒有瀏覽器而拒絕啟動；review-gui 這條路徑本來就是要嵌進頁面，需要 IMPECCABLE_QUESTION_FORCE=1'
        : `讀不出 serve-question 的 port／key：${stdout.trim().slice(0, 200) || '(沒有輸出)'}`,
    }
  }
  return { port: Number(portMatch[1]), key: keyMatch[1]! }
}

/** 一台已經起來的 question server。快取用，NEVER 進 span。 */
export interface LiveQuestionServer {
  port: number
  key: string
  payloadAbs: string
}

/**
 * 同一份 payload 已經有一台活著的 server 就重用它，否則回 null（呼叫端去 spawn）。
 *
 * 沒有這一層的話，卡片被點兩次就是兩台 server 對著同一份 payload —— 而人在第二台上作答，
 * 答案寫進第二把 key 的 answer 檔，發問的 agent 正 `--wait` 第一把。兩邊都沒有錯誤訊息，
 * 只有一個永遠等不到答案的 agent 和一個以為自己答完了的人。
 *
 * `isAlive` 由呼叫端注入（TCP probe）：process 可能已被 idle-grace 收掉，而快取不會知道。
 */
export function reuseLiveQuestionServer(
  cache: Iterable<LiveQuestionServer>,
  payloadAbs: string,
  isAlive: (port: number) => boolean,
): LiveQuestionServer | null {
  for (const entry of cache) {
    if (entry.payloadAbs !== payloadAbs) continue
    if (isAlive(entry.port)) return entry
    return null
  }
  return null
}

/** 答案檔的絕對路徑。`serve-question` 落在這裡，agent 的 `--wait` 也讀這裡。 */
export function answerFilePath(repoRoot: string, key: string): string {
  return path.join(path.resolve(repoRoot), QUESTION_DIR, `${key}.answer.json`)
}
