export const USER_AGENT = "torlink (+https://www.npmjs.com/package/torlnk)";

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
export type SleepImpl = (ms: number) => Promise<void>;

export interface FetchResilientOptions extends RequestInit {
  retries?: number;
  baseMs?: number;
  capMs?: number;
  fetchImpl?: FetchImpl;
  sleepImpl?: SleepImpl;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

const DEFAULT_RETRIES = 5;
const DEFAULT_BASE_MS = 500;
const DEFAULT_CAP_MS = 20000;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === "AbortError" || /aborted/i.test(e.message))
  );
}

export function parseRetryAfter(
  value: string | null,
  nowMs = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  return undefined;
}

export function backoffDelay(
  attempt: number,
  baseMs: number,
  capMs: number,
  retryAfterMs?: number,
  rand: () => number = Math.random,
): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  const jittered = Math.floor(rand() * exp);
  if (retryAfterMs !== undefined) return Math.max(jittered, retryAfterMs);
  return jittered;
}

function bodyTooLarge(res: Response, maxBytes: number): HttpError {
  const where = res.url ? ` from ${res.url}` : "";
  return new HttpError(res.status || 0, `Response body${where} exceeded ${maxBytes} bytes.`);
}

export async function readResponseText(
  res: Response,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<string> {
  const length = Number(res.headers?.get?.("content-length") ?? 0);
  if (Number.isFinite(length) && length > maxBytes) throw bodyTooLarge(res, maxBytes);

  if (!res.body) {
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw bodyTooLarge(res, maxBytes);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw bodyTooLarge(res, maxBytes);
      }
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function readResponseJson<T = unknown>(
  res: Response,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<T> {
  return JSON.parse(await readResponseText(res, maxBytes)) as T;
}

export async function fetchResilient(
  url: string,
  opts: FetchResilientOptions = {},
): Promise<Response> {
  const {
    retries = DEFAULT_RETRIES,
    baseMs = DEFAULT_BASE_MS,
    capMs = DEFAULT_CAP_MS,
    fetchImpl = fetch as FetchImpl,
    sleepImpl = realSleep,
    signal,
    ...init
  } = opts;

  const fetchInit: RequestInit = signal ? { ...init, signal } : init;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new HttpError(0, "aborted");

    let res: Response | undefined;
    try {
      res = await fetchImpl(url, fetchInit);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) throw e;
      lastError = e;
      if (attempt < retries) {
        await sleepImpl(backoffDelay(attempt, baseMs, capMs));
        continue;
      }
      throw e;
    }

    if (!RETRY_STATUS.has(res.status)) return res;

    const server = res.headers.get("server")?.toLowerCase() || "";
    if (res.status === 503 && (server.includes("ddos-guard") || server.includes("cloudflare"))) {
      throw new HttpError(
        res.status,
        `Request to ${url} blocked by ${server} (HTTP ${res.status}).`,
      );
    }

    if (attempt >= retries) {
      throw new HttpError(
        res.status,
        `Request to ${url} failed after ${retries} retries (HTTP ${res.status}).`,
      );
    }

    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
    await sleepImpl(backoffDelay(attempt, baseMs, capMs, retryAfterMs));
  }

  throw lastError instanceof Error
    ? lastError
    : new HttpError(0, "fetchResilient exhausted without a response");
}
