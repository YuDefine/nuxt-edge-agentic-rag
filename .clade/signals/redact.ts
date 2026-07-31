// clade improvement-loop redaction validator
//
// Enforces "redaction is non-bypassable":
//   - Every signal record MUST have redaction_applied === true (also checked by JSON Schema).
//   - No field value MAY match any pattern in SECRET_PATTERNS.
//   - There is no opt-out flag at the record, writer, or environment level.
//
// The validator pair is:
//   redactPayload(input) -> { payload, redaction_applied: true, leak_diagnostics: [] }
//     -> rewrites known leak patterns to symbolic tokens. Always returns redaction_applied:true.
//   validateRecord(record) -> { ok, errors }
//     -> rejects any record whose persisted field values still match a secret pattern,
//        and rejects records where redaction_applied !== true.
//
// Writers MUST pipe through redactPayload BEFORE persisting, then validateRecord MUST pass.
// The single-writer Node ledger process (see bin/clade-gate ledger) enforces this contract.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const SECRET_PATTERNS = [
  {
    id: 'github-pat',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    token: '<REDACTED:github-pat>',
  },
  {
    id: 'anthropic-key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    token: '<REDACTED:anthropic-key>',
  },
  {
    id: 'openai-key',
    pattern: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    token: '<REDACTED:openai-key>',
  },
  {
    id: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    token: '<REDACTED:aws-access-key>',
  },
  {
    id: 'aws-secret',
    pattern: /\baws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi,
    token: 'aws_secret_access_key=<REDACTED:aws-secret>',
  },
  {
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    token: '<REDACTED:jwt>',
  },
  {
    id: 'postgres-dsn',
    pattern: /\bpostgres(?:ql)?:\/\/[^\s'"]+/g,
    token: '<REDACTED:postgres-dsn>',
  },
  {
    id: 'mysql-dsn',
    pattern: /\bmysql:\/\/[^\s'"]+/g,
    token: '<REDACTED:mysql-dsn>',
  },
  {
    id: 'mongodb-dsn',
    pattern: /\bmongodb(?:\+srv)?:\/\/[^\s'"]+/g,
    token: '<REDACTED:mongodb-dsn>',
  },
  {
    id: 'redis-dsn',
    pattern: /\bredis(?:s)?:\/\/[^\s'"]+/g,
    token: '<REDACTED:redis-dsn>',
  },
  {
    id: 'http-auth-cookie',
    pattern: /\b(?:Cookie|Set-Cookie|Authorization):\s*[^\s]+/gi,
    token: '<REDACTED:http-auth-cookie>',
  },
  {
    id: 'bearer-token',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
    token: 'Bearer <REDACTED:bearer-token>',
  },
  {
    id: 'home-path',
    pattern: /\/(?:Users|home)\/[^/\s"']+/g,
    token: '<HOME>',
  },
  {
    id: 'internal-host',
    pattern:
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    token: '<REDACTED:internal-host>',
  },
  {
    id: 'internal-domain',
    pattern: /\b[A-Za-z0-9-]+\.(?:internal|local|lan|corp|intra)\b/g,
    token: '<REDACTED:internal-domain>',
  },
]

export function redactString(input) {
  if (typeof input !== 'string') return input
  let out = input
  for (const { pattern, token } of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    out = out.replace(pattern, token)
  }
  return out
}

export function redactPayload<T extends Record<string, unknown>>(
  record: T,
): Omit<T, 'redaction_applied'> & { redaction_applied: true } {
  if (record === null || typeof record !== 'object') {
    throw new TypeError('redactPayload expects an object')
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    out[key] = typeof value === 'string' ? redactString(value) : value
  }
  out.redaction_applied = true
  return out as Omit<T, 'redaction_applied'> & { redaction_applied: true }
}

export function findLeaks(record) {
  const leaks = []
  for (const [field, value] of Object.entries(record)) {
    if (typeof value !== 'string') continue
    for (const { id, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0
      if (pattern.test(value)) {
        leaks.push({ field, pattern_id: id })
      }
    }
  }
  return leaks
}

let cachedSchema = null
let cachedValidator = null

function loadSchema() {
  if (cachedSchema) return cachedSchema
  const schemaPath = join(__dirname, 'schema.json')
  cachedSchema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  return cachedSchema
}

function compileStructuralValidator() {
  if (cachedValidator) return cachedValidator
  const schema = loadSchema()
  const required = schema.required ?? []
  const props = schema.properties ?? {}
  cachedValidator = (record) => {
    const errors = []
    if (record === null || typeof record !== 'object') {
      errors.push({ code: 'not-object', message: 'record must be an object' })
      return errors
    }
    for (const key of required) {
      if (!(key in record)) {
        errors.push({ code: 'missing-required', field: key })
      }
    }
    for (const [key, value] of Object.entries(record)) {
      const def = props[key]
      if (!def) {
        errors.push({ code: 'additional-property', field: key })
        continue
      }
      if (def.const !== undefined && value !== def.const) {
        errors.push({ code: 'const-mismatch', field: key, expected: def.const, got: value })
      }
      if (def.enum && !def.enum.includes(value)) {
        errors.push({ code: 'enum-mismatch', field: key, allowed: def.enum, got: value })
      }
      if (def.pattern && typeof value === 'string') {
        const re = new RegExp(def.pattern)
        if (!re.test(value)) errors.push({ code: 'pattern-mismatch', field: key })
      }
      if (
        def.minLength !== undefined &&
        typeof value === 'string' &&
        value.length < def.minLength
      ) {
        errors.push({ code: 'minlength', field: key, min: def.minLength })
      }
      if (def.type === 'boolean' && typeof value !== 'boolean') {
        errors.push({ code: 'type-mismatch', field: key, expected: 'boolean' })
      }
      if (def.type === 'string' && typeof value !== 'string') {
        errors.push({ code: 'type-mismatch', field: key, expected: 'string' })
      }
    }
    return errors
  }
  return cachedValidator
}

export function validateRecord(record) {
  const errors = []
  const structural = compileStructuralValidator()(record)
  errors.push(...structural)

  if (record && typeof record === 'object') {
    if (record.redaction_applied !== true) {
      errors.push({
        code: 'redaction-not-applied',
        message: 'redaction_applied must be true; no opt-out is permitted',
      })
    }
    const leaks = findLeaks(record)
    if (leaks.length > 0) {
      errors.push({ code: 'redaction-leak', leaks })
    }
  }

  return { ok: errors.length === 0, errors }
}
