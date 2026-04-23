const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim()
const projectName = process.env.DOCS_CF_PAGES_PROJECT_NAME?.trim()
const stagingBranch = process.env.DOCS_CF_PAGES_STAGING_BRANCH?.trim() || 'staging'
const zoneName = process.env.DOCS_CF_ZONE_NAME?.trim()
const productionUrl = process.env.DOCS_PRODUCTION_URL?.trim()
const stagingUrl = process.env.DOCS_STAGING_URL?.trim()
const syncTarget = process.env.DOCS_DOMAIN_SYNC_TARGET?.trim()

function required(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`)
  }

  return value
}

function parseHost(name, rawUrl) {
  if (!rawUrl) {
    return null
  }

  try {
    return new URL(rawUrl).hostname
  } catch {
    throw new Error(`${name} must be a valid absolute URL`)
  }
}

function formatMessages(items = []) {
  return items
    .map((item) => item?.message)
    .filter(Boolean)
    .join('; ')
}

async function cfRequest(method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${required('CLOUDFLARE_API_TOKEN', apiToken)}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const payload = await response.json()

  if (!response.ok || payload.success === false) {
    const detail = [formatMessages(payload.errors), formatMessages(payload.messages)]
      .filter(Boolean)
      .join(' | ')
    throw new Error(`${method} ${path} failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }

  return payload.result
}

function toRecordName(host) {
  if (host === zoneName) {
    return '@'
  }

  const suffix = `.${zoneName}`

  if (!host.endsWith(suffix)) {
    throw new Error(`Domain ${host} is not under Cloudflare zone ${zoneName}`)
  }

  return host.slice(0, -suffix.length)
}

async function ensurePagesDomain(host, existingDomains) {
  const current = existingDomains.find((item) => item.name === host)

  if (current) {
    console.log(`Pages domain present: ${host} (${current.status})`)
    return current
  }

  const created = await cfRequest(
    'POST',
    `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains`,
    { name: host },
  )

  console.log(`Pages domain added: ${host} (${created.status})`)
  return created
}

async function ensureDnsRecord(zoneId, host, target) {
  const records = await cfRequest(
    'GET',
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(host)}`,
  )

  const conflicting = records.filter((record) => record.type !== 'CNAME')

  if (conflicting.length > 0) {
    throw new Error(`Conflicting non-CNAME DNS record exists for ${host}`)
  }

  if (records.length === 0) {
    await cfRequest('POST', `/zones/${zoneId}/dns_records`, {
      type: 'CNAME',
      name: toRecordName(host),
      content: target,
      proxied: true,
      ttl: 1,
    })
    console.log(`DNS CNAME created: ${host} -> ${target}`)
    return
  }

  const [record] = records
  const currentContent = `${record.content}`.toLowerCase()
  const desiredContent = target.toLowerCase()

  if (currentContent === desiredContent && record.proxied === true) {
    console.log(`DNS CNAME ok: ${host} -> ${target}`)
    return
  }

  await cfRequest('PATCH', `/zones/${zoneId}/dns_records/${record.id}`, {
    content: target,
    proxied: true,
    ttl: 1,
  })
  console.log(`DNS CNAME updated: ${host} -> ${target}`)
}

async function retryDomainValidation(host) {
  const result = await cfRequest(
    'PATCH',
    `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(host)}`,
  )

  console.log(`Validation retried: ${host} (${result.status})`)
  return result
}

async function main() {
  required('CLOUDFLARE_ACCOUNT_ID', accountId)
  required('DOCS_CF_PAGES_PROJECT_NAME', projectName)
  required('DOCS_CF_ZONE_NAME', zoneName)
  required('DOCS_DOMAIN_SYNC_TARGET', syncTarget)

  const productionHost = parseHost('DOCS_PRODUCTION_URL', productionUrl)
  const stagingHost = parseHost('DOCS_STAGING_URL', stagingUrl)
  const pagesTargets = {
    production: productionHost,
    staging: stagingHost,
  }

  const targetKeys =
    syncTarget === 'production' || syncTarget === 'staging'
      ? [syncTarget]
      : (() => {
          throw new Error('DOCS_DOMAIN_SYNC_TARGET must be one of: production, staging')
        })()

  const configuredTargets = targetKeys
    .map((key) => ({ key, host: pagesTargets[key] }))
    .filter((item) => item.host)

  if (configuredTargets.length === 0) {
    console.log('No docs custom domains configured; skipping sync.')
    return
  }

  const project = await cfRequest(
    'GET',
    `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
  )
  const pagesSubdomain = project.subdomain

  if (!pagesSubdomain) {
    throw new Error(`Pages project ${projectName} does not expose a subdomain`)
  }

  const existingDomains = await cfRequest(
    'GET',
    `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains`,
  )

  const initialStatuses = new Map()
  for (const { host } of configuredTargets) {
    const domain = await ensurePagesDomain(host, existingDomains)
    initialStatuses.set(host, domain?.status)
  }

  const zones = await cfRequest('GET', `/zones?name=${encodeURIComponent(zoneName)}`)

  if (!Array.isArray(zones) || zones.length !== 1) {
    throw new Error(`Expected exactly one Cloudflare zone for ${zoneName}`)
  }

  const zoneId = zones[0].id
  const dnsTargets = {
    production: pagesSubdomain,
    staging: `${stagingBranch}.${pagesSubdomain}`,
  }

  for (const { key, host } of configuredTargets) {
    await ensureDnsRecord(zoneId, host, dnsTargets[key])
    // Avoid toggling already-active domains into a transient error state.
    // Only request re-validation for domains that were not yet active.
    if (initialStatuses.get(host) !== 'active') {
      await retryDomainValidation(host)
    } else {
      console.log(`Validation skipped: ${host} already active`)
    }
  }

  const finalDomains = await cfRequest(
    'GET',
    `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains`,
  )

  for (const { host } of configuredTargets) {
    const domain = finalDomains.find((item) => item.name === host)

    if (!domain) {
      throw new Error(`Pages domain ${host} is missing after sync`)
    }

    const validationStatus = domain.validation_data?.status ?? 'unknown'
    const verificationStatus = domain.verification_data?.status ?? 'unknown'

    console.log(
      `Domain status: ${host} pages=${domain.status} validation=${validationStatus} verification=${verificationStatus}`,
    )

    if (domain.status === 'active') {
      continue
    }

    // Pages API 綁域名流程中，pages/verification 可能短暫卡 error，
    // 但只要 validation=active 且外部實測能 HTTP 2xx/3xx，就視為可用——
    // 後續的 smoke-test job 仍會對實際 URL 做嚴格檢查。
    if (validationStatus === 'active') {
      const probeUrl = `https://${host}/`
      try {
        const probe = await fetch(probeUrl, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(5000),
        })
        if (probe.status >= 200 && probe.status < 400) {
          console.log(
            `Pages domain ${host} not yet 'active' (pages=${domain.status}) but ${probeUrl} returned ${probe.status}; treating as ready.`,
          )
          continue
        }
        console.log(`Probe ${probeUrl} returned ${probe.status}`)
      } catch (probeError) {
        console.log(
          `Probe ${probeUrl} failed: ${probeError instanceof Error ? probeError.message : String(probeError)}`,
        )
      }
    }

    throw new Error(
      `Pages domain ${host} is not ready yet (pages=${domain.status}, validation=${validationStatus}, verification=${verificationStatus})`,
    )
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
