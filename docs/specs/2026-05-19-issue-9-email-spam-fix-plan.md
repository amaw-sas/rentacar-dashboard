# Implementation Plan — Issue #9 Email Spam Fix (CID logo embed)

**Date**: 2026-05-19
**Spec**: `docs/specs/2026-05-19-issue-9-email-spam-fix-design.md`
**Scenarios**: `docs/specs/2026-05-19-issue-9-email-spam-fix/scenarios/email-spam-fix.scenarios.md`
**Issue**: [#9](https://github.com/amaw-sas/rentacar-dashboard/issues/9)
**Branch**: `fix/issue-9-email-spam-cid`
**Worktree**: `.worktrees/fix-issue-9-email-spam-cid`

## Goal

Eliminar el warning "Host images on the sending domain" de Resend Insights (causa del aterrizaje en spam en Hotmail/Outlook) embebiendo el logo de franquicia como attachment CID en el cuerpo MIME del email, en lugar de servirlo desde Vercel Blob via URL externa. El flujo admin (`<ImageUpload>` → `franchises.logo_url`) se preserva intacto.

---

## File Map

| File | Change | Responsibility |
|---|---|---|
| `lib/email/fetch-logo.ts` | **New** | Server-side fetch del logo con guards fail-closed: URL parse, https-only, host allowlist (exact-or-dot-boundary), content-type prefix check (`image/*`), timeout 5s via `AbortController`, `MAX_LOGO_BYTES = 100_000`. Output `LogoAttachment \| null`. Nunca throw. Todas las fallas → `console.warn` + return null. |
| `lib/email/send.ts` | Edit | Extender `SendEmailOptions` con `attachments?: SendAttachment[]`. Spread condicional al payload de Resend (`...(attachments?.length ? { attachments } : {})`). Sin cambios en error handling, retries, ni notification_logs. |
| `lib/email/notifications.ts` | Edit | Helper privado `prepareLogoForEmail(branding)` que invoca `fetchLogoAttachment` y devuelve `{ branding, attachments }` con `branding.franchiseLogo` reemplazado por `"cid:franchise-logo"` cuando hay éxito. Llamado **1 vez** al inicio de `sendReservationNotifications` y `sendReservationRequestEmail`. Todas las ~10 llamadas a `sendEmail` propagan el mismo `attachments`. |
| `tests/unit/email/fetch-logo.test.ts` | **New** | SCEN-01..06, SCEN-08, SCEN-09, SCEN-10 ejecutables. Mock de `fetch` global, `vi.useFakeTimers` para SCEN-04 (timeout), spy de `console.warn`. |
| `tests/unit/email/send.test.ts` | Edit | Agregar caso "passes attachments to Resend SDK when provided" + caso "omits attachments key when not provided". Sin tocar tests existentes de retry/error handling. |
| `tests/unit/email/notifications.test.ts` | Edit | SCEN-07 — verifica `fetchLogoAttachment.toHaveBeenCalledTimes(1)` cuando una invocación dispara 3 envíos (pendiente + total_insurance). Verifica `cid:franchise-logo` en HTML cuando hay logo, ausencia cuando falla. Object identity check del `attachments` propagado. |

**No new directories** under `app/`, `components/`, ni `hooks/`. **No schema changes**, **no migrations**, **no env vars**, **no DNS**, **no `vercel.json`** edits. **No changes** a templates en `lib/email/templates/` ni a `lib/email/templates/components/email-layout.tsx`.

---

## Prerequisites

- pnpm dependencies instaladas (`pnpm install`).
- No new packages. `resend` ya está en `package.json` (migración previa, commit `927c6c2` y siguientes).
- Worktree `fix/issue-9-email-spam-cid` activo (ya creado al comienzo del brainstorming).

---

## Implementation Steps

### Step 1 — Verify Resend SDK attachments shape via Context7

**Size**: S
**Dependencies**: none
**Scenarios driven**: (bloqueante para SCEN-01..10)

**What to do**:
1. Invocar `mcp__plugin_ai-framework_context7__resolve-library-id` con query `"resend"` para obtener el ID canónico.
2. Invocar `query-docs` con focus en `attachments` para el endpoint `emails.send`.
3. Confirmar:
   - Casing del field: ¿`contentId` o `content_id` en cada attachment?
   - Tipo del field `content`: ¿`Buffer`, `Uint8Array`, o `string` (base64)?
   - Si requiere `path` además de `content`.
   - Formato de referencia desde el HTML: `cid:<id>` (típico CID) vs `<id>@<host>` (Message-ID style).
4. Documentar los hallazgos en un comentario al inicio de `lib/email/fetch-logo.ts` y/o `lib/email/send.ts`.

**Acceptance criteria**:
- El comentario en el código fuente cita la versión exacta de la doc Resend consultada (date stamp del query Context7).
- El body del PR (Step 7) incluye un bloque "Context7 finding" con el snippet exacto que validó el shape, para que el reviewer no tenga que hurgar en comentarios de código.
- La `interface SendAttachment` en `send.ts` matchea exactamente el shape del SDK (sin "guesses").
- Si Context7 indica una API distinta (ej. `content_id` snake_case), todos los SCEN-* tests usan ese casing — sin esto se rompe SCEN-01.

**Why first**: SDK shape mismatches son una clase entera de fallos silenciosos. CLAUDE.md mandate: "NEVER answer about external APIs from pre-training — retrieve via context7 first."

---

### Step 2 — `fetch-logo.ts` with allowlist + guards + scenarios SCEN-01..06,08,09,10

**Size**: M
**Dependencies**: Step 1
**Scenarios driven**: SCEN-01 (parcial — solo el fetch), SCEN-02, SCEN-03, SCEN-04, SCEN-05, SCEN-06, SCEN-08, SCEN-09, SCEN-10

**What to do**:
1. Crear `lib/email/fetch-logo.ts` con:
   - Constantes `FETCH_TIMEOUT_MS = 5000`, `MAX_LOGO_BYTES = 100_000`, `ALLOWED_PREFIXES`, `ALLOWED_HOSTS` (exactos: `public.blob.vercel-storage.com`, `alquilatucarro.com`, `alquilame.com`, `alquicarros.com`).
   - Función `isAllowedHost(hostname)` con match exact-equal o `endsWith("." + h)`.
   - Función exportada `fetchLogoAttachment(logoUrl)` con 5 guard clauses fail-closed.
2. Crear `tests/unit/email/fetch-logo.test.ts` con SCEN-01..06, SCEN-08, SCEN-09, SCEN-10. Mockear `global.fetch` con `vi.spyOn`. Usar `vi.useFakeTimers()` solo en SCEN-04.
3. Verificar: `pnpm test tests/unit/email/fetch-logo.test.ts` → 9 tests passed.

**Acceptance criteria**:
- `grep -c "^test\\(" tests/unit/email/fetch-logo.test.ts` (o equivalente) ≥ 9.
- Cada SCEN-NN tiene un test con nombre `SCEN-NN: <título>` y assertions que el spec describe.
- Tests passing en aislamiento: `pnpm test tests/unit/email/fetch-logo.test.ts` → exit 0, 9 passed, 0 failed, 0 skipped.
- Red-green check para guards: temporalmente comentar la guarda de allowlist y correr los tests → SCEN-03 y SCEN-09 DEBEN fallar; restaurar guarda → DEBEN pasar. Documentar el red-green check en el body del PR (sección "Verification") con el output exacto de la fase roja — no aceptar `"log mental"`.

**Why second**: el módulo es puro (sin DB, sin Resend), aislable, y los scenarios son ejecutables 1:1 contra él. Reduce riesgo antes de tocar el código que orquesta.

---

### Step 3 — `send.ts` accepts `attachments` and forwards to Resend

**Size**: S
**Dependencies**: Step 1
**Scenarios driven**: SCEN-01 (parte payload), parcial soporte para SCEN-07

**What to do**:
1. Extender `interface SendEmailOptions` con `attachments?: SendAttachment[]`. Importar `SendAttachment` desde `./fetch-logo` (o re-declarar localmente — decidir según resultado de Step 1).
2. En `sendEmail`, agregar al payload: `...(attachments && attachments.length > 0 ? { attachments } : {})`.
3. En `tests/unit/email/send.test.ts`:
   - Test "passes attachments to Resend SDK": invocar `sendEmail({ ..., attachments: [{ filename, content, contentId }] })`, capturar arg de `resend.emails.send`, assert que `attachments` está en el call con el shape correcto.
   - Test "omits attachments key when array is empty or undefined": assert que la key `attachments` NO está presente en el payload cuando no se pasa o se pasa `[]`.
4. Verificar: `pnpm test tests/unit/email/send.test.ts` → todos los tests passing (incluyendo los preexistentes).

**Acceptance criteria**:
- `tests/unit/email/send.test.ts` tiene 2 tests nuevos con nombres que mencionen `attachments`.
- `pnpm test tests/unit/email/send.test.ts` → exit 0, todos passed.
- Diff de `send.ts` ≤15 líneas añadidas. No se tocan: retries, error handling, notification_logs, `deriveReplyTo`, headers `List-Unsubscribe`.

**Why third**: el plumbing es trivial y bajo riesgo, pero debe estar antes de Step 4 porque `notifications.ts` lo invoca.

---

### Step 4 — `notifications.ts` wires `prepareLogoForEmail` + SCEN-01, SCEN-07

**Size**: M
**Dependencies**: Step 2, Step 3
**Scenarios driven**: SCEN-01 (e2e desde notifications), SCEN-02 (HTML fallback path desde el orquestador), SCEN-07 (1 fetch por invocación)

**What to do**:
1. En `lib/email/notifications.ts`:
   - Importar `fetchLogoAttachment` desde `./fetch-logo`.
   - Declarar `const LOGO_CONTENT_ID = "franchise-logo"` en scope de módulo.
   - Declarar helper privado `async function prepareLogoForEmail(branding)` que invoca `fetchLogoAttachment(branding.franchiseLogo)`, devuelve `{ branding: { ...branding, franchiseLogo: <"cid:..." o undefined> }, attachments: [...] | undefined }`.
   - En `sendReservationNotifications`: tras `getFranchiseContext`, llamar `const { branding, attachments } = await prepareLogoForEmail(ctx.branding)`. Reemplazar todos los `...branding` que pasan a templates con este `branding`. Pasar `attachments` como argumento a cada `sendEmail({ ..., attachments })` (~9 call sites).
   - Mismo patrón en `sendReservationRequestEmail`.
2. En `tests/unit/email/notifications.test.ts`:
   - Mockear `./fetch-logo` con `vi.mock('@/lib/email/fetch-logo', () => ({ fetchLogoAttachment: vi.fn() }))`.
   - Test SCEN-01: configurar mock para devolver un LogoAttachment válido, invocar `sendReservationNotifications(id, 'reservado', 'alquilatucarro')`, capturar el HTML rendered y el `attachments` pasado a `sendEmail` mock, assert `cid:franchise-logo` y shape del attachment.
   - Test SCEN-02 e2e: mock devuelve null, assert HTML no contiene `cid:` y `attachments` no se pasa a `sendEmail`.
   - Test SCEN-07: configurar reserva en estado `pendiente` con `total_insurance: true` (3 emails: pendiente cliente + pendiente Localiza + seguro total Localiza). Assert `fetchLogoAttachment.toHaveBeenCalledTimes(1)`. Assert que los 3 calls a `sendEmail` reciben el mismo objeto `attachments` (object identity: `sendEmail.mock.calls.map(c => c[0].attachments)` todas referencian el mismo array).
3. Verificar: `pnpm test tests/unit/email/notifications.test.ts` → todos passing.

**Acceptance criteria**:
- Enumeración explícita de los call sites de `sendEmail` que reciben `attachments`: `reservado_cliente` (1), `pendiente_cliente` (1), `pendiente_localiza` (1), `sin_disponibilidad_cliente` (1), `seguro_total_localiza` (1), `extras_localiza` (1), `mensualidad_cliente` (1), `mensualidad_localiza` (1), `solicitud_reserva` (1, en `sendReservationRequestEmail`). Total: 9 call sites. Cada uno auditado por lectura, no solo `grep` (que cuenta comentarios y declaraciones).
- (`grep -c "attachments" lib/email/notifications.ts` ≥ 10 sirve como sanity check rápido, no como criterio único.)
- `prepareLogoForEmail` NO se exporta (no aparece en `export ` statements de `notifications.ts`).
- `tests/unit/email/notifications.test.ts` tiene tests nombrados `SCEN-01`, `SCEN-02 (orchestrator path)`, `SCEN-07` (o equivalente).
- `pnpm test tests/unit/email/notifications.test.ts` → exit 0, todos passed.
- SCEN-07 assertion incluye comparación por referencia (no solo `toEqual`).

**Why fourth**: pieza de orquestación que pega `fetch-logo` con `send`. Necesita ambos antes de poder integrarse.

---

### Step 5 — Full local verification gates

**Size**: S
**Dependencies**: Step 4
**Scenarios driven**: regression check para todo lo demás

**What to do**:
1. `pnpm type-check` (tsc --noEmit).
2. `pnpm lint` (eslint).
3. `pnpm test` — suite completa, no solo email tests. Confirmar 0 regresiones en otros tests.
4. `pnpm build` (Next.js production build).

**Acceptance criteria**:
- `pnpm type-check` → exit 0, sin errores.
- `pnpm lint` → exit 0, 0 errors, 0 warnings (o si hay warnings preexistentes, mismo conteo que antes del PR).
- `pnpm test` → exit 0, todos passing, 0 skipped que cubran código nuevo.
- `pnpm build` → exit 0, build successful.
- Si alguno falla: NO seguir a Step 6. Fix antes de proceder.

**Why fifth**: CLAUDE.md mandate — el gate de CI debe pasar antes del push porque CI = quality gate y los locales reproducen exactamente lo que Vercel deploy verá.

---

### Step 6 — Manual smoke test (SCEN-M3 verificable pre-PR)

**Size**: S
**Dependencies**: Step 5
**Scenarios driven**: SCEN-M3 (Resend Insights warning desaparece) — única scenario manual verificable antes de merge porque no requiere reputación de sender warmed-up.

**What to do**:
1. Configurar `.env.local` apuntando a Supabase staging y una API key de Resend con dominio verificado (ej. `mail.alquilatucarro.com`). **Nota** (memory `env_testing_dev_server`): Next no autocarga `.env.testing`; si las credenciales de staging viven en ese archivo, usar `set -a && . ./.env.testing && set +a && pnpm dev`.
2. `pnpm dev` (Turbopack) — o el invocador con env-load del paso anterior.
3. Disparar un email transaccional real:
   - Opción A: crear una reserva de prueba via la UI que cambie a estado `reservado` (dispara `ReservedClientEmail`).
   - Opción B: invocar `sendReservationNotifications` directamente desde un script puntual (`tests/integration/...` no incluido en CI).
4. Tomar el correo enviado en el dashboard de Resend, abrir el Insights tab, confirmar:
   - 0 warnings de tipo "Host images on the sending domain".
   - Las URLs `cid:franchise-logo` están en el HTML.
   - El attachment `logo.png` aparece listado en la sección Attachments.
5. Capturar screenshot del Insights tab y adjuntar al PR.

**Acceptance criteria**:
- Screenshot del Insights tab adjunto al PR.
- Warning "Host images on the sending domain" NO está en la lista.
- (Si Resend muestra warnings adicionales no relacionados al fix, documentarlos en el PR como out-of-scope.)

**Why sixth**: prueba de fuego sobre el SDK real, no mocks. Si el casing de `contentId` está mal (Step 1 no verificó bien), o si Resend no acepta el shape, este paso lo captura antes del merge.

---

### Step 7 — PR + Quality Integration gates

**Size**: S
**Dependencies**: Step 6
**Scenarios driven**: holdout review (SCEN-01..10 satisfechos)

**What to do**:
1. Invocar `/pull-request` skill para correr los 4 gates en paralelo (code-reviewer, security-reviewer, edge-case-detector, performance-engineer).
2. Resolver findings de los reviewers (o documentar disagreements con justificación).
3. Re-correr Step 5 si hay cambios post-review.
4. Crear PR vía `gh pr create` apuntando a `main`, con título `fix(email): embed logo as CID to fix Hotmail/Outlook spam (#9)` y body que incluya:
   - Link al issue #9.
   - Link al spec.
   - Screenshot de Resend Insights pre/post (SCEN-M3 ✅).
   - Lista de SCEN-01..10 con check de cuáles están cubiertos por tests automatizados.
   - Lista de SCEN-M1, M2, M4, M5 marcados como "post-deploy verification" — el reviewer/operator los ejecutará tras merge.
5. **NO hacer `git push` sin autorización explícita del usuario** (CLAUDE.md).

**Acceptance criteria**:
- PR creado contra `main` con CI passing.
- `/pull-request` skill devuelve aprobación (o findings resueltos).
- Body del PR enumera SCEN-01..10 con estado satisfied y SCEN-M1/M2/M4/M5 con estado "pending post-deploy".
- Screenshot Resend Insights adjuntado.

**Why seventh**: punto de no-retorno. Lo posterior es deploy y observación de SCEN-M*.

---

## Testing Strategy

**Unit tests** (Vitest, en CI):
- `tests/unit/email/fetch-logo.test.ts` — 9 tests (SCEN-01..06, SCEN-08, SCEN-09, SCEN-10).
- `tests/unit/email/send.test.ts` — 2 tests nuevos (attachments forwarding) + tests preexistentes intactos.
- `tests/unit/email/notifications.test.ts` — 3 tests nuevos (SCEN-01 e2e, SCEN-02 fallback path, SCEN-07 1-fetch-N-sends) + tests preexistentes intactos.

**Integration tests**: ninguno nuevo. La suite local no envía emails reales — el smoke de Step 6 cubre esa capa.

**Manual verification post-deploy**:
- SCEN-M1, SCEN-M2 — 5 envíos consecutivos a Hotmail/Outlook personales con verificación de Inbox vs Junk.
- SCEN-M3 — confirmado en Step 6 pre-merge; re-verificar post-deploy con el primer correo producción.
- SCEN-M4 — mail-tester.com score.
- SCEN-M5 — render en 4 clientes.

**Regression check**: `pnpm test` full suite en Step 5 cubre que no se rompan flujos no relacionados a email (reservations, customers, commissions, etc.).

---

## Rollout Plan

**Deployment**:
- Merge a `main` → Vercel auto-deploys a producción (continuous deployment configurado).
- No feature flag — el fix es contenido y graceful (falla → fallback a render existente sin logo).

**Monitoring (primeras 24h post-deploy)**:
- Vercel logs filtered by `[email]` prefix → buscar líneas de `console.warn` que indiquen failures del fetch (host not allowed, fetch 404, content-type rejected, too large).
- Resend dashboard → métrica de delivery rate. Comparar baseline pre-deploy vs post-deploy. Si delivery rate cae, investigar antes de continuar.
- `notification_logs` query: `SELECT status, count(*) FROM notification_logs WHERE channel='email' AND created_at > NOW() - INTERVAL '24 hours' GROUP BY status`. Confirmar ratio de `sent` vs `failed` no se degrada.

**Rollback procedure**:
- Si `notification_logs.status = 'failed'` aumenta significativamente o Resend Insights muestra errores nuevos:
  1. Revert del commit del PR (`git revert <sha>`) → push a `main`.
  2. Vercel re-deploys con el código previo (~3 min).
  3. Sin cambios de schema, ni env vars, ni DNS — rollback es 100% código.
- Si solo SCEN-M1/M2 no se cumplen (Junk persiste tras 72h warm-up), abrir issue de seguimiento — NO revertir, el warning original ya está resuelto (SCEN-M3 ✅) y la solución correcta puede ser warm-up adicional o tweaks de reputación, no rollback.

---

## Risks

| Risk | Mitigation |
|---|---|
| **R1**: Resend SDK shape distinto al asumido (`contentId` vs `content_id`, `content: Buffer` vs base64) | Step 1 hace el lookup via Context7 antes de cualquier código. Step 6 smoke real captura mismatches. |
| **R2**: Vercel Blob latency mayor a 5s en cold-paths → `MAX_LOGO_BYTES` rechaza todos los logos en producción | El timeout es por request, no por size. SCEN-M3 verificará tamaño efectivo en payload Resend. Si bytes > 100k post-deploy, ajustar `MAX_LOGO_BYTES` en un follow-up rápido. |
| **R3**: Sender reputation warm-up enmascarará SCEN-M1/M2 | Documentado en spec section 5; el SCEN-M3 (Insights warning desaparece) es la señal de éxito técnico, SCEN-M1/M2 dependen del provider externo. |
| **R4**: Allowlist demasiado estricta — admin cambia provider de hosting y deja todos los emails sin logo | `console.warn` claro `"logo host not allowed: <host>"` en Vercel logs. Update de allowlist es 1 línea, fix en minutos. |

---

## Post-PR Follow-ups (out of scope)

- Cleanup de `pickup-sender.ts` que selecciona `logo_url` pero no lo usa (línea 90). Es WhatsApp-only; el SELECT es vestigial. Issue de cleanup separado.
- Conectar `pickup-reminder.tsx` y `post-pickup-reminder.tsx` si en algún momento se reactivan los recordatorios por email — adoptarán el mismo patrón `prepareLogoForEmail` cuando se enganchen.
- Considerar mover `MAX_LOGO_BYTES` a una env var si en el futuro se necesita tuning sin redeploy.
