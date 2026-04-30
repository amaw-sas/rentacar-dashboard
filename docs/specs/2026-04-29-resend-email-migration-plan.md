# Implementation plan — Migración alquilatucarro a Resend

**Fecha**: 2026-04-29
**Spec**: `docs/specs/2026-04-29-resend-email-migration-design.md` (commits `8e4eaa4` + `a57442f`)
**Branch**: `chore/email-cleanup-post-cutover` (push directo a `main`, sin PR)
**Estado**: pre-implementación, pre-handoff a `/scenario-driven-development`

---

## File structure map

Mapping de archivos antes de definir tasks. Cada archivo tiene una responsabilidad clara.

| Archivo | Responsabilidad | Acción | Boundary |
|---|---|---|---|
| `lib/email/client.ts` | Factory de Resend client por franquicia (lookup de API key, validación) | **Rewrite** completo | Pública: `getResendClient(franchise)` |
| `lib/email/send.ts` | Envío individual de email vía Resend + retry + log a notification_logs | **Modify** body | Pública: `sendEmail(opts)` (signature sin cambios). Helper privado nuevo: `deriveReplyTo(senderEmail)` |
| `lib/email/notifications.ts` | Orquestación de templates por estado de reserva | **Modify menor** | Eliminar 4 calls a `delay()` y la constante. Resto sin cambios. |
| `lib/email/render.ts` | React-email render → HTML | Sin cambios | — |
| `lib/email/templates/*.tsx` | Templates de emails | Sin cambios | — |
| `tests/unit/email/send.test.ts` | Unit tests de send.ts | **Rewrite** mocks (nodemailer → Resend) + agregar scenarios S1–S5, S10–S13, S15 | Cubre boundary `sendEmail()` con Resend SDK mockeado |
| `tests/unit/email/notifications.test.ts` | Unit tests de notifications.ts | **Update** — remover mocks de `delay()` | Sin cambios mayores en cobertura |
| `tests/unit/email/templates/*.test.tsx` | Tests de templates | Sin cambios | — |
| `supabase/migrations/NNN_alquilatucarro_resend_sender.sql` | Update de `franchises.sender_email` para alquilatucarro | **New** | DB-only, idempotente vía WHERE clause |
| `package.json` + `pnpm-lock.yaml` | Manifest de dependencias | **Add** `resend` | Mantener `nodemailer` (cleanup separado posterior) |
| `.env.local.example`, `.env.staging.example` | Templates de env vars | **Add** placeholder `ALQUILATUCARRO_RESEND_API_KEY=re_xxx` | Documentación operativa |
| `CHANGELOG.md` | Changelog | **Add** entrada `### Changed` y `### Removed` | Una entrada bajo `[Unreleased]` |

### Decomposition rationale

- **client.ts y send.ts separados**: el cliente Resend (config + env) es una preocupación distinta del envío + retry + log. Ya estaban separados con nodemailer; mantenemos la separación.
- **deriveReplyTo dentro de send.ts** (no archivo nuevo): es un helper de 3-5 líneas usado solo dentro de send.ts. Crear `derive-reply-to.ts` sería sobreingeniería para 1 helper de 1 consumidor.
- **notifications.ts modify mínimo**: aislar el cambio del transport (orquestador no debería importarle quién envía). El delay era un workaround del transport viejo, sale junto.
- **Tests separados por archivo bajo test**: convención existente del proyecto, mantener.
- **Migration SQL aislada**: una migración numerada == un cambio atómico de schema/data, convención del repo.

---

## Prerequisites

**Tools**:
- Node 20, pnpm 10.4.1 (`packageManager` pinned)
- Supabase CLI (para `supabase db push`) — confirmar que está autenticado contra el proyecto correcto
- `dig` (ya instalado, verificado anteriormente)

**Access**:
- Supabase project con permisos de schema/data write (admin role token)
- GitHub push access a `main`
- Vercel project con `ALQUILATUCARRO_RESEND_API_KEY` ya configurado (verificado)

**Environment**:
- `pnpm install --frozen-lockfile` corre clean en local
- Branch `chore/email-cleanup-post-cutover` checked out con commits `8e4eaa4` + `a57442f`

---

## Implementation steps

### Phase 1 — Foundation (transport-agnostic primitives)

#### Step 1: Add `resend` dependency + verify SDK shape via Context7
**Size**: S
**Dependencies**: none
**Scenario embedded**: install + import succeeds

