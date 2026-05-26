# Runbook — Scrub de PII del history de git (issue #62, Fase 2)

> **Estado:** PENDIENTE de autorización de Pablo. Operación destructiva (reescribe history + `push --force`).
> **Fase 1 ya aplicada:** PR que añade `.gitignore` + `git rm --cached` de los 6 backups. Saca la PII del HEAD, **no del history**.
> Este runbook completa la remediación borrando la PII del history para siempre.

## Qué se borra

Los 6 dumps con PII (cédula, phone, email, contenido de mensajes), introducidos en **un solo commit**: `3eefe43`.

```
docs/data-ops/2026-05-14-prueba-operator-cleanup/customers-backup.json
docs/data-ops/2026-05-14-prueba-operator-cleanup/notification-logs-backup.json
docs/data-ops/2026-05-14-prueba-operator-cleanup/reservations-backup.json
docs/data-ops/2026-05-14-test-reservations-cancel/customers-backup.json
docs/data-ops/2026-05-14-test-reservations-cancel/notification-logs-backup.json
docs/data-ops/2026-05-14-test-reservations-cancel/reservations-backup.json
```

**Se conservan:** `rollback.sql` (solo UUIDs, sin PII) y los `*.md`.

## Blast radius

> Recalculado el 2026-05-26. La versión previa de este runbook quedó desactualizada (decía 80 commits y 5 ramas).

- `3eefe43` está a **95 commits de HEAD**. Reescribir history → esos 95 commits reciben SHA nuevo.
- **2 ramas remotas contienen `3eefe43`** y deben tratarse:
  - `origin/main` — reescribir (obligatorio).
  - `origin/feat/reservations-date-range-filter` — PR #34 ya mergeada → **borrar**.
- Las otras 3 ramas que listaba la versión previa (`fix/wati-notification-order-issue-60`, `worktree-issue-17-legacy-categories`, `worktree-issue-47-rerun-backfill`) ya no existen en remoto. **Re-verificar con `git branch -r --contains 3eefe43` justo antes de ejecutar.**
- Las ramas remotas restantes (`feat/data-table-url-state`, `feat/free-status-transitions`, `railway/code-change-*`) **no** contienen `3eefe43` → no reintroducen PII al mergear.
- Tras el force-push, **todos los colaboradores re-clonan** (o `git reset --hard`). Cualquier rama local no reescrita reintroduce la PII al re-mergear.

## Pre-requisitos

```bash
# git-filter-repo NO está instalado (verificado 2026-05-26). Instalar:
pip install git-filter-repo        # o: brew install git-filter-repo
git filter-repo --version          # confirmar
```

## Orden de ejecución

1. **Mergear primero la PR de Fase 1**. Así el HEAD ya no tiene los archivos antes del scrub.
2. **Re-verificar el blast radius** (puede haber cambiado desde 2026-05-26):
   ```bash
   git rev-list --count 3eefe43..origin/main     # distancia a HEAD
   git branch -r --contains 3eefe43              # ramas a reescribir/borrar
   ```
3. Borrar las ramas remotas stale ya mergeadas que contengan `3eefe43` (evita reintroducir PII y reduce refs a reescribir). Hoy es solo una:
   ```bash
   git push origin --delete feat/reservations-date-range-filter
   ```
4. **Clon fresco** (filter-repo exige un repo limpio y reescribe todas las refs locales):
   ```bash
   cd /tmp && git clone git@github.com:amaw-sas/rentacar-dashboard.git scrub && cd scrub
   ```
5. **Scrub** — borrar los 6 paths de todo el history:
   ```bash
   git filter-repo --invert-paths \
     --path docs/data-ops/2026-05-14-prueba-operator-cleanup/customers-backup.json \
     --path docs/data-ops/2026-05-14-prueba-operator-cleanup/notification-logs-backup.json \
     --path docs/data-ops/2026-05-14-prueba-operator-cleanup/reservations-backup.json \
     --path docs/data-ops/2026-05-14-test-reservations-cancel/customers-backup.json \
     --path docs/data-ops/2026-05-14-test-reservations-cancel/notification-logs-backup.json \
     --path docs/data-ops/2026-05-14-test-reservations-cancel/reservations-backup.json
   ```
6. **Verificar que el history quedó limpio.** El check por objetos es el autoritativo (no depende de pathspec, robusto ante renames en history) y debe imprimir `OK`:
   ```bash
   git rev-list --all --objects | grep -E 'data-ops/2026-05-14.*backup\.json' || echo "OK: sin objetos PII"
   git log --all --full-history --oneline -- 'docs/data-ops/2026-05-14-*/*-backup.json'   # complementario; debe imprimir nada
   ```
7. **Re-añadir remote y force-push** (filter-repo elimina `origin` por seguridad):
   ```bash
   git remote add origin git@github.com:amaw-sas/rentacar-dashboard.git
   git push origin --force --all
   git push origin --force --tags
   ```

## Post-scrub

- **Avisar al equipo**: re-clonar o `git fetch && git reset --hard origin/<rama>`. Las refs locales viejas reintroducen la PII si se mergean.
- **Cache de GitHub**: tras el force-push, los SHAs viejos siguen accesibles por URL directa y en eventos/diffs de PRs hasta el GC. Para purga total, abrir ticket a **GitHub Support** pidiendo expirar refs no alcanzables y correr `gc`.
- **Worktrees y ramas locales de devs** que contengan `3eefe43` deben borrarse y recrearse.

## Fuera de alcance (decisión legal, no técnica)

De los 40 customers, ~32 están en dominios reales → aplica **Ley 1581 (Habeas Data)**. La evaluación de si corresponde notificar a los titulares es decisión de Pablo/legal, separada de este scrub técnico.
