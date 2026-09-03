import { describe, expect, it } from 'vitest'
import {
  deterministicJitter, parseRetryAfter, PROVIDER_REQUEST_POLICIES, RequestStartGate, retryDelay,
} from './rate-limit'

describe('provider request pacing', () => {
  it('serializes concurrent request starts with the configured headroom', async () => {
    let now = 1_000
    const waits: number[] = []
    const gate = new RequestStartGate(375, () => now, async (milliseconds) => {
      waits.push(milliseconds)
      now += milliseconds
    })
    await Promise.all([gate.wait(), gate.wait(), gate.wait()])
    expect(waits).toEqual([0, 375, 375])
    expect(now).toBe(1_750)
  })

  it('honors seconds and HTTP-date Retry-After forms', () => {
    expect(parseRetryAfter('1.25', 0)).toBe(1_250)
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:09 GMT', 5_000)).toBe(4_000)
    expect(parseRetryAfter('nonsense', 0)).toBeUndefined()
  })

  it('uses deterministic capped exponential backoff without exceeding provider policy', () => {
    const policy = PROVIDER_REQUEST_POLICIES.WhatsOnChain
    expect(deterministicJitter('same', 2)).toBe(deterministicJitter('same', 2))
    expect(retryDelay(policy, 'request', 20)).toBeLessThanOrEqual(policy.maxBackoffMs + 250)
    expect(retryDelay(policy, 'request', 0, 5_000)).toBeGreaterThanOrEqual(5_000)
  })
})
