// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/otlp-proto.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/otlp-proto.ts
// clade flow spine — minimal OTLP/protobuf encoder
//
// Why hand-rolled: the OTLP spec offers JSON and protobuf, but Arize Phoenix (the deep-query
// surface Phase D targets) implements only protobuf — `content-type: application/json` comes
// back as `415 Unsupported content type`. The alternatives were a protobuf runtime dependency
// or an OTel Collector sidecar to transcode; both add a moving part to a repo whose whole
// premise is that the spine is a plain file anybody can read. The subset below is fixed by the
// proto definition and has no version drift to track: fields are never renumbered.
//
// Encoded messages (opentelemetry/proto/trace/v1/trace.proto, common/v1, resource/v1):
//
//   TracesData         { repeated ResourceSpans resource_spans = 1 }
//   ResourceSpans      { Resource resource = 1; repeated ScopeSpans scope_spans = 2 }
//   Resource           { repeated KeyValue attributes = 1 }
//   ScopeSpans         { InstrumentationScope scope = 1; repeated Span spans = 2 }
//   InstrumentationScope { string name = 1 }
//   Span               { bytes trace_id = 1; bytes span_id = 2; bytes parent_span_id = 4;
//                        string name = 5; SpanKind kind = 6; fixed64 start = 7; fixed64 end = 8;
//                        repeated KeyValue attributes = 9; Status status = 15 }
//   Status             { string message = 2; StatusCode code = 3 }
//   KeyValue           { string key = 1; AnyValue value = 2 }
//   AnyValue           { string 1; bool 2; int64 3; double 4 }

const WIRE_VARINT = 0
const WIRE_FIXED64 = 1
const WIRE_BYTES = 2

function varint(n: number | bigint): Buffer {
  let v = BigInt(n)
  const out: number[] = []
  do {
    let byte = Number(v & 0x7fn)
    v >>= 7n
    if (v > 0n) byte |= 0x80
    out.push(byte)
  } while (v > 0n)
  return Buffer.from(out)
}

function tag(field: number, wire: number): Buffer {
  return varint((field << 3) | wire)
}

function bytesField(field: number, value: Buffer): Buffer {
  return Buffer.concat([tag(field, WIRE_BYTES), varint(value.length), value])
}

function stringField(field: number, value: string): Buffer {
  return bytesField(field, Buffer.from(value, 'utf8'))
}

function varintField(field: number, value: number | bigint): Buffer {
  return Buffer.concat([tag(field, WIRE_VARINT), varint(value)])
}

function fixed64Field(field: number, value: bigint): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(value)
  return Buffer.concat([tag(field, WIRE_FIXED64), buf])
}

function doubleField(field: number, value: number): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeDoubleLE(value)
  return Buffer.concat([tag(field, WIRE_FIXED64), buf])
}

/**
 * The **body** of one `KeyValue` (no field tag). Callers wrap it themselves because the same
 * message sits at field 1 inside `Resource` and field 9 inside `Span` — returning a pre-tagged
 * buffer would force the caller to slice the tag back off, and that slice would silently
 * mis-encode the moment an attribute list grows past a one-byte length prefix.
 */
function encodeKeyValueBody(kv: { key: string; value: Record<string, unknown> }): Buffer | null {
  const v = kv.value
  let anyValue: Buffer
  if (typeof v.stringValue === 'string') anyValue = stringField(1, v.stringValue)
  else if (typeof v.boolValue === 'boolean') anyValue = varintField(2, v.boolValue ? 1 : 0)
  else if (typeof v.intValue === 'string') anyValue = varintField(3, BigInt(v.intValue))
  else if (typeof v.doubleValue === 'number') anyValue = doubleField(4, v.doubleValue)
  // An attribute matching none of the four is dropped rather than sent empty: an empty AnyValue
  // renders in Phoenix as present-but-blank, which reads as data loss that happened upstream.
  // `toOtlpPayload` never produces one — this is the belt.
  else return null
  return Buffer.concat([stringField(1, kv.key), bytesField(2, anyValue)])
}

type Attr = { key: string; value: Record<string, unknown> }

function attrFields(field: number, attrs: Attr[]): Buffer[] {
  return attrs
    .map((a) => encodeKeyValueBody(a))
    .filter((b): b is Buffer => b !== null)
    .map((b) => bytesField(field, b))
}

interface JsonSpan {
  traceId: string
  spanId: string
  parentSpanId: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano?: string
  attributes: Attr[]
  status: { code: number; message?: string }
}

function encodeSpan(s: JsonSpan): Buffer {
  const status = Buffer.concat([
    ...(s.status.message ? [stringField(2, s.status.message)] : []),
    varintField(3, s.status.code),
  ])
  return Buffer.concat([
    bytesField(1, Buffer.from(s.traceId, 'hex')),
    bytesField(2, Buffer.from(s.spanId, 'hex')),
    ...(s.parentSpanId ? [bytesField(4, Buffer.from(s.parentSpanId, 'hex'))] : []),
    stringField(5, s.name),
    varintField(6, s.kind),
    fixed64Field(7, BigInt(s.startTimeUnixNano)),
    // Absent end = still running. Encoding 0 would make Phoenix render a span that started at
    // the epoch, so the field is omitted exactly as the JSON payload omits it.
    ...(s.endTimeUnixNano ? [fixed64Field(8, BigInt(s.endTimeUnixNano))] : []),
    ...attrFields(9, s.attributes),
    bytesField(15, status),
  ])
}

export interface OtlpJsonPayload {
  resourceSpans: {
    resource: { attributes: Attr[] }
    scopeSpans: { scope: { name: string }; spans: JsonSpan[] }[]
  }[]
}

/** Encode the JSON payload `toOtlpPayload` returns as an OTLP `TracesData` protobuf message. */
export function encodeTracesData(payload: OtlpJsonPayload): Buffer {
  return Buffer.concat(
    payload.resourceSpans.map((rs) =>
      bytesField(
        1,
        Buffer.concat([
          bytesField(1, Buffer.concat(attrFields(1, rs.resource.attributes))),
          ...rs.scopeSpans.map((ss) =>
            bytesField(
              2,
              Buffer.concat([
                bytesField(1, stringField(1, ss.scope.name)),
                ...ss.spans.map((sp) => bytesField(2, encodeSpan(sp))),
              ]),
            ),
          ),
        ]),
      ),
    ),
  )
}
