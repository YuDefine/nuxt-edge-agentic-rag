/**
 * T3 evlog adoption (adopt-evlog-nuxthub-ai-t3) — cost-based forceKeep.
 *
 * `nuxt.config.evlog.sampling.keep[]` only accepts declarative
 * `{ status, duration, path }` matchers — no callbacks. AI cost-based
 * filtering therefore goes through the `evlog:emit:keep` Nitro hook,
 * which lets us inspect the wide event right before sampling decides
 * keep / drop.
 *
 * Threshold: $0.001 — Workers AI free-tier calls (cost = 0) drop into
 * the regular `info: 50` sampling rate; once we move to paid Anthropic
 * generations the per-call cost easily exceeds threshold and gets
 * force-kept regardless of the sampler.
 *
 * Audit events (`auditOnly` / `signed` chain in evlog 2.16+) are
 * force-kept by evlog itself — we do NOT duplicate that here.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:emit:keep', (ctx) => {
    const aiCost = (ctx.context as { ai?: { cost_usd?: number } }).ai?.cost_usd
    if (aiCost && aiCost > 0.001) {
      ctx.shouldKeep = true
    }
  })
})
