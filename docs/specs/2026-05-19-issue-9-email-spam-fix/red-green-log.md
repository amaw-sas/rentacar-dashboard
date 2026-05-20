# Red-Green Verification Log

**Date**: 2026-05-19
**File**: `lib/email/fetch-logo.ts`
**Guard tested**: allowlist (`isAllowedHost` check before `fetch`)
**Affected scenarios**: SCEN-03 (SSRF — IP literal), SCEN-09 (suffix-bypass attempt)

## RED phase (guard disabled)

Allowlist guard commented out at lines 49-52:

```ts
// if (!isAllowedHost(parsed.hostname)) {
//   console.warn(`[email] logo host not allowed: ${parsed.hostname}`);
//   return null;
// }
```

Test run output (`pnpm vitest run tests/unit/email/fetch-logo.test.ts`):

```
× SCEN-03: SSRF — host outside allowlist short-circuits before fetch 5004ms
× SCEN-09: suffix-bypass attempt (evil-alquilatucarro.com) is rejected 183ms

FAIL  tests/unit/email/fetch-logo.test.ts > fetchLogoAttachment > SCEN-03: SSRF — host outside allowlist short-circuits before fetch
Error: Test timed out in 5000ms.

FAIL  tests/unit/email/fetch-logo.test.ts > fetchLogoAttachment > SCEN-09: suffix-bypass attempt (evil-alquilatucarro.com) is rejected
AssertionError: expected "fetch" to not be called at all, but actually been called 1 times

Test Files  1 failed (1)
     Tests  2 failed | 10 passed (12)
```

**Interpretation**:
- SCEN-03 failed by timing out — without the guard, the test attempted a real `fetch` to `169.254.169.254` (which doesn't resolve in the test env, hangs until the 5s `AbortController` timeout). Confirms the guard is what prevents the SSRF surface.
- SCEN-09 failed on the assertion `expect(fetchSpy).not.toHaveBeenCalled()` — without the guard, `evil-alquilatucarro.com` was passed to `fetch` directly. Confirms the dot-boundary match (`endsWith("." + h)`) is exactly what blocks the suffix-bypass attempt.

## GREEN phase (guard restored)

Allowlist guard restored:

```ts
if (!isAllowedHost(parsed.hostname)) {
  console.warn(`[email] logo host not allowed: ${parsed.hostname}`);
  return null;
}
```

Test run output:

```
Test Files  1 passed (1)
     Tests  12 passed (12)
   Duration  758ms
```

All 12 tests pass: 10 SCEN-* (SCEN-01..06, SCEN-05b, SCEN-08, SCEN-09, SCEN-10) + 2 defensive (non-https rejection, unparseable URL).

## Conclusion

The allowlist guard is load-bearing for SCEN-03 and SCEN-09. Without it, SSRF surface opens and suffix-bypass attempts succeed. The dot-boundary match (`endsWith("." + h)`) — not plain `endsWith(h)` — is what blocks `evil-alquilatucarro.com` while still accepting legitimate subdomains.
