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
  },
})
