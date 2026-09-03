export interface RequestPolicy {
  minSpacingMs: number
  maxAttempts: number
  baseBackoffMs: number
  maxBackoffMs: number
  maxRetryAfterMs: number
}

export const PROVIDER_REQUEST_POLICIES = {
  WhatsOnChain: {
    // The unauthenticated service publishes a 3 request/second ceiling. Leave
    // headroom for clock and network variance rather than riding the boundary.
    minSpacingMs: 375,
    maxAttempts: 4,
    baseBackoffMs: 750,
    maxBackoffMs: 8_000,
    maxRetryAfterMs: 30_000,
  },
  Bitails: {
    // The unauthenticated service publishes a 10 TPS ceiling.
    minSpacingMs: 125,
    maxAttempts: 4,
    baseBackoffMs: 500,
    maxBackoffMs: 8_000,
    maxRetryAfterMs: 30_000,
  },
} as const satisfies Record<string, RequestPolicy>

type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>

export function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  if (signal?.aborted) return Promise.reject(new DOMException('Scan cancelled.', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      globalThis.clearTimeout(timer)
      reject(new DOMException('Scan cancelled.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export class RequestStartGate {
  private queue: Promise<void> = Promise.resolve()
  private nextStartAt = 0
  private readonly minSpacingMs: number
  private readonly now: () => number
  private readonly sleep: Sleep

  constructor(
    minSpacingMs: number,
    now: () => number = Date.now,
    sleep: Sleep = abortableDelay,
  ) {
    this.minSpacingMs = minSpacingMs
    this.now = now
    this.sleep = sleep
  }

  async wait(signal?: AbortSignal): Promise<void> {
    const turn = this.queue.then(async () => {
      if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError')
      const waitMs = Math.max(0, this.nextStartAt - this.now())
      await this.sleep(waitMs, signal)
      this.nextStartAt = Math.max(this.nextStartAt, this.now()) + this.minSpacingMs
    })
    this.queue = turn.catch(() => undefined)
    await turn
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.max(0, Math.ceil(Number(trimmed) * 1_000))
  const date = Date.parse(trimmed)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

export function deterministicJitter(key: string, attempt: number): number {
  let hash = attempt + 1
  for (let index = 0; index < key.length; index += 1) hash = ((hash * 33) ^ key.charCodeAt(index)) >>> 0
  return hash % 251
}

export function retryDelay(
  policy: RequestPolicy,
  key: string,
  attempt: number,
  retryAfterMs?: number,
): number {
  const exponential = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * (2 ** attempt))
  return Math.max(retryAfterMs ?? 0, exponential + deterministicJitter(key, attempt))
}
