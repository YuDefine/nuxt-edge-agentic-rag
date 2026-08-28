// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/inline-options.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/inline-options.ts
/**
 * 「選項被寫進問句本文裡」的偵測器。
 *
 * 拍板題在手機上長成按鈕還是一個空白輸入框，取決於 `payload.options` 有沒有東西——問句本文
 * 寫成 `…要留哪一個？(A) 留 X (B) 停 Y` 而 options 是空陣列時，`/decisions` 只畫得出自由
 * 填答，答的人得自己把 A/B 打回去，而落檔紀錄裡也對不回是哪一個字母。
 *
 * 兩條寫入路徑共用這一份，**NEVER** 各自再寫一個：`flow ask` 與 herdr `--complete blocked`
 * 的 `--decision` 是同一個佇列的兩個入口，兩份 matcher 遲早會對同一句話給出不同答案，而分歧
 * 的那一邊就是靜默退化成自由填答的那一邊。檔案來源那條路徑的判定在 `decision-sources.ts`，
 * 它解析的是 markdown bullet 結構、不是句內文字，兩者不重疊。
 */

/** `(A)` / `（Ａ）` 形。 */
const PARENTHESISED = /[(（]\s*([A-Da-d])\s*[)）]/gu
/**
 * `A. ` / `A、` 形。前面不能貼著字母或數字（否則 `v1.11.91` 這種版本號會命中）；點號形 MUST
 * 有空白再接字，`config.a.b` 這種點分名稱因此不算。頓號形不要求空白——中文本來就不打。
 */
const DOTTED = /(?:^|[^A-Za-z0-9])([A-Da-d])(?:[.．]\s+|、\s*)(?=\S)/gu

/**
 * 問句本文裡「從 A 起連續」的選項字母，找不到就回空陣列。
 *
 * 從 A 起連續是刻意的，判準與 [[decision-authoring]] 對檔案來源的一致：字母不連續的一組
 * 整組丟棄，因為兩條未知 N 的選項是沒人被問過的選擇題。散文裡偶然出現一個 `(B)` 因此不會
 * 命中——要兩個以上、且第一個是 A。
 */
export function inlineOptionLetters(question: string): string[] {
  for (const pattern of [PARENTHESISED, DOTTED]) {
    let run = 0
    for (const match of question.matchAll(pattern)) {
      if (match[1].toUpperCase() === String.fromCodePoint(65 + run)) run += 1
    }
    if (run >= 2) return Array.from({ length: run }, (_, i) => String.fromCodePoint(65 + i))
  }
  return []
}

/** 拒絕訊息的共用本文。`how` 是該入口真正要打的旗標寫法。 */
export function inlineOptionsRefusal(letters: string[], how: string): string {
  return (
    `question carries inline options (${letters.join('/')}) but none were passed as options: ` +
    `/decisions would render it as a blank text box. Pass them separately — ${how}`
  )
}
