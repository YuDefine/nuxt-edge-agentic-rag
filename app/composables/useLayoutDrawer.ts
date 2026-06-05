import { assertNever } from '#shared/utils/assert-never'

/**
 * responsive-and-a11y-foundation §3.4 — shared drawer open-state composable.
 *
 * Two layout drawers are wired through this composable in Phase B:
 *
 *  - `'main'`: primary navigation drawer (default layout + chat layout
 *    header hamburger).
 *  - `'chat-history'`: chat conversation-history drawer (only rendered
 *    on `< md` by `/pages/index.vue` signed-in branch).
 *
 * `useState` keys every drawer separately so multiple drawers can coexist
 * without collision, and so SSR / client hydration see a stable false
 * initial value. State is shared across components in the same layout
 * tree — e.g. the header hamburger and the `USlideover` both read / write
 * the same `isOpen` ref.
 *
 * Adding a new drawer value requires extending `DrawerKey` here; the
 * `switch + assertNever` in `stateKey` below enforces the update at
 * compile time.
 */
export const DRAWER_KEYS = ['main', 'chat-history'] as const

export type DrawerKey = (typeof DRAWER_KEYS)[number]

export interface LayoutDrawer {
  isOpen: Ref<boolean>
  open: () => void
  close: () => void
  toggle: () => void
}

function createDrawer(isOpen: Ref<boolean>): LayoutDrawer {
  function open() {
    isOpen.value = true
  }
  function close() {
    isOpen.value = false
  }
  function toggle() {
    isOpen.value = !isOpen.value
  }
  return { isOpen, open, close, toggle }
}

export function useLayoutDrawer(key: DrawerKey = 'main'): LayoutDrawer {
  switch (key) {
    case 'main':
      return createDrawer(useState<boolean>('layout-drawer:main', () => false))
    case 'chat-history':
      return createDrawer(useState<boolean>('layout-drawer:chat-history', () => false))
    default:
      return assertNever(key, 'useLayoutDrawer')
  }
}
