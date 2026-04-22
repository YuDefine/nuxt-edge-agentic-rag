import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const reflectMetadataPolyfill = readFileSync(require.resolve('reflect-metadata/Reflect.js'), 'utf8')
const nativeReflectPolyfillPreamble = [
  'const __nativeReflectApply = typeof globalThis.Reflect?.apply === "function" ? globalThis.Reflect.apply : ((target, thisArgument, argumentsList) => Function.prototype.apply.call(target, thisArgument, argumentsList));',
  reflectMetadataPolyfill,
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

export function createNitroRollupConfig() {
  return {
    plugins: [patchOpenTelemetryProxyTracer()],
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
