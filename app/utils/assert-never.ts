/**
 * Exhaustiveness check utility for switch statements on discriminated unions.
 *
 * Use in the `default` case of a switch statement to ensure all variants are handled.
 * If a new variant is added to the union, TypeScript will report a compile-time error.
 *
 * @example
 * ```ts
 * type Status = 'active' | 'inactive'
 *
 * function getLabel(status: Status): string {
 *   switch (status) {
 *     case 'active':
 *       return 'Active'
 *     case 'inactive':
 *       return 'Inactive'
 *     default:
 *       return assertNever(status, 'getLabel')
 *   }
 * }
 * ```
 */
export function assertNever(value: never, context?: string): never {
  const message = context
    ? `Unhandled value in ${context}: ${JSON.stringify(value)}`
    : `Unhandled value: ${JSON.stringify(value)}`
  throw new Error(message)
}
