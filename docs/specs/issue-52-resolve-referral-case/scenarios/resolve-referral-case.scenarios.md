---
name: resolve-referral-case
created_by: claude
created_at: 2026-05-20T00:00:00Z
issue: 52
parent_audit: 13
related: [46, 47]
---

# Issue #52 — `resolveReferral` case-insensitivity para detener re-acumulación de `referral_raw`

Fix one-liner en `lib/api/resolve-references.ts:resolveReferral`. rentacar-web POSTea `body.user='Diana'` o `'Daniela'` (capitalizado); `referrals.code` se mantiene lowercase por convención (verificado en prod: 5/5 codes lowercase). El query case-sensitive `.eq("code", code)` falla el match y la reserva cae a `referral_raw='Diana'` con `referral_id=NULL` — exactamente la condición que el backfill #47 limpia. Sin este fix, el backlog #47 se re-acumula con cada nueva reserva vía rentacar-web.

Cambio: normalizar `code.trim().toLowerCase()` antes del query. Observable: el caller (`app/api/reservations/route.ts:146`) pasa de devolver `null` a devolver el `referral_id` correcto para inputs capitalizados; las reservas dejan de quedarse en estado split-brain.

Cobertura: unit tests aislados con mock de `createAdminClient`, validando que el código pasado a `.eq("code", …)` es siempre lowercase trimmed.

---

## SCEN-001: nombre capitalizado matchea referral activo

**Given**: `public.referrals` contiene `code='diana'` con `status='active'` (seedeado por migración 043).
**When**: `resolveReferral('Diana')` se invoca (input típico de rentacar-web `body.user`).
**Then**: retorna el `id` de Diana. La query Supabase recibe `.eq("code", "diana")`.

**Evidence**: test `returns referral id for capitalized active code ('Diana')` en `tests/unit/api/resolve-references.test.ts`. Spy `codeEq` verificado contra `"code", "diana"`.

## SCEN-002: nombre ya en lowercase mantiene comportamiento

**Given**: mismo estado.
**When**: `resolveReferral('diana')` se invoca.
**Then**: retorna el `id` de Diana. La query Supabase recibe `.eq("code", "diana")`.

Razón observable: garantiza que la normalización no rompe el path que ya funcionaba (todos los inputs lowercase actualmente exitosos siguen siendo exitosos).

**Evidence**: test `returns referral id for already-lowercase code ('diana')`.

## SCEN-003: trim de whitespace y lowercase combinado

**Given**: mismo estado.
**When**: `resolveReferral(' DIANA ')` se invoca (input degenerado con padding + uppercase).
**Then**: retorna el `id` de Diana. La query Supabase recibe `.eq("code", "diana")`.

**Evidence**: test `trims whitespace and lowercases (' DIANA ')`.

## SCEN-004: referral inactivo no resuelve

**Given**: `public.referrals` contiene `code='valeria'` con `status='inactive'` (Valeria salió de la empresa; atribución histórica preservada via #47).
**When**: `resolveReferral('Valeria')` se invoca.
**Then**: retorna `null`. La query Supabase recibe `.eq("code", "valeria")` y `.eq("status", "active")` — el filtro de status excluye la fila inactiva.

Razón observable: el fix de case-insensitivity no debe revivir atribución a referrals retirados. La memoria de atribución (referral_id en reservas pasadas) sigue intacta; futuras reservas con `?user=Valeria` caen al path `referral_raw` correctamente.

**Evidence**: test `returns null for inactive referral ('Valeria' filtered by status)`.

## SCEN-005: code inexistente retorna null

**Given**: `public.referrals` no contiene una fila con `code='nonexistent'`.
**When**: `resolveReferral('nonexistent')` se invoca.
**Then**: retorna `null`.

Razón observable: comportamiento pre-existente preservado. El caller (`app/api/reservations/route.ts:146`) sigue cayendo al path `referral_raw = body.user` cuando no hay match, manteniendo el audit trail crudo del input.

**Evidence**: test `returns null for nonexistent code`.

---

## Out-of-scope (registrado para referencia)

- **CHECK constraint `code = lower(code)`** en schema `006_referrals.sql`: defensa en profundidad. La invariante "todos los codes lowercase" sigue dependiendo de convención app-side. Si futuro código inserta capitalizado vía MCP/admin, el bug regresa silenciosamente. Issue separado si se prioriza.
- **`findOrCreateCustomer` mutation** (`lib/api/resolve-references.ts:50-76`): muta records existentes al detectar diferencias contra `body`, contradiciendo regla "find-or-create endpoints públicos NUNCA mutar" (memoria `feedback_findorcreate_no_mutate.md`, incidente 2026-05-12). Vector distinto al de #52 pero coexiste en el mismo archivo — debe abordarse en issue propio.
