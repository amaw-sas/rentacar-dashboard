# Migración de envío de correos: SMTP → Resend (alquilatucarro como piloto)

**Fecha**: 2026-04-29
**Estado**: aprobado, pre-implementación
**Autor**: Pablo Diaz
**Branch destino**: `main` (push directo, sin PR — restricción operativa por permisos de Vercel)

---

## Contexto

El dashboard de rentacar usa nodemailer + SMTP por franquicia (`ALQUILATUCARRO_MAIL_*`, `ALQUILAME_MAIL_*`, `ALQUICARROS_MAIL_*`) para notificaciones transaccionales. El código actual ya advierte un riesgo de DMARC alignment (`lib/email/send.ts:36-40`): cuando el `From` del email no coincide con el SMTP_USER autenticado, Gmail/Outlook pueden marcar como spam. La solución que el propio código sugiere — "migrar a un provider con DKIM para el From domain" — es lo que esta migración ejecuta.

**Restricciones operativas**:
- Estado del proyecto: alfa. Velocidad > rigor de testing pre-deploy.
- PRs no se deployan a Vercel por motivo de permisos → push directo a `main`.
- Sin testing de preview/smoke/dogfood. Sí mantenemos los gates de CI (typecheck, lint, test, build) porque su falla bloquea Vercel deploy.
- 2 de 3 franquicias (alquicarros, alquilame) **no están operativas actualmente** → no hay tráfico que proteger; aceptable que queden sin envío hasta que se migren más adelante.

**Estado pre-cutover (verificado vía MCP de Resend y `dig`)**:
- Dominio `mail.alquilatucarro.com` → status `verified` en Resend (DKIM ✅, SPF MX ✅, SPF TXT ✅), región `sa-east-1`.
- Dominio `mail.alquicarros.com` → status `failed` (admin no agregó registros DNS).
- Dominio `mail.alquilame.com` → status `not_started` (delegación DNS rota: NS Azure responden REFUSED, "lame delegation").
- API key dedicada `rentacar-dashboard-alquilatucarro-prod` creada con scope `sending_access` y `domainId` restringido a `mail.alquilatucarro.com`.
- Env var `ALQUILATUCARRO_RESEND_API_KEY` ya configurada en Vercel (Production + Preview).

---

## 1. Arquitectura

```
ANTES                                       DESPUÉS

sendEmail(franchise)                        sendEmail(franchise)
  → createTransporter(franchise)              → getResendClient(franchise)
  → nodemailer.sendMail()                     → resend.emails.send()
  → notification_logs                         → notification_logs
```

**Cambios principales**:

1. `lib/email/client.ts` se reescribe completo: en vez de devolver un `nodemailer.Transporter`, devuelve un `Resend` client lookupeado por `${PREFIX}_RESEND_API_KEY`. Throw con mensaje claro si la env var falta para la franquicia.
2. `lib/email/send.ts` cambia el body de `sendEmail()`: reemplaza `transporter.sendMail()` por `resend.emails.send()`, adapta el shape del payload y del error handling.
3. `lib/email/notifications.ts` **no cambia**. La abstracción `sendEmail()` aísla el cambio de transport — toda la orquestación de templates por estado de reserva (460 líneas, alta complejidad) queda intacta.
4. `lib/email/render.ts` no cambia (puro react-email render).
5. DB: migración SQL actualiza `franchises.sender_email` para alquilatucarro de `info@alquilatucarro.com` → `info@mail.alquilatucarro.com` (porque el dominio verificado en Resend es el subdominio, no el apex).
6. Vercel env: agregar `ALQUILATUCARRO_RESEND_API_KEY` (ya hecho). Las 4 vars `ALQUILATUCARRO_MAIL_*` se borran en cleanup posterior, no en este PR.
7. `package.json`: agregar `resend`. Mantener `nodemailer` por ahora (cleanup separado cuando las 3 franquicias estén migradas).

