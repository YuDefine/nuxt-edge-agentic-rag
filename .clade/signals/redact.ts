// 🔒 LOCKED — managed by clade · Source: vendor/signals/redact.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/signals/redact.ts
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
import { isRecord, parseJsonWith } from '../scripts/lib/json-unknown.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
interface SecretPattern {
  id: string
  pattern: RegExp
  token: string
}
interface SchemaProperty {
  const?: unknown
  enum?: readonly unknown[]
  pattern?: string
  minLength?: number
  type?: string | string[]
}
interface SchemaDefinition {
  required?: string[]
  properties?: Record<string, SchemaProperty>
  enum?: readonly unknown[]
}
interface SchemaDocument extends SchemaDefinition {
  $defs?: Record<string, SchemaDefinition>
}
interface LeakDiagnostic {
  field: string
  pattern_id: string
}
interface ValidationError {
  code: string
  [key: string]: unknown
}
interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export const SECRET_PATTERNS: SecretPattern[] = [
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

export function redactString(input: string): string {
  if (typeof input !== 'string') return input
  let out = input
  for (const { pattern, token } of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    out = out.replace(pattern, token)
  }
  return out
}

// Redaction recurses into nested objects and arrays. Signal records are flat, so this is a
// no-op for them; flow envelopes carry a free-form `payload` object, and a top-level-only
// sweep would let a secret ride inside it untouched.
function redactDeep(value: unknown): JsonValue | unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v)
    return out
  }
  return value
}

export function redactPayload<T extends Record<string, unknown>>(
  record: T,
): Omit<T, 'redaction_applied'> & { redaction_applied: true } {
  if (record === null || typeof record !== 'object') {
    throw new TypeError('redactPayload expects an object')
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    out[key] = redactDeep(value)
  }
  out.redaction_applied = true
  return out as Omit<T, 'redaction_applied'> & { redaction_applied: true }
}

