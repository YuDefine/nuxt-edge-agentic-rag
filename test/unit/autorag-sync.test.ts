import { describe, expect, it, vi } from 'vitest'

import { getAutoRagJobStatus, triggerAutoRagSync } from '#server/utils/autorag-sync'

describe('autorag sync', () => {
  const config = {
    accountId: 'acct-1',
    apiToken: 'cf-token',
    instanceName: 'agentic-rag',
  }

  describe('triggerAutoRagSync', () => {
    it('POSTs to the AI Search jobs endpoint with bearer auth and returns the job id', async () => {
      const fetchFake = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ result: { job_id: 'job-123' }, success: true }),
        ok: true,
      })

      const result = await triggerAutoRagSync(config, {
        fetch: fetchFake as unknown as typeof fetch,
      })

      expect(fetchFake).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/acct-1/ai-search/instances/agentic-rag/jobs',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer cf-token' }),
          method: 'POST',
        })
      )
      expect(result).toEqual({ jobId: 'job-123' })
    })

    it('throws when the API returns a non-2xx response', async () => {
      const fetchFake = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({}),
        ok: false,
        status: 503,
      })

      await expect(
        triggerAutoRagSync(config, { fetch: fetchFake as unknown as typeof fetch })
      ).rejects.toThrow(/HTTP 503/)
    })

    it('throws when the API response is missing a job id', async () => {
      const fetchFake = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ result: {}, success: true }),
        ok: true,
      })

      await expect(
        triggerAutoRagSync(config, { fetch: fetchFake as unknown as typeof fetch })
      ).rejects.toThrow(/job_id/)
    })
  })

  describe('getAutoRagJobStatus', () => {
    it('GETs the job endpoint and normalizes the status', async () => {
      const fetchFake = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            result: { id: 'job-123', status: 'completed' },
            success: true,
          }),
        ok: true,
      })

      const result = await getAutoRagJobStatus(config, 'job-123', {
        fetch: fetchFake as unknown as typeof fetch,
      })

      expect(fetchFake).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/acct-1/ai-search/instances/agentic-rag/jobs/job-123',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer cf-token' }),
          method: 'GET',
        })
      )
      expect(result).toEqual({ jobId: 'job-123', status: 'completed' })
    })

    it('maps in_progress and succeeded aliases to running/completed', async () => {
      const fetchFake = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/job-a')) {
          return Promise.resolve({
            json: () =>
              Promise.resolve({
                result: { id: 'job-a', status: 'in_progress' },
                success: true,
              }),
            ok: true,
          })
        }
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              result: { id: 'job-b', status: 'succeeded' },
              success: true,
            }),
          ok: true,
        })
      })

      const running = await getAutoRagJobStatus(config, 'job-a', {
        fetch: fetchFake as unknown as typeof fetch,
      })
      const completed = await getAutoRagJobStatus(config, 'job-b', {
        fetch: fetchFake as unknown as typeof fetch,
      })

      expect(running.status).toBe('running')
      expect(completed.status).toBe('completed')
    })

    it('maps failed result with error message', async () => {
      const fetchFake = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            result: { error: 'source unreachable', id: 'job-x', status: 'failed' },
            success: true,
          }),
        ok: true,
      })

      const result = await getAutoRagJobStatus(config, 'job-x', {
        fetch: fetchFake as unknown as typeof fetch,
      })

      expect(result).toEqual({
        error: 'source unreachable',
        jobId: 'job-x',
        status: 'failed',
      })
    })
  })
})
