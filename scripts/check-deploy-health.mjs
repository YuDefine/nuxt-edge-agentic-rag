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
      ok: true,
      reason: 'blocked_by_waf',
      warning: 'GitHub runner received HTTP 403 from all health check targets; likely blocked by Cloudflare WAF/Bot protection.',
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
    process.exit(0)
  }

  if (!result.ok) {
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
