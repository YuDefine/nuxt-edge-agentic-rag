import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const reflectMetadataPolyfill = readFileSync(require.resolve('reflect-metadata/Reflect.js'), 'utf8')
// `reflect-metadata/Reflect.js` declares `var Reflect;` at its own top-level so that
// its IIFE can attach metadata methods onto either the native global or a shim. When
// we inline its source into the Nitro bundle banner, rollup/minifier treats that
// `var Reflect` as a module-level declaration in `chunks/nitro/nitro.mjs`. The
// minifier then renames this module-level `Reflect` to a short local (e.g. `a`,
// `a16`), which **shadows** the native `Reflect` global for **every other module**
// in the bundle. The polyfill's tail `})(Reflect || (Reflect = {}))` assigns `{}`
// to that shadowed binding, so any downstream code that still references bare
// `Reflect.ownKeys(...)` (notably `zod/v4/core/schemas.js` ZodRecord parsing of
// `z.record(z.string(), z.unknown())`) compiles to `a16.ownKeys(m)` at runtime —
// `{}.ownKeys` is undefined, yielding `a16.ownKeys is not a function or its return
// value is not iterable` (see staging tools/call -32603 reproduction).
//
// Wrapping the polyfill in an outer IIFE keeps the `var Reflect;` binding scoped
// to that IIFE — metadata methods still land on `globalThis.Reflect` via the
// polyfill's own `root.Reflect` exporter, but the module-level shadow is gone.
const nativeReflectPolyfillPreamble = [
  'const __nativeReflectApply = typeof globalThis.Reflect?.apply === "function" ? globalThis.Reflect.apply : ((target, thisArgument, argumentsList) => Function.prototype.apply.call(target, thisArgument, argumentsList));',
  '(function () {',
  reflectMetadataPolyfill,
  '})();',
  'globalThis.Reflect ??= {};',
  'if (typeof globalThis.Reflect.apply !== "function") {',
  '  Object.defineProperty(globalThis.Reflect, "apply", { configurable: true, writable: true, value: __nativeReflectApply });',
  '}',
].join('\n')

const upstreamCircularDependencyPackages = [
  'node_modules/.pnpm/nitropack@',
  'node_modules/.pnpm/@nuxt+nitro-server@',
  'node_modules/.pnpm/@nuxthub+core@',
  'node_modules/.pnpm/@nuxt+image@',
  'node_modules/.pnpm/@onmax+nuxt-better-auth@',
  'node_modules/.pnpm/@nuxt+hints@',
  'node_modules/.pnpm/nuxt-security@',
  'node_modules/.pnpm/@nuxtjs+mcp-toolkit@',
] as const

type BuildWarning = {
  code?: string
  id?: string
  message: string
}

type BuildWarningInput = string | BuildWarning | (() => string | BuildWarning)

type BuildWarningHandler = (warning: BuildWarningInput) => void

type BuildTransformContext = {
  warn(message: string): void
}

type NitroRenderedChunk = {
  fileName: string
}

type NitroBuildPlugin = {
  name: string
  transform(
    this: BuildTransformContext,
    code: string,
    id: string,
  ): { code: string; map: null } | null
}

type NitroModuleInfo = {
  modules?: Record<string, unknown>
}

type NitroBundleChunk = NitroModuleInfo & {
  type?: 'chunk' | 'asset'
  fileName: string
  code?: string
  isEntry?: boolean
  moduleIds?: string[]
}

type NitroExportInjectionPlugin = {
  name: string
  generateBundle(this: unknown, _options: unknown, bundle: Record<string, NitroBundleChunk>): void
}

function shouldIgnoreUpstreamCircularDependencyWarning(warning: BuildWarning): boolean {
  if (warning.code !== 'CIRCULAR_DEPENDENCY') {
    return false
  }

  const { message } = warning
  const mentionsProjectCode = /(^| -> )(app|server|shared|scripts)[\\/]/.test(message)
  const mentionsKnownUpstreamPackage = upstreamCircularDependencyPackages.some((signature) =>
    message.includes(signature),
  )
  const mentionsNitroVirtualModule =
    message.includes('virtual:#nitro-internal-virtual') ||
    message.includes('virtual:#internal/nuxt/island-renderer.mjs') ||
    message.includes('virtual:#imports')
  const mentionsNitroRuntimeCore =
    message.includes('nitropack/dist/runtime/internal/app.mjs') ||
    message.includes('nitropack/dist/runtime/index.mjs')

  return (
    !mentionsProjectCode &&
    mentionsKnownUpstreamPackage &&
    (mentionsNitroVirtualModule || mentionsNitroRuntimeCore)
  )
}

