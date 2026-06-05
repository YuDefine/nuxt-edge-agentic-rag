import { h } from 'vue'

/**
 * Returns a `header` render function that produces a visually-hidden
 * `<span class="sr-only">` with the given label. Use for table columns
 * whose visual header is intentionally blank (actions, mobile detail
 * triggers, etc.) so screen readers still announce the column.
 *
 * Fixes axe-core `empty-table-header` rule violations while keeping the
 * visual design unchanged. See TD-005 in `docs/tech-debt.md`.
 *
 * @example
 * ```ts
 * const columns: TableColumn<Row>[] = [
 *   { accessorKey: 'name', header: '名稱' },
 *   { id: 'actions', header: srOnlyHeader('操作') },
 * ]
 * ```
 */
export function srOnlyHeader(label: string) {
  return () => h('span', { class: 'sr-only' }, label)
}
