// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/otlp-export.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/otlp-export.ts
// clade flow spine — OTLP exporter (P3-adjacent, Phase D)
//
// The spine already stores what OpenTelemetry calls a span: an id, a parent, a start, an end, an
// outcome, and a bag of attributes. `flow.vue` keeps it that way by translating vocabulary at
// **render** time rather than at write time, so nothing here has to undo a display decision —
// this file is a field rename, not a model conversion.
//
// The deep-query surface is a real trace UI (self-host Arize Phoenix: one container, native
// `gen_ai.*` semconv). `/flow` stays portfolio + in-flight. NEVER build a span waterfall deep
// dive inside review-gui — that is the thing this exporter exists to avoid.
//
//   docker run -d --rm --name clade-phoenix -p 6006:6006 arizephoenix/phoenix:latest
//   node vendor/scripts/flow/flow.ts otlp            # whole spine
//   node vendor/scripts/flow/flow.ts otlp <work_id>  # one work item
//   open http://localhost:6006
//
// The export is a push, not a subscription: nothing here watches the spine. Re-running it
// re-sends spans the collector already has, which is fine — OTLP is keyed on (trace, span) id
// and both are derived deterministically, so a repeat is an upsert rather than a duplicate.

import { createHash } from 'node:crypto'

import { encodeTracesData } from './otlp-proto.ts'
import type { FlowEvent, Span } from './spine.ts'
import { foldSpans } from './spine.ts'

/** Phoenix serves OTLP/HTTP on the same port as its UI. Override with --endpoint or the env var. */
export const DEFAULT_OTLP_ENDPOINT = 'http://localhost:6006/v1/traces'

/** OTLP status codes (opentelemetry proto `Status.StatusCode`). */
const STATUS_UNSET = 0
const STATUS_OK = 1
const STATUS_ERROR = 2

/**
 * OTLP ids are fixed-width hex: 32 for a trace, 16 for a span. Locally minted span ids already
 * are 16 (`randomBytes(8)`), but the spine also carries ids that arrived through `flow ingest`
 * from a CI artifact or a harness journal, and those obey nobody's width rule. A collector
 * rejects the **whole batch** on one malformed id, so anything off-width is hashed rather than
 * passed through — a stable rename, not a drop.
 */
export function toHexId(input: string, bytes: 8 | 16): string {
  const width = bytes * 2
  if (new RegExp(`^[0-9a-f]{${width}}$`).test(input)) return input
  return createHash('sha256').update(input).digest('hex').slice(0, width)
}

/** A work item is one trace: that is the whole reason work_id exists. */
export function traceIdFor(workId: string): string {
  return toHexId(workId, 16)
}

function nanos(ts: string | null): string {
  if (!ts) return '0'
  const ms = Date.parse(ts)
  return Number.isNaN(ms) ? '0' : `${BigInt(ms) * 1_000_000n}`
}

function attr(key: string, value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number')
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } }
  if (typeof value === 'boolean') return { key, value: { boolValue: value } }
  if (typeof value === 'string') return { key, value: { stringValue: value } }
  // Objects and arrays go through as JSON rather than as OTLP's nested kvlist: Phoenix renders
  // a string attribute readably, and a half-mapped nested structure reads as data loss.
  return { key, value: { stringValue: JSON.stringify(value) } }
}

/**
 * Payload keys that carry a meaning OpenTelemetry already has a name for. Mapping them lets
 * Phoenix's `gen_ai.*` views light up instead of showing a wall of vendor-prefixed attributes;
 * everything unmapped still ships under `flow.payload.*`, so nothing is lost by not being here.
 */
const GEN_AI_KEYS: Record<string, string> = {
  model: 'gen_ai.request.model',
  agent: 'gen_ai.agent.name',
  agent_type: 'gen_ai.agent.name',
  effort: 'gen_ai.request.reasoning_effort',
}

function spanAttributes(span: Span) {
  const out = [
    attr('flow.kind', span.kind),
    attr('flow.actor', span.actor),
    attr('flow.substrate', span.substrate),
    attr('flow.work_id', span.work_id),
    attr('flow.outcome', span.outcome),
    attr('flow.is_point', span.is_point),
  ]
  // `invoke_agent` / `invoke_workflow` are the two kinds that really are a model call, so they
  // get the semconv operation name. Tagging every span would make the whole spine look like an
  // LLM trace, which is exactly the kind of pretty lie a telemetry view must not tell.
  if (span.kind === 'invoke_agent' || span.kind === 'invoke_workflow')
    out.push(attr('gen_ai.operation.name', span.kind))
  for (const [k, v] of Object.entries(span.payload ?? {})) {
    const semconv = GEN_AI_KEYS[k]
    if (semconv) out.push(attr(semconv, v))
    out.push(attr(`flow.payload.${k}`, v))
  }
  return out.filter(Boolean)
}

