/**
 * Exhaustiveness check utility for switch statements on discriminated unions.
 * Shared across app and server contexts.
 */
export function assertNever(value: never, context?: string): never {
  const message = context
    ? `Unhandled value in ${context}: ${JSON.stringify(value)}`
    : `Unhandled value: ${JSON.stringify(value)}`
  throw new Error(message)
}
