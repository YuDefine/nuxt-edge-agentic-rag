import { describe, expect, it, vi } from 'vitest'

import { normalizeUrl, runHealthChecks } from '../../scripts/check-deploy-health.mjs'

type MockHealthCheckResult = {
  statusCode: string
  url: string
}

describe('deploy health check', () => {
  it('normalizes bare hostnames to https urls', () => {
    expect(normalizeUrl('agentic.yudefine.com.tw (custom domain)')).toBe(
      'https://agentic.yudefine.com.tw',
    )
  })

  it('returns success when custom domain responds 200', async () => {
    const requestUrl = vi.fn<(_: string) => Promise<MockHealthCheckResult>>().mockResolvedValue({
      statusCode: '200',
      url: 'https://agentic.yudefine.com.tw',
    })

    const result = await runHealthChecks({
      customDomainUrl: 'agentic.yudefine.com.tw',
      deploymentUrl: 'https://workers.dev/deploy-123',
      requestUrl,
    })

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('healthy')
    expect(requestUrl).toHaveBeenCalledTimes(1)
  })

  it('falls back to deployment url when custom domain is blocked by WAF but deployment url returns 200', async () => {
    const requestUrl = vi
      .fn<(_: string) => Promise<MockHealthCheckResult>>()
      .mockResolvedValueOnce({
        statusCode: '403',
        url: 'https://agentic.yudefine.com.tw',
      })
      .mockResolvedValueOnce({
        statusCode: '200',
        url: 'https://workers.dev/deploy-123',
      })

    const result = await runHealthChecks({
      customDomainUrl: 'https://agentic.yudefine.com.tw',
      deploymentUrl: 'https://workers.dev/deploy-123',
      requestUrl,
    })

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('healthy')
    expect(requestUrl).toHaveBeenCalledTimes(2)
  })

  it('fails when every health check target is blocked by WAF and none returns 200', async () => {
    const requestUrl = vi.fn<(_: string) => Promise<MockHealthCheckResult>>().mockResolvedValue({
      statusCode: '403',
      url: 'https://agentic.yudefine.com.tw',
    })

    const result = await runHealthChecks({
      customDomainUrl: 'https://agentic.yudefine.com.tw',
      deploymentUrl: 'agentic.yudefine.com.tw (custom domain)',
      requestUrl,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('blocked_by_waf')
    expect(result.warning).toMatch(/403/i)
    expect(result.error).toMatch(/could not be confirmed/i)
  })

  it('fails when neither target is healthy and the failure is not a WAF 403', async () => {
    const requestUrl = vi.fn<(_: string) => Promise<MockHealthCheckResult>>().mockResolvedValue({
      statusCode: '500',
      url: 'https://agentic-staging.yudefine.com.tw',
    })

    const result = await runHealthChecks({
      customDomainUrl: 'https://agentic-staging.yudefine.com.tw',
      deploymentUrl: 'https://workers.dev/deploy-456',
      requestUrl,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('failed')
  })
})