**Tasks**:
- Run `pnpm add resend` (latest stable ^4.x).
- Verify version installed and committed to `pnpm-lock.yaml`.
- Use Context7 (`mcp__plugin_ai-framework_context7__query-docs` with library `resend`) to confirm:
  - Import shape: `import { Resend } from "resend"`
  - Send method signature: `resend.emails.send({...})`
  - Casing: `replyTo` vs `reply_to` (camelCase expected at SDK level)
  - Error response shape: `{ data, error }` with `error.name`, `error.message`, possibly `error.statusCode`
  - Retryable error names: `rate_limit_exceeded` vs alternative spellings

**Acceptance**:
- `package.json` lists `resend` under dependencies
- `pnpm-lock.yaml` updated
- `pnpm install --frozen-lockfile` clean
- Context7 lookup notes captured (in plan or commit message) — concrete API shape verified, not assumed from training

---

#### Step 2: Rewrite `lib/email/client.ts` — `getResendClient`
**Size**: S
**Dependencies**: Step 1
**Scenarios embedded**: S1, S2, S2.1, S15

**Tasks**:
- Replace nodemailer transporter factory with Resend client factory.
- Define `FRANCHISE_ENV_PREFIX` map (3 franchises).
- `getResendClient(franchise: string): Resend` lookup logic:
  - Unknown franchise → throw `Error("Unknown franchise: <franchise>")`
  - Missing `${PREFIX}_RESEND_API_KEY` → throw `Error("Missing Resend API key for "<franchise>". Required: <PREFIX>_RESEND_API_KEY")`
  - Valid → return new Resend instance
- Lazy lookup — module load must not access env vars (S15).

**Acceptance**:
- File exports `getResendClient` with the contract above.
- `import { getResendClient } from "./client"` does not throw with an empty environment.
- Unit tests covering S1, S2, S2.1, S15 fail (red) before Step 5 implements them; pass (green) after.
- `pnpm typecheck` clean.

---

#### Step 3: Implement `deriveReplyTo()` helper in `lib/email/send.ts`
**Size**: S
**Dependencies**: none (can be done in parallel with Step 2)
**Scenarios embedded**: S10, S11

**Tasks**:
- Add `deriveReplyTo(senderEmail: string | null | undefined): string` helper at the top of `send.ts` (or just below imports).
- Algorithm:
  1. If input is null/undefined → return input unchanged.
  2. Split on `@`. If no `@` → return input unchanged.
  3. Apply `/^mail\./i` to the host portion. If match → strip; if no match → return input unchanged.
  4. Re-join `local@host` and return.