function nitroServerBanner(chunk: NitroRenderedChunk): string {
  if (chunk.fileName === 'chunks/nitro/nitro.mjs') {
    return `${nativeReflectPolyfillPreamble}\n`
  }

  return ''
}

function patchOpenTelemetryProxyTracer(): NitroBuildPlugin {
  const modulePath = '/@opentelemetry/api/build/esm/trace/ProxyTracer.js'
  const unsafeReflectApply = 'return Reflect.apply(tracer.startActiveSpan, tracer, arguments);'
  const safeApply =
    'return Function.prototype.apply.call(tracer.startActiveSpan, tracer, arguments);'

  return {
    name: 'patch-opentelemetry-proxy-tracer-reflect-apply',
    transform(code: string, id: string) {
      if (!id.includes(modulePath)) {
        return null
      }

      if (!code.includes(unsafeReflectApply)) {
        this.warn('OpenTelemetry ProxyTracer no longer contains the expected Reflect.apply call.')
        return null
      }

      return {
        code: code.replace(unsafeReflectApply, safeApply),
        map: null,
      }
    },
  }
}

function injectMcpSessionDurableObjectExport(): NitroExportInjectionPlugin {
  const durableObjectModuleSuffix = 'server/durable-objects/mcp-session.ts'
  const durableObjectExportPattern =
    /export\s+(?:\{[^}]*\bMCPSessionDurableObject\b[^}]*\}|(?:class|const|let|var|function)\s+MCPSessionDurableObject\b)/

  return {
    name: 'export-mcp-session-durable-object',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (chunk) => chunk.type === 'chunk' && chunk.isEntry && chunk.fileName === 'index.mjs',
      )
      if (!entry || typeof entry.code !== 'string') {
        return
      }

      const doChunk = Object.values(bundle).find((chunk) => {
        if (chunk.type !== 'chunk') return false
        const modulesMap = chunk.modules as Record<string, unknown> | undefined
        const moduleIds = modulesMap ? Object.keys(modulesMap) : (chunk.moduleIds ?? [])
        return moduleIds.some((id) => id.replaceAll('\\', '/').endsWith(durableObjectModuleSuffix))
      })

      if (!doChunk) {
        throw new Error(
          `[export-mcp-session-durable-object] could not locate chunk containing ${durableObjectModuleSuffix}.`,
        )
      }

      if (typeof doChunk.code === 'string' && !durableObjectExportPattern.test(doChunk.code)) {
        const sourcemapComment = /\n?\/\/# sourceMappingURL=[^\n]*\n?$/
        const match = doChunk.code.match(sourcemapComment)
        const injection = '\nexport { MCPSessionDurableObject };\n'
        doChunk.code = match
          ? doChunk.code.replace(sourcemapComment, `${injection}${match[0]}`)
          : `${doChunk.code}${injection}`
      }

      if (doChunk.fileName === entry.fileName) {
        return
      }

      const relativePath = `./${doChunk.fileName}`
      const exportStatement = `export { MCPSessionDurableObject } from '${relativePath}';\n`
      if (entry.code.includes(exportStatement)) {
        return
      }
      entry.code = `${entry.code}\n${exportStatement}`
    },
  }
}

export function createNitroRollupConfig() {
  return {
    plugins: [patchOpenTelemetryProxyTracer(), injectMcpSessionDurableObjectExport()],
    output: {
      banner: nitroServerBanner,
    },
    onwarn(warning: BuildWarning, defaultHandler: BuildWarningHandler) {
      if (shouldIgnoreUpstreamCircularDependencyWarning(warning)) {
        return
      }

      if (
        warning.code === 'THIS_IS_UNDEFINED' &&
        typeof warning.id === 'string' &&
        warning.id.includes('/mime/dist/src/Mime.js')
      ) {
        return
      }

      defaultHandler(warning)
    },
  }
}
