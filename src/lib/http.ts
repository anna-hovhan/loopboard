/**
 * fetch with backoff on 429 and 5xx. Miro, Slack and Jira all send
 * Retry-After on rate limiting, which takes precedence over the backoff.
 */

const MAX_ATTEMPTS = 4;

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) return res;

    const retryAfterSeconds = Number(res.headers.get('retry-after'));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 500 * 2 ** (attempt - 1);
    await sleep(Math.min(delayMs, 30_000));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
