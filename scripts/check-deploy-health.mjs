#!/usr/bin/env node

const DEFAULT_ATTEMPTS = 1
const DEFAULT_DELAY_MS = 10_000
const DEFAULT_MAX_TIME_MS = 15_000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function normalizeUrl(rawUrl) {
  const normalized = String(rawUrl ?? '')
    .replace(/\s+\([^)]*\)$/u, '')
    .trim()

  if (!normalized) {
    return ''
  }

  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized
  }

  return `https://${normalized}`
}

export async function requestUrl(url, options = {}) {
  const controller = new AbortController()
  const maxTimeMs = options.maxTimeMs ?? DEFAULT_MAX_TIME_MS
  const timeoutId = setTimeout(() => controller.abort(), maxTimeMs)

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: options.userAgent ? { 'user-agent': options.userAgent } : undefined,
      signal: controller.signal,
    })

    return {
      statusCode: String(response.status),
      url,
    }
  } catch (error) {
    return {
      statusCode: '000',
      url,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function probeTarget(target, options) {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const request = options.requestUrl ?? requestUrl

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await request(target.url, options)
    const enriched = {
      ...result,
      attempt,
      label: target.label,
    }

    if (enriched.statusCode === '200') {
      return enriched
    }

    if (attempt < attempts && enriched.statusCode !== '403') {
      await sleep(delayMs)
    }

    if (enriched.statusCode === '403') {
      return enriched
    }

    if (attempt === attempts) {
      return enriched
    }
  }

  return {
    attempt: attempts,
    label: target.label,
    statusCode: '000',
    url: target.url,
  }
}

async function probeAuthBinding(baseUrl, options = {}) {
  const url = `${baseUrl}/api/auth/sign-in/social`
  const controller = new AbortController()
  const maxTimeMs = options.maxTimeMs ?? DEFAULT_MAX_TIME_MS
  const timeoutId = setTimeout(() => controller.abort(), maxTimeMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
      redirect: 'manual',
      signal: controller.signal,
    })
    // 302 = redirect to Google OAuth (healthy)
    // 200 = returned URL in body (healthy)
    // 500 = binding crash (KV/D1 missing)
    if (response.status === 500) {
      return { ok: false, statusCode: response.status, url }
    }
    return { ok: true, statusCode: response.status, url }
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      url,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function runHealthChecks(options) {
  const rawTargets = [
    { label: 'Custom domain', url: normalizeUrl(options.customDomainUrl) },
    { label: 'Deployment URL', url: normalizeUrl(options.deploymentUrl) },
  ].filter((target) => target.url.length > 0)

  const targets = rawTargets.filter(
    (target, index) => rawTargets.findIndex((item) => item.url === target.url) === index,
  )

  if (targets.length === 0) {
    return {
      ok: false,
      reason: 'failed',
      error: 'No health check targets configured',
      attempts: [],
    }
  }

  const attempts = []

  for (const target of targets) {
    const result = await probeTarget(target, options)
    attempts.push(result)

    if (result.statusCode === '200') {
      const authProbe = await probeAuthBinding(result.url, options)
      if (!authProbe.ok) {
        return {
          ok: false,
          reason: 'auth_binding_broken',
          error: `Auth binding probe failed: POST ${authProbe.url} returned HTTP ${authProbe.statusCode} (expected non-500). KV or D1 binding may be missing from deployed Worker.`,
          attempts,
        }
      }
      return {
        ok: true,
        reason: 'healthy',
        target: result.label,
        attempts,
      }
    }
  }

  const allBlockedByWaf = attempts.length > 0 && attempts.every((item) => item.statusCode === '403')
  if (allBlockedByWaf) {
    return {
      ok: false,
      reason: 'blocked_by_waf',
      warning:
        'GitHub runner received HTTP 403 from all health check targets; likely blocked by Cloudflare WAF/Bot protection, but no endpoint returned HTTP 200.',
      error:
        'Health check failed: every configured target returned HTTP 403, so deployment health could not be confirmed.',
      attempts,
    }
  }

  return {
    ok: false,
    reason: 'failed',
    error: `Health check failed: ${attempts.map((item) => `${item.label}=${item.statusCode}`).join(', ')}`,
    attempts,
  }
}

async function main() {
  const acceptWafBlock = (process.env.HEALTH_CHECK_ACCEPT_WAF_BLOCK ?? 'false') === 'true'
  const result = await runHealthChecks({
    customDomainUrl: process.env.CUSTOM_DOMAIN_URL,
    deploymentUrl: process.env.DEPLOYMENT_URL,
    userAgent: process.env.BROWSER_USER_AGENT,
    attempts: Number(process.env.HEALTH_CHECK_ATTEMPTS ?? DEFAULT_ATTEMPTS),
    delayMs: Number(process.env.HEALTH_CHECK_DELAY_MS ?? DEFAULT_DELAY_MS),
    maxTimeMs: Number(process.env.HEALTH_CHECK_MAX_TIME_MS ?? DEFAULT_MAX_TIME_MS),
  })

  for (const attempt of result.attempts) {
    console.log(`${attempt.label} attempt ${attempt.attempt}: HTTP ${attempt.statusCode}`)
  }

  if (result.reason === 'blocked_by_waf' && result.warning) {
    console.log(`::warning::${result.warning}`)
  }

  if (!result.ok) {
    if (result.reason === 'blocked_by_waf' && acceptWafBlock) {
      console.log(
        'Health check soft-passed: GitHub runner was blocked by Cloudflare WAF/Bot protection.',
      )
      return
    }

    console.log(`::error::${result.error}`)
    process.exit(1)
  }

  console.log(`Health check passed via ${result.target}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('::error::deploy health check crashed', error)
    process.exit(1)
  })
}