function statusOf(span: Span) {
  if (span.outcome === 'fail') return { code: STATUS_ERROR, message: 'fail' }
  if (span.outcome) return { code: STATUS_OK }
  return { code: STATUS_UNSET }
}

export interface OtlpOptions {
  /** Restrict the export to one work item; omit for the whole spine. */
  workId?: string | null
  serviceName?: string
}

/**
 * Fold events into spans and rename the fields. One `resourceSpans` entry per repo (service),
 * one `scopeSpans` entry per work item, so a collector that groups by scope shows one box per
 * piece of work without needing to understand `flow.work_id`.
 */
export function toOtlpPayload(
  events: FlowEvent[],
  { workId = null, serviceName }: OtlpOptions = {},
) {
  const spans = foldSpans(events).filter((s) => !workId || s.work_id === workId)
  const byWork = new Map<string, Span[]>()
  for (const s of spans) byWork.set(s.work_id, [...(byWork.get(s.work_id) ?? []), s])

  const service =
    serviceName ??
    (events.find((e) => typeof e.payload?.consumer_id === 'string')?.payload
      ?.consumer_id as string) ??
    'clade-flow'

  const scopeSpans = [...byWork.entries()].map(([work, workSpans]) => ({
    scope: { name: work },
    spans: workSpans.map((s) => ({
      traceId: traceIdFor(s.work_id),
      spanId: toHexId(s.span_id, 8),
      // An unmatched parent is left as an empty string (OTLP's "no parent"), never invented:
      // a root that is really an orphan is a reportable fact, and Phoenix shows it as one.
      parentSpanId: s.parent_span ? toHexId(s.parent_span, 8) : '',
      name: s.kind,
      kind: 1, // SPAN_KIND_INTERNAL — nothing here is an RPC boundary
      startTimeUnixNano: nanos(s.start_ts),
      // An in-flight span has no end. Sending start as end would render a completed zero-width
      // bar — indistinguishable from a point event, and a lie about work that is still running.
      // Omitting it lets the collector show it as unfinished, which is what it is.
      ...(s.end_ts ? { endTimeUnixNano: nanos(s.end_ts) } : {}),
      attributes: spanAttributes(s),
      status: statusOf(s),
    })),
  }))

  return {
    resourceSpans: [
      {
        resource: { attributes: [attr('service.name', service)].filter(Boolean) },
        scopeSpans,
      },
    ],
  }
}

/** Count spans in a payload without re-folding — used by the CLI's one-line report. */
export function countSpans(payload: ReturnType<typeof toOtlpPayload>): number {
  return payload.resourceSpans.reduce(
    (n, rs) => n + rs.scopeSpans.reduce((m, ss) => m + ss.spans.length, 0),
    0,
  )
}

/**
 * POST one batch over OTLP/HTTP.
 *
 * Wire format is **protobuf**, not the JSON above: the OTLP spec allows both, but Phoenix
 * implements only protobuf and answers `application/json` with `415 Unsupported content type`.
 * The JSON shape stays the in-memory model (and what `--out` writes, because a plain-text
 * artifact is the thing anyone can diff) — `encodeTracesData` is the last step before the wire.
 *
 * Throws on a non-2xx so the CLI exits non-zero: unlike `emitEvent`, an export is something a
 * human asked for just now, so failing loudly is the correct contract.
 */
export async function postOtlp(
  payload: ReturnType<typeof toOtlpPayload>,
  endpoint = DEFAULT_OTLP_ENDPOINT,
) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-protobuf' },
    // `Buffer` is a `Uint8Array` at runtime but not a `BodyInit` to TypeScript (its
    // `ArrayBufferLike` generic diverges), so the view is rebuilt explicitly rather than cast.
    body: new Uint8Array(encodeTracesData(payload)),
  })
  if (!res.ok) throw new Error(`OTLP export failed: ${res.status} ${await res.text()}`)
  return res.status
}
