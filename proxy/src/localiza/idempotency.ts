import { createHash } from "crypto";

// In-memory dedupe for the reservation endpoint (issue #99). The proxy is the
// single-instance choke-point toward Localiza, so a module-scoped store coalesces
// a reload+resubmit (overlapping or near-back-to-back) into ONE upstream booking.
// State is lost on restart/scale — accepted: the threat window is seconds and the
// worst case degrades to today's no-dedupe behavior, never worse.

const DEFAULT_DEDUPE_TTL_MS = 60_000;
// Hard ceiling on cached successes. Eviction is otherwise lazy (per-key on read),
// so a long-lived proxy would accumulate dead entries for bookings never
// resubmitted. The cap bounds memory regardless of uptime.
const DEFAULT_MAX_CACHE_ENTRIES = 5_000;

// The fields that define the user's booking INTENT. Quote artifacts
// (referenceToken, rateQualifier) are deliberately excluded: a reload that
// re-runs availability gets fresh artifacts, so including them would make the
// fingerprint change and silently miss the resubmit we are trying to catch.
export interface BookingFingerprintInput {
  customerDocument: string;
  pickupLocation: string;
  returnLocation: string;
  pickupDateTime: string;
  returnDateTime: string;
  categoryCode: string;
}

const INTENT_FIELDS: (keyof BookingFingerprintInput)[] = [
  "customerDocument",
  "pickupLocation",
  "returnLocation",
  "pickupDateTime",
  "returnDateTime",
  "categoryCode",
];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Stable, order-fixed hash of the intent fields. An explicit Idempotency-Key, when
// present, is COMBINED with the fingerprint (never replaces it): same key + same
// body dedupes; same key + different body stays distinct (never returns the wrong
// reservation); same body + different keys stays distinct (the client signals
// separate attempts).
export function deriveKey(
  input: BookingFingerprintInput,
  headerKey?: string | null,
): string {
  const fingerprint = sha256(
    INTENT_FIELDS.map((field) => `${field}=${String(input[field] ?? "")}`).join(
      "&",
    ),
  );
  return headerKey ? sha256(`${headerKey}:${fingerprint}`) : fingerprint;
}

function resolveTtlMs(): number {
  const parsed = Number(process.env.DEDUPE_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DEDUPE_TTL_MS;
}

function resolveMaxEntries(): number {
  const parsed = Number(process.env.DEDUPE_MAX_ENTRIES);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_CACHE_ENTRIES;
}

interface CacheEntry<T> {
  result: T;
  expiresAt: number;
}

// Separate maps: `inflight` coalesces overlapping calls; `cache` replays a recent
// success. Generic results stored as unknown and cast back at the call boundary.
const inflight = new Map<string, Promise<unknown>>();
const cache = new Map<string, CacheEntry<unknown>>();

// Cache a success, bounding the map. When at the cap, first sweep expired entries
// (cheap, removes dead weight); if still at the cap (all live), drop the oldest by
// insertion order (FIFO). Map preserves insertion order, so keys().next() is the
// oldest. Runs only on the insert path, not on every read.
function rememberSuccess(key: string, result: unknown): void {
  const max = resolveMaxEntries();
  if (cache.size >= max) {
    const now = Date.now();
    for (const [k, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(k);
    }
    while (cache.size >= max) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(key, { result, expiresAt: Date.now() + resolveTtlMs() });
}

// Run `fn` at most once per `key` within the dedupe window:
//   - a fresh success cached within the TTL replays without running `fn`;
//   - an overlapping call awaits the in-flight promise (one upstream call);
//   - a rejection is NOT cached — coalesced waiters share it, but the next
//     arrival re-executes fresh (no poisoning).
//
// `opts.isCacheable` (default: always) gates the TTL replay only — a result that
// fails the predicate still coalesces concurrent waiters but is NOT remembered,
// so a later request re-executes. Used to avoid caching a degraded success (a
// reservation with an empty code: Localiza may have booked but we couldn't parse
// the ConfID — replaying the empty code would block recovery).
export async function withIdempotency<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: { isCacheable?: (result: T) => boolean },
): Promise<T> {
  const cached = cache.get(key);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.result as T;
    cache.delete(key); // lazily evict the expired entry
  }

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    const result = await fn();
    if (!opts?.isCacheable || opts.isCacheable(result)) {
      rememberSuccess(key, result);
    }
    return result;
  })();
  inflight.set(key, promise);

  try {
    return await promise;
  } finally {
    // Clear the in-flight slot on settle (success or failure). On failure nothing
    // was cached, so the next call re-executes.
    inflight.delete(key);
  }
}