- Export only if needed by tests (named export OK; or use `vitest`'s ability to import private helpers — convention check).

**Acceptance**:
- Helper handles all S11 inputs correctly (null, no-prefix, uppercase, no-`@`, multi-TLD, plus addressing).
- `pnpm typecheck` clean.
- Unit tests for S10, S11 fail before Step 5 implements them; pass after.

---

### Phase 2 — Core functionality (transport swap)

#### Step 4: Migrate `sendEmail()` body to Resend SDK
**Size**: M
**Dependencies**: Step 1, 2, 3
**Scenarios embedded**: S3, S4, S5, S12, S13

**Tasks**:
- Replace `createTransporter(franchise)` import with `getResendClient(franchise)`.
- Replace `transporter.sendMail(mailOptions)` with `resend.emails.send({...})` wrapped in `AbortSignal.timeout(10000)`.
- Adapt payload shape:
  - `from: \`\${sender_name} <\${sender_email}>\``
  - `to: [to]` (array)
  - `replyTo: deriveReplyTo(sender_email)`
  - `subject`, `html`, optional `text`, optional `bcc: [bcc]`
  - `headers`: `List-Unsubscribe` + `List-Unsubscribe-Post` (using `deriveReplyTo()` for the unsubscribe address).
- Adapt error handling per Section 4 of the spec:
  - Detect `error.name === 'validation_error'` → no retry, log failed, throw.
  - Detect `error.name === 'rate_limit_exceeded'` or `error.statusCode >= 500` → retry up to MAX_RETRIES with RETRY_DELAY_MS.
  - Network/timeout (catch outside the SDK call) → retry.
  - Defensive `{ data: null, error: null }` → treat as failure.
- Update success log line to include `data.id` as `resend_id`.
- Remove `warnIfFromMismatch()` and `mismatchWarned` Set entirely.

**Acceptance**:
- `sendEmail()` signature unchanged from caller perspective (`SendEmailOptions` same).
- Unit tests for S3, S4, S5, S12, S13 fail before Step 5; pass after.
- `pnpm typecheck` clean.
- No remaining import of `nodemailer` in `send.ts` (verify with grep).

---

#### Step 5: Update `tests/unit/email/send.test.ts`
**Size**: M
**Dependencies**: Step 2, 3, 4
**Scenarios embedded**: All from S1, S2, S2.1, S3, S4, S5, S10, S11, S12, S13, S15

**Tasks**:
- Replace `vi.mock("nodemailer")` setup with `vi.mock("resend")`:
  ```ts
  vi.mock("resend", () => ({
    Resend: vi.fn().mockImplementation(() => ({
      emails: { send: vi.fn() }
    }))
  }));
  ```
- Adapt assertions to inspect the payload passed to `resend.emails.send`.
- Add tests for new scenarios:
  - S1: golden path call to send + notification_logs INSERT
  - S2: throws "Unknown franchise"
  - S2.1: throws "Missing Resend API key" with PREFIX_RESEND_API_KEY in message
  - S3: from/replyTo derivation in payload
  - S4: rate_limit_exceeded × 1 → 2 send calls, success
  - S5: validation_error → 1 send call, throw, log failed
  - S10: deriveReplyTo plus addressing
  - S11: deriveReplyTo edge cases (null, uppercase, multi-TLD, no-prefix, no-`@`)
  - S12: `{ data: null, error: null }` → throw, log failed
  - S13: AbortSignal timeout fires → retry behavior (use `vi.advanceTimersByTime` if needed)
  - S15: import doesn't crash without env vars
- Adjust env var setup in tests (`vi.stubEnv` for `ALQUILATUCARRO_RESEND_API_KEY`).

**Acceptance**:
- `pnpm test tests/unit/email/send.test.ts` green.
- All listed scenarios have at least one test.
- No leftover references to `nodemailer` in test imports.

---

#### Step 6: Remove `delay()` from `lib/email/notifications.ts`
**Size**: S
**Dependencies**: none (independent of transport changes)
**Scenarios embedded**: S14 (smoke check, not asserted in tests)

**Tasks**:
- Delete the constant declaration (`const delay = () => new Promise(...) ` around line 118).
- Remove the 4 `await delay();` calls (around lines 238, 294, 328, 370).
- No replacement needed — Resend handles bursts natively, no rate limit concern at our volume.

**Acceptance**:
- `grep -n "delay\|EMAIL_DELAY_MS" lib/email/notifications.ts` returns zero matches.
- `pnpm typecheck` clean.
- Existing notifications.test.ts behavior unchanged (no test was asserting the delay's existence).

---

#### Step 7: Update `tests/unit/email/notifications.test.ts`
**Size**: S
**Dependencies**: Step 6
**Scenario embedded**: regression — orchestrator behavior unchanged sin delay.

**Tasks**:
- Remove any mock or fake-timer setup specifically for `EMAIL_DELAY_MS` / `delay()`.
- Confirm tests still pass — the orchestrator's responsibility (calling sendEmail with correct payload per status) is independent of delay.

**Acceptance**:
- `pnpm test tests/unit/email/notifications.test.ts` green.
- No timer-related test setup remains for delay handling.

---

### Phase 3 — DB + env + docs

#### Step 8: Create supabase migration
**Size**: S
**Dependencies**: none (independent of code changes)
**Scenario embedded**: S7

**Tasks**:
- Determine next migration number `NNN`: list `supabase/migrations/` and increment from the highest existing prefix.
- Create file `supabase/migrations/NNN_alquilatucarro_resend_sender.sql`:
  ```sql
  UPDATE franchises
  SET sender_email = 'info@mail.alquilatucarro.com',
      updated_at = NOW()
  WHERE code = 'alquilatucarro';
  ```
- Verify migration is idempotent (running twice has no further effect — the WHERE clause handles this).

**Acceptance**:
- File exists with correct numeric prefix.
- SQL parses (run `supabase db lint` if available, or visual check).
- NOT YET applied to prod (applied in Step 11 of the cutover phase).

---

#### Step 9: Update env templates
**Size**: S
**Dependencies**: none
**Scenario embedded**: documentation completeness.

**Tasks**:
- In `.env.local.example`: add `ALQUILATUCARRO_RESEND_API_KEY=re_xxx_replace_me` near the existing SMTP vars.
- In `.env.staging.example`: same.
- Comment above the line: `# Resend SDK API key (scoped to mail.alquilatucarro.com domain)`.

**Acceptance**:
- Both files have the new placeholder.
- `git diff` shows only additions, no accidental modifications.

---

#### Step 10: Update CHANGELOG.md
**Size**: S
**Dependencies**: Steps 4, 6 (so the changes are real before being documented)

**Tasks**:
- Add or extend the `## [Unreleased]` section in `CHANGELOG.md`:
  ```markdown
  ## [Unreleased]

  ### Changed
  - **email**: alquilatucarro now sends via Resend instead of SMTP. From
    changed to `info@mail.alquilatucarro.com` (Reply-To preserves apex).
    Closes the DMARC alignment risk previously flagged in `send.ts`.
  - **email**: notifications between Localiza emails are no longer
    artificially delayed. The 5s `EMAIL_DELAY_MS` was a workaround for
    Mailtrap's per-second rate limit and has no equivalent in Resend.

  ### Removed
  - **email**: `warnIfFromMismatch` runtime check — obsolete with Resend's
    DKIM signing.
  - **email**: `EMAIL_DELAY_MS` env var and `delay()` calls in
    `notifications.ts`.
  ```

**Acceptance**:
- `CHANGELOG.md` has the new entries.
- Existing entries unchanged.

---

### Phase 4 — Cutover

#### Step 11: Local pre-flight + commit
**Size**: S
**Dependencies**: Steps 1–10 complete
**Scenario embedded**: CI gates pass locally before push.

**Tasks**:
- Run, in order:
  ```bash
  pnpm install --frozen-lockfile
  pnpm type-check
  pnpm lint
  pnpm test
  pnpm build
  ```
- All 5 must succeed. Stop on any failure.
- Run `dig MX alquilatucarro.com` — confirm apex MX resolves to a working inbox (Hostinger Google Workspace).
- `git diff` review against `main` — verify scope matches Section 8 of the spec.
- Commit with the message in the spec preview (or use `/commit` skill).

**Acceptance**:
- 5 gates green.
- MX query returns valid mail server records.
- Single commit (or 1-2 commits) on `chore/email-cleanup-post-cutover` with the spec'd message.

---

#### Step 12: Push to GitHub main + watch CI
**Size**: S
**Dependencies**: Step 11
**Scenarios embedded**: CI green; Vercel deploy reaches Ready.

**Tasks**:
- Fast-forward `main` from `chore/email-cleanup-post-cutover` locally:
  ```bash
  git checkout main
  git merge --ff-only chore/email-cleanup-post-cutover
  git push origin main
  ```
- Watch GitHub Actions: typecheck + lint + test + build all green.
- Watch Vercel deploy: status reaches "Ready" (~3-5 min).

**Acceptance**:
- CI green on main.
- Vercel deploy live with new code.
- DB still has old `sender_email` (apex) — code is now Resend, will throw `validation_error` for any email triggered until Step 13. **Window of fail-loud begins**.

---

#### Step 13: Apply DB migration
**Size**: S
**Dependencies**: Step 12 (Vercel deploy must be Ready before this runs)
**Scenarios embedded**: S7.

**Tasks**:
- Run `supabase db push` (against the prod project).
- Verify with SQL:
  ```sql
  SELECT code, sender_email, updated_at
  FROM franchises
  WHERE code = 'alquilatucarro';
  ```
  Expected: `sender_email = 'info@mail.alquilatucarro.com'`.

**Acceptance**:
- Migration applied without error.
- Query returns subdomain sender_email.
- **Window of fail-loud ends** — Resend now accepts the From.

---

#### Step 14: Post-deploy verification
**Size**: S
**Dependencies**: Step 13
**Scenarios embedded**: S6 (reservation flow not blocked), S8 (DKIM/SPF/DMARC pass).

**Tasks**:
- Tail Vercel logs for ~10 minutes. Filter on `[email]` tag.
- Trigger a test reservation (real customer flow against alquilatucarro with a Gmail test inbox).
- Verify email arrives in inbox, not spam folder.
- Inspect headers (Gmail "Show original" or equivalent): `Authentication-Results` should show `dkim=pass`, `spf=pass`, `dmarc=pass`.
- Query `notification_logs`:
  ```sql
  SELECT created_at, status, recipient, error_message
  FROM notification_logs
  WHERE created_at > NOW() - INTERVAL '15 minutes'
  ORDER BY created_at DESC;
  ```
  Expected: rows with `status='sent'`, no unexpected `status='failed'` for real reservations.

**Acceptance**:
- Test email arrives in inbox.
- DKIM/SPF/DMARC all pass.
- `notification_logs` shows successful sends.
- No spike in error logs.

---

## Testing strategy

**Unit tests** (vitest, mocked Resend SDK):
- All scenarios S1–S15 except S6 (integration), S7 (DB), S8 (manual real delivery), S14 (smoke check).
- Run via `pnpm test` as part of CI.

**Integration tests**:
- S6 (reservation flow + email failure) is covered by existing `tests/unit/email/notifications.test.ts` patterns plus the orchestrator catch behavior. No new integration suite created (out of scope per spec Section 5).

**Manual verification**:
- S8: post-deploy smoke email with header inspection.
- S14: implicit during S6/S8 — total inline time for a multi-email status fanout fits within Vercel function budget (300s default).

**No real Resend API in CI** (per spec): the API key isn't exposed to test runners; mocks suffice for code paths.

---

## Rollout plan

**Pre-deploy** (Steps 11):
- Local CI gates green.
- MX preflight.

**Deploy window** (Steps 12–13):
- Window 1 (~6 min): code building/deploying. Code old, DB old. No risk.
- Window 2 (~30s): code new, DB old. Resend rejects emails (validation_error). Active monitoring.
- Window 3 (post-Step 13): code new, DB new. Steady state.

**Post-deploy** (Step 14):
- 10 min monitoring window.
- Manual smoke (S8).
- Query notification_logs to confirm health.

**Rollback** (only if Steps 12–14 surface real production errors):
- **Path C only** (per spec Section 7): `git revert` + redeploy + SQL revert.
- Total recovery ~5–10 min.
- Path A and B are explicitly invalid alone.

**Cron consideration** (`/api/cron/check-pending` runs every 30 min):
- 20% probability of firing during the cutover window.
- If it fires during Window 2 (~30s of fail-loud), rows in `notification_logs` will show `status='failed'` for any pending reservations — manual reenvío post-cutover.
- **Risk accepted in alpha** per spec.

---

## Step dependency graph

```
1 (resend dep) ─────────┐
                         │
2 (client.ts)  ──┬──────►├──► 4 (sendEmail body) ──► 5 (send.test.ts)
3 (deriveReplyTo) ┘      │                                           │
                         │                                           │
6 (remove delay) ────────┴──► 7 (notifications.test.ts) ─────────┐   │
                                                                  │   │
8 (SQL migration) ───────────────┐                                │   │
9 (env templates) ───────────────┤                                │   │
10 (CHANGELOG) ──────────────────┘                                │   │
                                                                  │   │
                                  All complete ─► 11 (pre-flight) ◄───┘
                                                       │
                                                       ▼
                                                 12 (push + CI)
                                                       │
                                                       ▼
                                                 13 (SQL push)
                                                       │
                                                       ▼
                                                 14 (verification)
```

Steps 1, 2, 3 enable Step 4. Steps 6, 8, 9, 10 are independent and can run in parallel during Phase 3.

---

## Summary

**Total steps**: 14
**Phases**: 4 (Foundation, Core, DB+env+docs, Cutover)
**Complexity distribution**: 11×S, 2×M, 0×L, 0×XL
**Estimated total time**: ~6–8 hours of focused work (excluding deploy monitoring window).

**Highest-risk steps**:
- Step 4 (M): the actual transport swap — most code changed; highest chance of bug.
- Step 5 (M): test rewrite — must catch regressions from Step 4.
- Step 12: irreversible without rollback procedure.

**Scenarios coverage**:
- S1, S2, S2.1, S3, S4, S5, S10, S11, S12, S13, S15: covered by Steps 2, 3, 4, 5 (unit tests).
- S6: covered by existing `notifications.test.ts` patterns (catch behavior in orchestrator, untouched).
- S7: covered by Steps 8 + 13.
- S8, S14: manual / smoke at Step 14.
- S9: implicit (no schema migration needed → trivially satisfied by no DDL change).

**Handoff next**: `/scenario-driven-development` consumes this plan + the spec scenarios and drives implementation per step.

---

## Open questions / deferred items

- **Resend SDK exact error name taxonomy**: confirmed via Context7 in Step 1. If the names differ from what's assumed (e.g., `validation_error` vs `bad_request`), Step 4 needs to map them in error categorization. Plan accommodates this by grouping the Context7 lookup into Step 1 before any error-handling code is written.
- **`replyTo` casing in SDK**: assumed camelCase (`replyTo`). If SDK requires `reply_to`, adjust in Step 4. Caught by Context7 lookup or by tests in Step 5 if it slips.
- **List-Unsubscribe header precedence**: if Resend auto-injects, our custom header may be overridden. Verify in Step 14 (S8) by inspecting raw headers; if overridden, document and accept (Resend's auto-injection is functional too).
- **Branch cleanup post-merge**: `chore/email-cleanup-post-cutover` becomes stale after merging to main. Delete locally and remote in branch-cleanup pass.