**Lo que se simplifica**:
- `warnIfFromMismatch()` (`send.ts:27-42`) y el `mismatchWarned` Set se eliminan. Resend firma con DKIM directamente; el "SMTP_USER vs From mismatch" deja de ser un riesgo.

---

## 2. Componentes en detalle

### `lib/email/client.ts` (reemplazo)

```ts
import { Resend } from "resend";

const FRANCHISE_ENV_PREFIX = {
  alquilatucarro: "ALQUILATUCARRO",
  alquilame: "ALQUILAME",
  alquicarros: "ALQUICARROS",
} as const;

export function getResendClient(franchise: string): Resend {
  const prefix = FRANCHISE_ENV_PREFIX[franchise as keyof typeof FRANCHISE_ENV_PREFIX];
  if (!prefix) throw new Error(`Unknown franchise: ${franchise}`);

  const apiKey = process.env[`${prefix}_RESEND_API_KEY`];
  if (!apiKey) {
    throw new Error(
      `Missing Resend API key for "${franchise}". Required: ${prefix}_RESEND_API_KEY`
    );
  }
  return new Resend(apiKey);
}
```

**Comportamiento**: alquilatucarro funciona; alquicarros/alquilame throw "Missing Resend API key" si se invocan (acceptable — no tráfico real, falla loud para detectar errores de invocación).

### `lib/email/send.ts` (modificado)

Signature pública de `sendEmail()` no cambia. Cambios internos:

- `createTransporter(franchise)` → `getResendClient(franchise)`
- `transporter.sendMail(opts)` → `resend.emails.send(opts)`
- Helper nuevo: `deriveReplyTo(senderEmail)` stripea `mail.` del dominio (`info@mail.alquilatucarro.com` → `info@alquilatucarro.com`).
- Payload adaptado a Resend SDK:
  ```ts
  await resend.emails.send({
    from: `${franchiseData.sender_name} <${franchiseData.sender_email}>`,
    to: [to],
    replyTo: deriveReplyTo(franchiseData.sender_email),
    subject,
    html,
    ...(text ? { text } : {}),
    ...(bcc ? { bcc: [bcc] } : {}),
    headers: {
      "List-Unsubscribe": `<mailto:${deriveReplyTo(franchiseData.sender_email)}?subject=Unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  ```
- Error handling adaptado a `{ data, error }` shape del SDK (Resend no throw — devuelve error en el response).
- Eliminar `warnIfFromMismatch()` y `mismatchWarned`.

### Env vars (Vercel)

| Variable | Acción | Cuándo |
|---|---|---|
| `ALQUILATUCARRO_RESEND_API_KEY` | Ya configurada | — |
| `ALQUILATUCARRO_MAIL_HOST/_PORT/_USER/_PASS` | Dejar | Cleanup posterior tras confirmar prod estable |
| 8 vars SMTP de alquicarros + alquilame | Dejar | Cleanup junto con migración futura de esas franquicias |

### DB migration

`supabase/migrations/NNN_alquilatucarro_resend_sender.sql`:

```sql
UPDATE franchises
SET sender_email = 'info@mail.alquilatucarro.com',
    updated_at = NOW()
