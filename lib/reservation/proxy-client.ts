// Dashboard → Localiza proxy client (issue #99). Bounds the call with a timeout
// so a slow proxy returns a clean retry-safe error instead of hanging until
// Vercel hard-kills the function with a 504, and forwards an idempotency key so
// a reload+resubmit dedupes at the proxy. Extracted from the route handler as the
// testable seam for the timeout/error behavior.

const DEFAULT_PROXY_TIMEOUT_MS = 28_000;

// Function maxDuration ceiling (seconds). PROXY_TIMEOUT_MS MUST stay below this in
// ms or the abort never fires before Vercel's hard kill — the timeout would be
// dead code. Step 5 wires `export const maxDuration = MAX_DURATION_S` so the two
// never drift.
export const MAX_DURATION_S = 30;

// Timeout for the dashboard→proxy fetch, read once at cold start (env-tunable).
// The proxy's own LOCALIZA_TIMEOUT_MS (25s) sits below this; that cross-process
// pair is documented in .env*.example because the values live in separate
// deployables. An override at/above maxDuration is rejected — it would silently
// turn the timeout into dead code.
function resolveProxyTimeoutMs(): number {
  const parsed = Number(process.env.PROXY_TIMEOUT_MS);
  if (!(Number.isFinite(parsed) && parsed > 0)) return DEFAULT_PROXY_TIMEOUT_MS;
  if (parsed >= MAX_DURATION_S * 1000) {
    console.warn(
      `[proxy-client] PROXY_TIMEOUT_MS=${parsed}ms >= maxDuration ${MAX_DURATION_S * 1000}ms; using default ${DEFAULT_PROXY_TIMEOUT_MS}ms`,
    );
    return DEFAULT_PROXY_TIMEOUT_MS;
  }
  return parsed;
}
export const PROXY_TIMEOUT_MS = resolveProxyTimeoutMs();

// Thrown when the proxy call exceeds its abort deadline. Distinguished so the
// route can return a retry-safe 504 instead of a generic failure.
export class ProxyTimeoutError extends Error {
  constructor(message = "Proxy request timed out") {
    super(message);
    this.name = "ProxyTimeoutError";
  }
}

// Thrown when LOCALIZA_PROXY_URL / PROXY_API_KEY are not configured.
export class ProxyConfigError extends Error {
  constructor(message = "Missing LOCALIZA_PROXY_URL or PROXY_API_KEY") {
    super(message);
    this.name = "ProxyConfigError";
  }
}

// Thrown when the proxy responds non-2xx. Carries the parsed structured body (or
// null if not JSON) + status so the route can pass it through unchanged.
export class ProxyError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly rawText: string;
  constructor(status: number, body: unknown, rawText: string) {
    super(`Proxy responded ${status}`);
    this.name = "ProxyError";
    this.status = status;
    this.body = body;
    this.rawText = rawText;
  }
}

export interface LocalizaReservationPayload {
  pickupLocation: string;
  returnLocation: string;
  pickupDateTime: string;
  returnDateTime: string;
  categoryCode: string;
  referenceToken: string;
  rateQualifier: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerDocument: string;
}

// Detect an abort by the DOMException name rather than `instanceof Error`:
// DOMException is NOT a subclass of Error in every runtime (notably jsdom), so an
// instanceof check would silently miss real timeouts. AbortSignal.timeout fires a
// "TimeoutError"; fetch abort fires an "AbortError".
function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ((error as { name?: unknown }).name === "AbortError" ||
      (error as { name?: unknown }).name === "TimeoutError")
  );
}

export async function createLocalizaReservation(
  payload: LocalizaReservationPayload,
  opts?: { idempotencyKey?: string; signal?: AbortSignal },
): Promise<{ reserveCode: string; reservationStatus: string }> {
  const proxyUrl = process.env.LOCALIZA_PROXY_URL;
  const proxyApiKey = process.env.PROXY_API_KEY;
  if (!proxyUrl || !proxyApiKey) throw new ProxyConfigError();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": proxyApiKey,
  };
  if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  // Bound the WHOLE operation (fetch + body read). The signal stays armed across
  // response.json(), so wrap every await — a body-phase abort must still map to a
  // timeout, not leak a raw DOMException. The signal is injectable for tests.
  const signal = opts?.signal ?? AbortSignal.timeout(PROXY_TIMEOUT_MS);

  try {
    const response = await fetch(`${proxyUrl}/api/localiza/reservation`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const rawText = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // not JSON (network/HTML error) — leave parsed null
      }
      throw new ProxyError(response.status, parsed, rawText);
    }

    // Defensive read symmetric with the !ok branch: a 200 with an unparseable
    // body likely means the reservation WAS created upstream. Preserve the raw
    // body in a typed error instead of leaking a bare SyntaxError, so the route
    // (and future reconciliation) keeps a structured signal.
    const rawText = await response.text();
    try {
      return JSON.parse(rawText) as {
        reserveCode: string;
        reservationStatus: string;
      };
    } catch {
      throw new ProxyError(response.status, null, rawText);
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new ProxyTimeoutError(`Proxy request exceeded ${PROXY_TIMEOUT_MS}ms`);
    }
    throw error;
  }
}
