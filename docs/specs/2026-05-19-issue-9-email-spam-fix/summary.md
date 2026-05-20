# Planning Summary — Issue #9 Email Spam Fix

**Date**: 2026-05-19
**Goal**: Eliminar la causa raíz del aterrizaje en spam en Hotmail/Outlook — el `<img src>` del logo apuntando a Vercel Blob (mismatch con el sending domain) — embebiendo el logo como attachment CID inline.

## Artifacts Created

| Artifact | Path | Purpose |
|---|---|---|
| Design spec | `docs/specs/2026-05-19-issue-9-email-spam-fix-design.md` | Arquitectura, componentes, data flow, error handling, scenarios. Aprobado por spec-reviewer en iter 2. |
| Scenarios (holdout contract) | `docs/specs/2026-05-19-issue-9-email-spam-fix/scenarios/email-spam-fix.scenarios.md` | 10 scenarios automatizables + 5 manuales. Define "done". |
| Implementation plan | `docs/specs/2026-05-19-issue-9-email-spam-fix-plan.md` | 7 pasos con acceptance criteria. Aprobado por plan-reviewer en iter 1. |

## Key Decisions

1. **CID attachment over external URL** — embedido en el cuerpo MIME elimina la dependencia de dominio externo y resuelve el warning de Resend directamente. Cero infra nueva.
2. **Mantener `franchises.logo_url` como source-of-truth editable** — el admin sigue subiendo logos vía `<ImageUpload>` a Vercel Blob; el fetch al armar el email convierte la URL en attachment en runtime. Sin cambio de schema.
3. **SSRF defense via host allowlist con dot-boundary match** — exact-equal o `endsWith("." + h)` para evitar el bypass `evil-alquilatucarro.com`. 4 hosts permitidos (`public.blob.vercel-storage.com` + 3 apex de franquicia).
4. **Fail-closed → fallback** — todas las fallas (parse, host, HTTP, timeout, content-type, size >100KB) devuelven `null` y el layout renderiza el nombre con color de marca. Cliente nunca pierde el email por un problema cosmético.
5. **1 fetch por invocación de `sendReservationNotifications`** — el helper privado `prepareLogoForEmail` se invoca una vez antes del switch por status; el mismo Buffer + Content-ID se propaga a los 1–4 emails que dispara una reserva. Object identity verificable en SCEN-07.
6. **Context7 first** — el shape exacto del SDK Resend (`contentId` vs `content_id`, `Buffer` vs base64) se verifica en Step 1 antes de declarar tipos.

## Complexity Estimate

- **Overall**: M (medium)
- **Duration**: 4–6 horas de implementación + 1–2 horas de smoke/PR
- **Risk Level**: Low
  - Reversibilidad: total (revert del PR; sin DB/DNS/env vars).
  - Blast radius: 3 archivos modificados, 1 nuevo, 1 test nuevo, 2 tests editados.
  - Graceful degradation built-in para todas las fallas.

## Recommended Next Steps

1. **Iniciar Step 1** del plan: invocar Context7 para resolver el shape de `attachments` en el SDK Resend.
2. **Commitear scenarios + plan** en el worktree `fix/issue-9-email-spam-cid` antes de tocar código (SDD Iron Law: scenarios precede code).
3. **Invocar `/scenario-driven-development`** con los scenarios como holdout — el skill orquesta cada Step con SCENARIO → SATISFY → REFACTOR + Quality Integration.
4. Tras `pnpm test && type-check && lint && build` (Step 5), correr el smoke pre-PR (Step 6) y crear el PR vía `/pull-request` skill (Step 7).

## Open Questions

Ninguna bloqueante. Las únicas decisiones quedan en manos del SDK Resend (Step 1 las cierra antes de tocar tipos):
- Casing de `contentId` (anticipado pero confirmable solo vía Context7).
- Tipo del field `content` (anticipado `Buffer`, confirmable solo vía Context7).
