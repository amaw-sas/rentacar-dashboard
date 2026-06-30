/**
 * Supabase resilience for the chat (issue: intermittent `TypeError: fetch failed`
 * to Supabase — `SocketError: other side closed` / `ECONNRESET` / `ETIMEDOUT`).
 * These are stale keep-alive sockets going dead between serverless invocations:
 * the chat does many quick Supabase calls per turn and reuses a connection the
 * other side already closed. Symptoms: assistant replies not persisted (dashboard
 * shows no bot reply) and, when a PRE-stream read hangs, the response to the
 * browser stalls and the client sees "network error".
 *
 * Two mitigations, applied by their nature:
 *   - WRITES retry with backoff: a dead socket fails, the retry opens a fresh one
 *     and usually lands on the 2nd try (appendMessages, recordToolEvent).
 *   - READS time out fast: a hung socket fails in a few seconds and the caller
 *     degrades, instead of blocking the turn for tens of seconds on ETIMEDOUT.
 *
 * supabase-js surfaces a fetch failure as a RETURNED `{ error }` (PostgrestError
 * shape: { message, details, code }), not always a throw — so the retry inspects
 * BOTH the thrown error and the returned `error`.
 */

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const TRANSIENT_SIGNATURES = [
  "fetch failed",
  "other side closed",
  "socket",
  "econnreset",
  "etimedout",
  "network",
  "terminated",
  "timeout",
];

/**
 * True when an error (thrown OR the returned supabase `error`) looks like a
 * transient network/socket failure worth retrying — NOT a real PostgREST error
 * (constraint violation, RLS, bad request), which must surface unretried. Handles
 * Error instances (walking the `cause` chain), the PostgrestError plain object
 * ({ message, details, code }), and raw strings.
 */
export function isTransientNetworkError(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; depth < 6 && cur != null; depth++) {
    if (typeof cur === "string") {
      const text = cur.toLowerCase();
      return TRANSIENT_SIGNATURES.some((s) => text.includes(s));
    }
    if (typeof cur !== "object") return false;
    const o = cur as Record<string, unknown>;
    if (typeof o.code === "string" && TRANSIENT_CODES.has(o.code)) return true;
    const text = `${typeof o.message === "string" ? o.message : ""} ${
      typeof o.details === "string" ? o.details : ""
    }`.toLowerCase();
    if (TRANSIENT_SIGNATURES.some((s) => text.includes(s))) return true;
    cur = o.cause; // Error.cause chain; undefined on a PostgrestError → loop ends
  }
  return false;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a supabase op, retrying ONLY transient network failures (thrown or returned
 * in `{ error }`) with exponential backoff. A real PostgREST error returns on the
 * first attempt unretried, so constraint/RLS failures still surface immediately.
 *
 * Retrying a write carries a tiny duplicate risk if the request actually landed
 * before the socket dropped — but "other side closed"/"ECONNRESET before TLS"
 * means it never reached the server, and a duplicate chat row is harmless vs.
 * losing the reply. Net safe for the best-effort writes this wraps.
 */
export async function withSupabaseRetry<T extends { error: unknown }>(
  fn: () => PromiseLike<T>,
  opts?: { retries?: number; baseDelayMs?: number },
): Promise<T> {
  const retries = opts?.retries ?? 2;
  const base = opts?.baseDelayMs ?? 150;
  for (let attempt = 0; ; attempt++) {
    let result: T;
    try {
      result = await fn();
    } catch (e) {
      if (attempt < retries && isTransientNetworkError(e)) {
        await delay(base * 2 ** attempt);
        continue;
      }
      throw e;
    }
    if (
      result.error &&
      attempt < retries &&
      isTransientNetworkError(result.error)
    ) {
      await delay(base * 2 ** attempt);
      continue;
    }
    return result;
  }
}

/**
 * Race a supabase op against a deadline so a dead socket fails FAST and the caller
 * can degrade, instead of hanging the turn for tens of seconds on ETIMEDOUT. The
 * underlying request is abandoned (not awaited) on timeout — fine for the
 * pre-stream reads this wraps, which all fail soft.
 */
export async function withTimeout<T>(
  fn: () => PromiseLike<T>,
  ms: number,
  label?: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`supabase timeout after ${ms}ms${label ? ` (${label})` : ""}`)),
      ms,
    );
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Read deadline for the chat's pre-stream Supabase calls. */
export const CHAT_DB_READ_TIMEOUT_MS = 3000;
