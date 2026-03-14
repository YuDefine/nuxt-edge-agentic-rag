import { Buffer } from 'node:buffer'

import type { UploadedObjectMetadata } from '#server/utils/staged-upload'

interface D1ExecutionCall {
  method: 'all' | 'first' | 'run'
  query: string
  values: unknown[]
}

interface D1ResponderResult {
  all?: unknown[]
  first?: unknown | null
  run?: unknown
}

interface D1Responder {
  match: RegExp | string
  resolve(call: D1ExecutionCall): D1ResponderResult | Promise<D1ResponderResult>
}

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
  all<T>(): Promise<{ results?: T[] }>
}

interface D1BindingFakeOptions {
  responders?: D1Responder[]
}

interface KvPutCall {
  key: string
  options?: {
    expirationTtl?: number
  }
  value: string
}

interface KvBindingFakeOptions {
  initialValues?: Record<string, string>
}

interface R2SeedObject {
  body: string
  key: string
  metadata?: Partial<UploadedObjectMetadata>
}

interface R2BucketBindingFakeOptions {
  objects?: R2SeedObject[]
}

interface AiSearchResponseEntry {
  attributes?: {
    file?: Record<string, unknown>
  }
  content?: Array<{
    text?: string
    type?: string
  }>
  filename?: string
  score?: number
}

interface AiSearchBindingFakeOptions {
  responses?: Record<string, AiSearchResponseEntry[]>
}

interface WorkersAiBindingFakeOptions {
  responses?: Record<
    string,
    unknown | ((payload: Record<string, unknown>) => unknown | Promise<unknown>)
  >
}

interface CloudflareBindingsFixtureOptions {
  ai?: unknown
  d1?: unknown
  kv?: unknown
  names?: Partial<CloudflareBindingsFixtureNames>
  r2?: unknown
  workersAi?: unknown
}

interface CloudflareBindingsFixtureNames {
  ai: string
  d1: string
  documents: string
  kv: string
  workersAi: string
}

class FakeD1PreparedStatement implements D1PreparedStatementLike {
  constructor(
    private readonly execute: (call: D1ExecutionCall) => Promise<D1ResponderResult>,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatementLike {
    return new FakeD1PreparedStatement(this.execute, this.query, values)
  }

  async first<T>(): Promise<T | null> {
    const result = await this.execute({
      method: 'first',
      query: this.query,
      values: this.values,
    })

    return (result.first as T | null | undefined) ?? null
  }

  async all<T>(): Promise<{ results?: T[] }> {
    const result = await this.execute({
      method: 'all',
      query: this.query,
      values: this.values,
    })

    return {
      results: (result.all as T[] | undefined) ?? [],
    }
  }

  async run(): Promise<unknown> {
    const result = await this.execute({
      method: 'run',
      query: this.query,
      values: this.values,
    })

    return (
      result.run ?? {
        success: true,
      }
    )
  }
}

export function createD1BindingFake(options: D1BindingFakeOptions = {}) {
  const calls: D1ExecutionCall[] = []
  const responders = [...(options.responders ?? [])]

  async function execute(call: D1ExecutionCall): Promise<D1ResponderResult> {
    calls.push(call)
    const responder = responders.find((candidate) => matchesQuery(candidate.match, call.query))

    if (!responder) {
      return defaultD1Response(call.method)
    }

    return await responder.resolve(call)
  }

  return {
    addResponder(responder: D1Responder) {
      responders.push(responder)
    },
    batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()))
    },
    calls,
    prepare(query: string): D1PreparedStatementLike {
      return new FakeD1PreparedStatement(execute, query)
    },
  }
}