WHERE code = 'alquilatucarro';
```

`NNN` se determina al implementar (siguiente número en la secuencia).

### `package.json`

- Agregar: `resend` (latest stable, ^4.x — confirmar versión exacta vía Context7 al implementar).
- No remover `nodemailer` (cleanup separado).

### Tests

| Archivo | Cambio |
|---|---|
| `tests/unit/email/send.test.ts` | Reemplazar mock de nodemailer por mock de Resend SDK |
| `tests/unit/email/notifications.test.ts` | Sin cambios (mockea `sendEmail`, no la capa de transporte) |
| `tests/unit/email/templates/*.test.tsx` | Sin cambios (puro render) |

---

## 3. Data flow

```
Customer creates reservation
        │
        ▼
app/api/reservations/route.ts
  └─ saves reservation
  └─ after() → sendReservationNotifications()
        │
        ▼
lib/email/notifications.ts
  └─ fetchReservationContext()    (Supabase)
  └─ getFranchiseBranding()        (Supabase)
  └─ renderEmail(<Template/>)      (react-email → HTML)
  └─ sendEmail({ franchise, to, ...})
        │
        ▼
lib/email/send.ts → sendEmail()
  ├─ supabase.from("franchises").select("sender_email, sender_name")
  ├─ deriveReplyTo(sender_email)
  ├─ getResendClient(franchise)    → reads ${PREFIX}_RESEND_API_KEY
  └─ resend.emails.send({...})
        │
        ├──── success ───▶ notification_logs INSERT (status=sent, resend_id en console)
        │
        └──── error ─────▶ retry on rate_limit / 5xx / network (3× × 8s)
                            │
                            └──── final fail ───▶ notification_logs INSERT
                                                  (status=failed, error_message)
                                                  + throw → caller catch en notifications.ts:401
```

### Diferencias vs el flow actual

| Paso | Antes (nodemailer) | Después (Resend) |
|---|---|---|
| Cliente | SMTP transporter por franquicia | Resend client con API key por franquicia |
| Envío | SMTP handshake + DATA | HTTPS POST a `api.resend.com` |
| `from` | `<name> <info@alquilatucarro.com>` | `<name> <info@mail.alquilatucarro.com>` |
| `replyTo` | mismo que from (apex) | apex, derivado del subdomain |
| DKIM | ausente o desalineado | firmado por Resend, alineado a `mail.alquilatucarro.com` |
| SPF | depende del provider SMTP | `include:amazonses.com` via `send.mail.alquilatucarro.com` |
| DMARC alignment | risk (warning explícito en código) | aligned por DKIM |
| `messageId` | header SMTP del provider | UUID que devuelve Resend |
| Retry trigger | `"Too many emails"` / `"550"` | `rate_limit_exceeded` / status 5xx / network throw |

### Window del cutover

```
T-0:00  pnpm typecheck && lint && test (local)
T-0:01  supabase db push  → sender_email = subdomain
T-0:02  git push origin main → CI corre
T-0:05  CI green → Vercel deploy rolling
T-0:07  Vercel deploy live
T-0:07  monitor Vercel logs ~10 min
```

**Window de riesgo (~6 min, T-0:01 → T-0:07)**: la DB tiene el subdomain pero el código viejo (nodemailer) sigue corriendo. Si en esos 6 min se dispara un email, nodemailer manda `From: info@mail.alquilatucarro.com` autenticado vía SMTP de Hostinger → SPF de Hostinger no incluye `mail.alquilatucarro.com` → SPF fail → posible spam folder. **Aceptable en alfa**.

---

## 4. Error handling

### Categorización de errores de Resend

| Categoría | Detección | Política |
|---|---|---|
| `validation_error` (422) | `error.name === 'validation_error'` | No retry. Throw. Log status='failed'. |
| `invalid_api_key` (401) | status 401 / nombre del error | No retry. Severity ERROR. Throw. |
| `rate_limit_exceeded` (429) | `error.name === 'rate_limit_exceeded'` | Retry 3× × 8s |
| 5xx server error | `error.statusCode >= 500` | Retry 3× × 8s |
| Network/timeout | excepción throw del SDK | Retry 3× × 8s |
| Quota exceeded | `error.name` específico | No retry. Escalar manual. |

### Caller-side (notifications.ts)

**No cambia**: el catch en `notifications.ts:401-406` ya envuelve toda la orquestación. Una falla de Resend nunca bloquea el flujo de reservas — la reserva queda persistida, el email falla silenciosamente desde la perspectiva del API, pero queda en `notification_logs` y Vercel logs.

### Logging strategy

| Evento | Console | notification_logs |
|---|---|---|
| Success | `[email] Sent "{subject}" to {to} (resend_id: {id})` | INSERT status=sent |
| Retry | `[email] Retryable error, retrying...` | (sin row hasta el final) |
| Final fail | `[email] Failed (...)` | INSERT status=failed, error_message |

### Observabilidad cruzada (debug post-incident)

1. Vercel logs → buscar por `reservationId` o tag `[email]`.
2. `notification_logs` table → query por `reservation_id`.
3. Resend dashboard → buscar por `resend_id` (en console logs) → ver delivery status real.

### Decisión deferida

Agregar columna `provider_message_id` a `notification_logs` para guardar el `data.id` de Resend de manera estructurada — **no en este PR** (YAGNI mientras solo monitoreamos desde Vercel logs + Resend dashboard).

---

## 5. Testing strategy

### Cobertura del nuevo `send.test.ts`

**Setup mock**:
```ts
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn() }
  }))
}));
```

**Casos** (mapean a observable scenarios S1-S7, S9, S10):
1. `getResendClient`: devuelve cliente con env var; throw "Unknown franchise"; throw "Missing Resend API key".
2. `deriveReplyTo`: subdomain → apex; apex → apex (idempotente); preserva plus addressing.
3. `sendEmail` golden path: lee Supabase, llama `resend.emails.send` con payload correcto, inserta `notification_logs` status='sent'.
4. `sendEmail` error paths:
   - `validation_error` → 1 llamada, throw, log failed
   - `rate_limit_exceeded` × 1 → 2 llamadas, success, log sent
   - `rate_limit_exceeded` × 3 → 3 llamadas, throw, log failed
   - 5xx → retry
   - Network throw → retry, eventual throw + log

### Tests intencionalmente NO escritos

- Llamadas reales a Resend API (requeriría key en CI, brittle, costoso).
- Verificación de DKIM/SPF en headers reales (responsabilidad de Resend; validamos manualmente con `dig` una vez — ya hecho).
- Verificación de delivery / inbox placement (responsabilidad de Resend).
- E2E flow reserva → email (no wireado en CI, fuera del scope alfa).

### Bar mínimo del CI (no se puede saltar)

```
pnpm install --frozen-lockfile
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Falla cualquiera → Vercel deploy bloqueado. Política: correrlos local antes del push.

---

## 6. Observable scenarios (puente a SDD)

### S1 — Resend reemplaza completamente a nodemailer
**Given** `ALQUILATUCARRO_RESEND_API_KEY` está set.
**When** `sendEmail({ franchise: "alquilatucarro", ... })` es invocado.
**Then** `resend.emails.send` se llama una vez con payload correcto **AND** `nodemailer` no es importado/llamado por el código de envío.

### S2 — Franquicias sin API key fallan loud
**Given** `ALQUICARROS_RESEND_API_KEY` no está set.
**When** `sendEmail({ franchise: "alquicarros", ... })` es invocado.
**Then** se arroja un Error cuyo mensaje contiene literalmente `"ALQUICARROS_RESEND_API_KEY"`.

### S3 — From subdominio, Reply-To apex
**Given** `franchises.sender_email = "info@mail.alquilatucarro.com"` y `sender_name = "Alquila tu Carro"`.
**When** `sendEmail()` envía a `customer@example.com`.
**Then** el payload entregado a `resend.emails.send` tiene:
- `from === '"Alquila tu Carro" <info@mail.alquilatucarro.com>'`
- `replyTo === "info@alquilatucarro.com"`

### S4 — Reintento exitoso en rate limit
**Given** `resend.emails.send` devuelve `{ error: { name: "rate_limit_exceeded" } }` una vez y luego `{ data: { id: "abc" } }`.
**When** `sendEmail()` es invocado.
**Then** `send` se llama 2 veces, resultado exitoso, `notification_logs` con `status='sent'`.

### S5 — Validation error: sin retry, throw, log de fallo
**Given** `resend.emails.send` devuelve `{ error: { name: "validation_error", message: "Invalid `from` field" } }`.
**When** `sendEmail()` es invocado.
**Then** `send` se llama exactamente una vez, `sendEmail` arroja, `notification_logs` con `status='failed'` y `error_message` conteniendo el mensaje original.

### S6 — Falla de email no bloquea creación de reserva
**Given** Resend rechaza todas las llamadas para alquilatucarro.
**When** se crea una reserva via `POST /api/reservations` con franquicia alquilatucarro.
**Then** la respuesta HTTP es exitosa, la reserva queda persistida, `notification_logs` con `status='failed'`.

### S7 — DB migration aplica el subdominio
**Given** la migración SQL se ejecuta contra una DB con `franchises.sender_email = "info@alquilatucarro.com"`.
**When** se aplica la migración.
**Then** `SELECT sender_email FROM franchises WHERE code = 'alquilatucarro'` devuelve `'info@mail.alquilatucarro.com'`.

### S8 — DKIM/SPF/DMARC pasan en entrega real (manual post-deploy)
**Given** el deploy en producción está live.
**When** se dispara una reserva real con email de prueba a Gmail.
**Then** los headers `Authentication-Results` muestran `dkim=pass`, `spf=pass`, `dmarc=pass`.

**Único scenario manual del set, ejecutado una vez post-deploy.**

### S9 — notification_logs schema sin cambios
**Given** `notification_logs` table con su schema actual.
**When** Resend completa un envío.
**Then** la fila insertada usa exactamente las columnas existentes: `reservation_id, channel='email', notification_type, recipient, subject, html_content, status` (más `error_message` cuando falla). **Ninguna migración de schema requerida.**

### S10 — Reply-To preserva plus addressing
**Given** `sender_email = "info+marketing@mail.alquilatucarro.com"` (caso edge).
**When** `deriveReplyTo()` procesa el valor.
**Then** devuelve `"info+marketing@alquilatucarro.com"`.

---

## 7. Rollback plan + Runbook de deploy

### Runbook de deploy

```
PRE-FLIGHT (local)
[ ] git pull origin main
[ ] Implementar cambios
[ ] pnpm install (si cambió package.json)
[ ] pnpm type-check / lint / test / build → todos pasan
[ ] Diff review

ENV VARS (Vercel) — ya hecho
[x] ALQUILATUCARRO_RESEND_API_KEY configurada en Production + Preview

DB MIGRATION
[ ] supabase db push → aplica NNN_alquilatucarro_resend_sender.sql
[ ] Verify: SELECT sender_email FROM franchises WHERE code = 'alquilatucarro';
    → debe ser 'info@mail.alquilatucarro.com'

CODE PUSH
[ ] git commit
[ ] git push origin main
[ ] Watch CI → typecheck + lint + test + build pass
[ ] Watch Vercel deploy → Ready

POST-DEPLOY (~10 min monitoring)
[ ] Tail Vercel logs por errores [email]
[ ] Disparar reserva de prueba (S8 — DKIM/SPF/DMARC)
[ ] Inspeccionar headers Authentication-Results
[ ] Query notification_logs últimos 15 min, confirmar no hay status='failed' inesperado
```

### Rollback paths

**Triggers**: errores `[email]` en Vercel logs, `notification_logs.status='failed'` para reservas reales, Resend dashboard rejections, reporte directo.

**Path A — Rollback de código solo** (Resend tiene un bug nuestro, DB OK):
```bash
git revert <commit-sha> && git push origin main
# Wait ~5 min (CI + Vercel deploy)
```
Side effect: nodemailer vuelve a usar `sender_email` subdomain del DB → SMTP envía con From subdomain pero auth con apex → DMARC fail → posible spam folder. **No bloquea envío, solo deliverability**.

**Path B — Rollback de DB solo**: NO usar sin code revert primero. Rompe el código nuevo (Resend rechaza apex no verificado).

**Path C — Rollback completo** (estado pre-cutover):
```bash
git revert <commit-sha> && git push origin main
# Wait ~5 min, luego:
UPDATE franchises SET sender_email = 'info@alquilatucarro.com' WHERE code = 'alquilatucarro';
```

### Tabla de decisión rápida

| Síntoma | Path | Recovery |
|---|---|---|
| Resend rechaza emails (validation/auth) | A o C | ~5 min |
| `getResendClient` arroja para alquilatucarro | A (env var problem) | ~5 min |
| DB migration falló parcialmente | C | ~5 min |
| CI falla en push | No rollback (no llegó a deploy) | 0 min |
| Resend OK pero deliverability mala | Investigar primero, no rollback automático | — |

### Lo que NO está en este plan (por scope)

- Alertas automáticas (PagerDuty / Slack) — no en alfa.
- Canary / progressive rollout — no aplica con un solo dominio.
- Auto-rollback en Vercel — requiere config previa que no tenemos.

---

## 8. Scope del commit

### IN

**Código**:
- `lib/email/client.ts` (rewrite)
- `lib/email/send.ts` (modify)
- `package.json` + `pnpm-lock.yaml` (add `resend`)

**Tests**:
- `tests/unit/email/send.test.ts` (rewrite mocks)

**DB**:
- `supabase/migrations/NNN_alquilatucarro_resend_sender.sql` (new)

**Env templates**:
- `.env.local.example`, `.env.staging.example` (add `ALQUILATUCARRO_RESEND_API_KEY` placeholder)

**Docs**:
- `docs/specs/2026-04-29-resend-email-migration-design.md` (este archivo)
- `CHANGELOG.md` (entrada `### Changed`)

### OUT (deferred)

| Item | Razón | Cuándo |
|---|---|---|
| Migración alquicarros | Bloqueada en DNS | Cuando admin agregue registros |
| Migración alquilame | Bloqueada en delegación Azure DNS rota | Cuando IT destrabe |
| Borrar `nodemailer` de package.json | Otras 2 franquicias siguen referenciando | Cleanup PR cuando las 3 estén en Resend |
| Borrar 12 env vars `*_MAIL_*` de Vercel | Idem | Cleanup PR final |
| Columna `provider_message_id` en notification_logs | YAGNI | Si operación lo requiere |
| Open/click tracking | No requerido en alfa | Cuando producto madure |
| Webhooks de Resend (bounces/complaints) | No requerido en alfa | Idem |
| E2E tests del flow de email | Fuera de scope alfa | — |

### Branch strategy

1. Crear branch `feat/resend-alquilatucarro-cutover` desde `main`.
2. Commit con todos los cambios del scope IN.
3. Fast-forward merge a `main` localmente.
4. Push `main` directo a GitHub (autorización explícita del usuario, sin PR).

### Commit message preview

```
feat(email): migrate alquilatucarro from SMTP to Resend

- Replace nodemailer transporter with Resend SDK in lib/email/client.ts
- Update sendEmail() to call resend.emails.send with adapted error
  handling (rate_limit_exceeded retry, validation_error fail-fast)
- Add deriveReplyTo() to map subdomain From to apex Reply-To
- DB migration: franchises.sender_email for alquilatucarro is now
  info@mail.alquilatucarro.com (matches verified Resend domain)
- Remove obsolete warnIfFromMismatch (Resend signs with DKIM)

Other 2 franchises (alquicarros, alquilame) throw if invoked; they
have no traffic in alpha. Their migration follows once DNS is fixed.
```

### CHANGELOG entry preview

```markdown
## [Unreleased]

### Changed
- **email**: alquilatucarro now sends via Resend instead of SMTP. From
  changed to `info@mail.alquilatucarro.com` (Reply-To preserves apex).
  Closes the DMARC alignment risk previously flagged in `send.ts`.

### Removed
- **email**: `warnIfFromMismatch` runtime check — obsolete with Resend's
  DKIM signing.
```

---

## TL;DR

Cambia el provider de envío de correos de SMTP (nodemailer) a Resend para alquilatucarro únicamente. La abstracción `sendEmail()` se preserva — los consumidores (notifications.ts, server actions, crons) no se tocan. La DB se actualiza vía migración para que el `sender_email` apunte al subdominio verificado en Resend. Otras franquicias quedan en "no configurado, throw si se invocan" hasta que se resuelvan sus bloqueos de DNS. Rollback: `git revert` + posible `UPDATE` SQL, ~5-10 min recovery.
