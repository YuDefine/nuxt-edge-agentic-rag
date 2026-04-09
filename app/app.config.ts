export default defineAppConfig({
  ui: {
    colors: {
      neutral: 'neutral',
    },

    avatar: {
      slots: {
        // WCAG AA fix: default fallback text-muted on bg-elevated = ~3.5:1 (fails 4.5:1).
        // Override to text-highlighted (near-default foreground) for sufficient contrast.
        fallback: 'text-highlighted font-medium leading-none truncate',
      },
    },

    select: {
      slots: {
        content: 'min-w-fit',
      },
    },
    selectMenu: {
      slots: {
        content: 'min-w-fit',
      },
    },

    /*
     * TD-006 WCAG AA fix for tonal variants (`subtle` / `soft`).
     *
     * Nuxt UI default pairs `bg-{color}/10` with `text-{color}` (500-shade),
     * yielding poor contrast on light backgrounds:
     *   - warning: #f0b100 on #fef7e5  ≈ 1.78:1   (fails 4.5:1)
     *   - error:   #fb2c36 on #ffeaeb  ≈ 3.30:1
     *   - success: #00c950 on #e5faee  ≈ 2.03:1
     *
     * Adjusting the global `--ui-{color}` token is not viable — bg and text
     * share the same token, so darkening both preserves the ratio
     * (nuxt/ui issue #1284). Instead, per-component `compoundVariants`
     * override the text shade to `-700` (light) / `-200` (dark), matching
     * the official recommendation.
     *
     * `neutral` is untouched: Nuxt UI already maps its subtle/soft classes
     * to `text-default` / `text-highlighted` (not `text-{color}`), so it
     * passes AA by default.
     */
    badge: {
      compoundVariants: [
        // subtle: overrides base `bg-{color}/10 text-{color} ring ring-{color}/25`
        { color: 'primary', variant: 'subtle', class: 'text-primary-700 dark:text-primary-200' },
        { color: 'info', variant: 'subtle', class: 'text-info-700 dark:text-info-200' },
        { color: 'success', variant: 'subtle', class: 'text-success-700 dark:text-success-200' },
        { color: 'warning', variant: 'subtle', class: 'text-warning-700 dark:text-warning-200' },
        { color: 'error', variant: 'subtle', class: 'text-error-700 dark:text-error-200' },
        // soft: overrides base `bg-{color}/10 text-{color}`
        { color: 'primary', variant: 'soft', class: 'text-primary-700 dark:text-primary-200' },
        { color: 'info', variant: 'soft', class: 'text-info-700 dark:text-info-200' },
        { color: 'success', variant: 'soft', class: 'text-success-700 dark:text-success-200' },
        { color: 'warning', variant: 'soft', class: 'text-warning-700 dark:text-warning-200' },
        { color: 'error', variant: 'soft', class: 'text-error-700 dark:text-error-200' },
      ],
    },
    alert: {
      compoundVariants: [
        {
          color: 'primary',
          variant: 'subtle',
          class: { root: 'text-primary-700 dark:text-primary-200' },
        },
        {
          color: 'info',
          variant: 'subtle',
          class: { root: 'text-info-700 dark:text-info-200' },
        },
        {
          color: 'success',
          variant: 'subtle',
          class: { root: 'text-success-700 dark:text-success-200' },
        },
        {
          color: 'warning',
          variant: 'subtle',
          class: { root: 'text-warning-700 dark:text-warning-200' },
        },
        {
          color: 'error',
          variant: 'subtle',
          class: { root: 'text-error-700 dark:text-error-200' },
        },
        {
          color: 'primary',
          variant: 'soft',
          class: { root: 'text-primary-700 dark:text-primary-200' },
        },
        {
          color: 'info',
          variant: 'soft',
          class: { root: 'text-info-700 dark:text-info-200' },
        },
        {
          color: 'success',
          variant: 'soft',
          class: { root: 'text-success-700 dark:text-success-200' },
        },
        {
          color: 'warning',
          variant: 'soft',
          class: { root: 'text-warning-700 dark:text-warning-200' },
        },
        {
          color: 'error',
          variant: 'soft',
          class: { root: 'text-error-700 dark:text-error-200' },
        },
      ],
    },
    button: {
      compoundVariants: [
        { color: 'primary', variant: 'subtle', class: 'text-primary-700 dark:text-primary-200' },
        { color: 'info', variant: 'subtle', class: 'text-info-700 dark:text-info-200' },
        { color: 'success', variant: 'subtle', class: 'text-success-700 dark:text-success-200' },
        { color: 'warning', variant: 'subtle', class: 'text-warning-700 dark:text-warning-200' },
        { color: 'error', variant: 'subtle', class: 'text-error-700 dark:text-error-200' },
        { color: 'primary', variant: 'soft', class: 'text-primary-700 dark:text-primary-200' },
        { color: 'info', variant: 'soft', class: 'text-info-700 dark:text-info-200' },
        { color: 'success', variant: 'soft', class: 'text-success-700 dark:text-success-200' },
        { color: 'warning', variant: 'soft', class: 'text-warning-700 dark:text-warning-200' },
        { color: 'error', variant: 'soft', class: 'text-error-700 dark:text-error-200' },
      ],
    },
  },
})