export function createKvBindingFake(options: KvBindingFakeOptions = {}) {
  const store = new Map(Object.entries(options.initialValues ?? {}))
  const getCalls: string[] = []
  const putCalls: KvPutCall[] = []

  return {
    async get(key: string): Promise<string | null> {
      getCalls.push(key)

      return store.get(key) ?? null
    },
    getCalls,
    putCalls,
    async put(
      key: string,
      value: string,
      putOptions?: {
        expirationTtl?: number
      },
    ): Promise<void> {
      putCalls.push({
        key,
        options: putOptions,
        value,
      })
      store.set(key, value)
    },
    snapshot(): Record<string, string> {
      return Object.fromEntries(store.entries())
    },
  }
}

export function createR2BucketBindingFake(options: R2BucketBindingFakeOptions = {}) {
  const store = new Map<string, { body: string; metadata: UploadedObjectMetadata }>()

  for (const object of options.objects ?? []) {
    store.set(object.key, {
      body: object.body,
      metadata: createUploadedObjectMetadata(object.key, object.body, object.metadata),
    })
  }

  return {
    async get(key: string): Promise<{ text(): Promise<string> } | null> {
      const entry = store.get(key)

      if (!entry) {
        return null
      }

      return {
        async text() {
          return entry.body
        },
      }
    },
    async head(key: string): Promise<UploadedObjectMetadata | null> {
      return store.get(key)?.metadata ?? null
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, {
        body: value,
        metadata: createUploadedObjectMetadata(key, value),
      })
    },
    snapshot(): Record<string, string> {
      return Object.fromEntries([...store.entries()].map(([key, value]) => [key, value.body]))
    },
  }
}

export function createAiSearchBindingFake(options: AiSearchBindingFakeOptions = {}) {
  const calls: Array<{
    indexName: string
    request: Record<string, unknown>
  }> = []

  return {
    autorag(indexName: string) {
      return {
        async search(request: Record<string, unknown>) {
          calls.push({
            indexName,
            request,
          })

          return {
            data: options.responses?.[indexName] ?? [],
          }
        },
      }
    },
    calls,
  }
}

export function createWorkersAiBindingFake(options: WorkersAiBindingFakeOptions = {}) {
  const calls: Array<{
    model: string
    payload: Record<string, unknown>
  }> = []

  return {
    calls,
    async run(model: string, payload: Record<string, unknown>): Promise<unknown> {
      calls.push({
        model,
        payload,
      })

      const configured = options.responses?.[model]

      if (typeof configured === 'function') {
        return await configured(payload)
      }

      if (configured !== undefined) {
        return configured
      }

      return {
        model,
        ok: true,
      }
    },
  }
}

export function createCloudflareBindingsFixture(
  options: CloudflareBindingsFixtureOptions = {},
): Record<string, unknown> {
  const names: CloudflareBindingsFixtureNames = {
    ai: 'AI',
    d1: 'DB',
    documents: 'DOCUMENTS',
    kv: 'KV',
    workersAi: 'WORKERS_AI',
    ...options.names,
  }

  return {
    [names.ai]: options.ai ?? createAiSearchBindingFake(),
    [names.d1]: options.d1 ?? createD1BindingFake(),
    [names.documents]: options.r2 ?? createR2BucketBindingFake(),
    [names.kv]: options.kv ?? createKvBindingFake(),
    [names.workersAi]: options.workersAi ?? createWorkersAiBindingFake(),
  }
}

function createUploadedObjectMetadata(
  key: string,
  body: string,
  metadata?: Partial<UploadedObjectMetadata>,
): UploadedObjectMetadata {
  return {
    key,
    size: Buffer.byteLength(body, 'utf8'),
    ...metadata,
  }
}

function defaultD1Response(method: D1ExecutionCall['method']): D1ResponderResult {
  switch (method) {
    case 'all':
      return {
        all: [],
      }
    case 'first':
      return {
        first: null,
      }
    case 'run':
      return {
        run: {
          success: true,
        },
      }
    default:
      return {
        run: {
          success: true,
        },
      }
  }
}

function matchesQuery(match: RegExp | string, query: string): boolean {
  return typeof match === 'string' ? query.includes(match) : match.test(query)
}