export function findLeaks(record: unknown): LeakDiagnostic[] {
  const leaks: LeakDiagnostic[] = []
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      for (const { id, pattern } of SECRET_PATTERNS) {
        pattern.lastIndex = 0
        if (pattern.test(value)) leaks.push({ field: path, pattern_id: id })
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`))
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k)
    }
  }
  if (!isObject(record)) return leaks
  for (const [field, value] of Object.entries(record)) walk(value, field)
  return leaks
}

let cachedSchema: SchemaDocument | null = null
const cachedValidators = new Map<string, (record: unknown) => ValidationError[]>()

function isSchemaProperty(value: unknown): value is SchemaProperty {
  if (!isRecord(value)) return false
  if (value.pattern !== undefined) {
    if (typeof value.pattern !== 'string') return false
    try {
      RegExp(value.pattern)
    } catch {
      return false
    }
  }
  return (
    (value.enum === undefined || Array.isArray(value.enum)) &&
    (value.minLength === undefined ||
      (typeof value.minLength === 'number' &&
        Number.isSafeInteger(value.minLength) &&
        value.minLength >= 0)) &&
    (value.type === undefined ||
      typeof value.type === 'string' ||
      (Array.isArray(value.type) && value.type.every((item: unknown) => typeof item === 'string')))
  )
}

function isSchemaDefinition(value: unknown): value is SchemaDefinition {
  return (
    isRecord(value) &&
    (value.required === undefined ||
      (Array.isArray(value.required) &&
        value.required.every((item: unknown) => typeof item === 'string'))) &&
    (value.enum === undefined || Array.isArray(value.enum)) &&
    (value.properties === undefined ||
      (isRecord(value.properties) && Object.values(value.properties).every(isSchemaProperty)))
  )
}

function isSchemaDocument(value: unknown): value is SchemaDocument {
  return (
    isRecord(value) &&
    isSchemaDefinition(value) &&
    (value.$defs === undefined ||
      (isRecord(value.$defs) && Object.values(value.$defs).every(isSchemaDefinition)))
  )
}

function loadSchema(): SchemaDocument {
  if (cachedSchema) return cachedSchema
  const schemaPath = join(__dirname, 'schema.json')
  cachedSchema = parseJsonWith(
    readFileSync(schemaPath, 'utf8'),
    isSchemaDocument,
    'invalid signal schema',
  )
  return cachedSchema
}

/**
 * Compile the hand-rolled structural validator for one record shape in schema.json.
 * `defName` selects a shape under `$defs` (e.g. 'flow_envelope'); null is the top-level
 * signal record. Both shapes go through this one function so the flow spine cannot drift
 * into a validator of its own.
 */
function compileStructuralValidator(
  defName: string | null = null,
): (record: unknown) => ValidationError[] {
  const cacheKey = defName ?? '__root__'
  if (cachedValidators.has(cacheKey)) return cachedValidators.get(cacheKey)!
  const root = loadSchema()
  const schema = defName ? root.$defs?.[defName] : root
  if (!schema) throw new Error(`schema.json has no $defs.${defName}`)
  const required = schema.required ?? []
  const props = schema.properties ?? {}
  const validator = (record: unknown): ValidationError[] => {
    const errors: ValidationError[] = []
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
      if (
        def.type === 'object' &&
        (value === null || typeof value !== 'object' || Array.isArray(value))
      ) {
        errors.push({ code: 'type-mismatch', field: key, expected: 'object' })
      }
      if (Array.isArray(def.type) && !def.type.includes(value === null ? 'null' : typeof value)) {
        errors.push({ code: 'type-mismatch', field: key, expected: def.type.join('|') })
      }
    }
    return errors
  }
  cachedValidators.set(cacheKey, validator)
  return validator
}

function validateAgainst(record: unknown, defName: string | null): ValidationResult {
  const errors: ValidationError[] = []
  errors.push(...compileStructuralValidator(defName)(record))

  if (isObject(record)) {
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

export function validateRecord(record: unknown): ValidationResult {
  return validateAgainst(record, null)
}

/**
 * The one cross-field rule on the spine: `work_id === null` iff `kind === 'session_summary'`.
 *
 * It is a biconditional, not a permission. Read one way it says a session summary MUST NOT claim a
 * work item — a session spans many work items and a work item spans many sessions, so any hard
 * attribution rule is wrong in both directions and the join belongs on the read side, on
 * `session_id`. Read the other way it says nothing ELSE may go work-id-less: an unattributed span
 * mints an `orphan-` id precisely so the attribution gap stays countable, and a second kind allowed
 * to write null would leave that gap invisible while shrinking the R3 numerator for free.
 *
 * It lives in the validator rather than in `emitEvent` because `flow emit --kind session_summary` is
 * a door too, and a gate only one door honours is not a gate.
 */
function flowKindWorkIdError(record: unknown): ValidationError | null {
  const value = isObject(record) ? record : null
  const isSummary = value?.kind === 'session_summary'
  const isNull = value?.work_id === null
  if (isSummary && !isNull) {
    return {
      code: 'session-summary-work-id',
      message: 'kind=session_summary MUST carry work_id null — attribution is a read-side join',
    }
  }
  if (isNull && !isSummary) {
    return {
      code: 'null-work-id',
      message: `work_id null is only legal for kind=session_summary, not ${value?.kind}`,
    }
  }
  return null
}

/**
 * The two admissible causes of a `work.reopened`, read from `$defs.work_reopen_cause`.
 *
 * Exported so the flow emitter refuses an unknown cause at ITS door too, off this same list. The
 * emitter's own check is not redundant with the one below: it reports a named error code before the
 * envelope is ever built, which is what a caller of `reopenWork()` sees, while this one is what
 * `flow emit --kind work.reopened` hits.
 */
export function workReopenCauses(): string[] {
  const values = loadSchema().$defs?.work_reopen_cause?.enum ?? []
  return values.filter((value): value is string => typeof value === 'string')
}

/**
 * `work.reopened` carries a cause the vocabulary recognises.
 *
 * A cross-field rule rather than a payload subschema because `compileStructuralValidator` reads
 * top-level properties only — an enum written under `properties.payload` would validate nothing
 * while reading as though it did. The value matters: `revision` and `evidence_insufficient` are not
 * interchangeable (one says the requirement moved, the other says the record was short), and a
 * reopen carrying neither cannot be audited against the requirement's history at all. Presence is
 * already enforced at the emitter; this is the half that checks WHICH.
 */
function flowReopenCauseError(record: unknown): ValidationError | null {
  const value = isObject(record) ? record : null
  if (value?.kind !== 'work.reopened') return null
  const allowed = workReopenCauses() as string[]
  const payload = isObject(value.payload) ? value.payload : null
  const cause = payload?.cause
  if (typeof cause === 'string' && allowed.includes(cause)) return null
  return {
    code: 'reopen-cause-unknown',
    field: 'payload.cause',
    allowed,
    got: cause,
    message: `work.reopened payload.cause must be one of ${allowed.join(' | ')}`,
  }
}

/** Same validator, same redaction enforcement, applied to $defs.flow_envelope. */
export function validateFlowEvent(record: unknown): ValidationResult {
  const result = validateAgainst(record, 'flow_envelope')
  const cross = [flowKindWorkIdError(record), flowReopenCauseError(record)].filter(
    (error): error is ValidationError => error !== null,
  )
  if (cross.length === 0) return result
  return { ok: false, errors: [...result.errors, ...cross] }
}
