/**
 * 設定檔原文的「行為 view」。
 *
 * 註解為了解釋實作會逐字引用實作。對含註解的原文做字面斷言時，「實作存在」與「有人寫過
 * 關於實作的說明」在斷言眼中是同一件事 —— 把實作刪掉，斷言仍被註解滿足，測試恆綠。
 * 反向的 `not.toContain` 則是註解命中造成誤報。
 *
 * 行為斷言一律綁 `behaviourView(...)` 的結果，不要直接綁 `readFileSync` 的原文。
 *
 * 見 clade `rules/core/testing-anti-patterns.md` §「對設定檔原文的斷言，標的是行為本身」
 * 與本 repo `docs/tech-debt.md` TD-071。
 */
const LINE_COMMENT = /^\s*(#|\/\/)/

/** 濾掉整行註解（YAML `#`、JSONC `//`）。行號不保留，僅供字面比對用。 */
export function behaviourView(source: string): string {
  return source
    .split('\n')
    .filter((line) => !LINE_COMMENT.test(line))
    .join('\n')
}
