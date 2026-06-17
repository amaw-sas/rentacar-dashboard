# Issue #138 — Idempotencia DB-backed en el dashboard

**Fecha:** 2026-06-17
**Issue:** #138 — `Idempotencia DB-backed en el dashboard: deduplicar fila + notificaciones en resubmit (follow-up #99)`
**Alcance:** dashboard (`lib/api/reservation-service.ts`, `lib/api/resolve-references.ts`) + una migración. Cero cambio de datos, cero borrado.

## Problema

#99 endureció la cadena de creación de reservas contra duplicados **en Localiza**: el proxy deduplica la llamada SOAP (in-flight coalescing + replay TTL por fingerprint del booking), así que un reload+resubmit ya no crea una segunda reserva en Localiza.

La idempotencia **se detiene en el proxy**. Tras recibir el `reserveCode` —incluso uno deduplicado o replayed— `createReservation()` inserta la fila y dispara notificaciones **sin condición**:

```
proxy devuelve reserveCode (puede ser el MISMO en un resubmit, gracias a #99)
  → reservation-service.ts:289  INSERT incondicional
  → reservation-service.ts:360  email inline + WhatsApp + GHL en after()
```

`reservations.reservation_code` es `nullable` y **no único** (`008_reservations.sql:13`). Nada impide dos filas con el mismo code.

### Síntoma observable

Un reload+resubmit —o dos instancias de Vercel Fluid Compute corriendo en paralelo— produce:

- ✅ **1 sola** reserva en Localiza (lo arregla #99).
- ❌ **2 filas** en `reservations` con el mismo `reservation_code`.
- ❌ **2 tandas** de notificaciones al cliente (email + WhatsApp + GHL ×2).

No es regresión —antes de #99 eran dos de todo, incluida la reserva en Localiza— pero la doble notificación la ve el cliente.

### Por qué no se resolvió en #99

El dedupe del proxy es un mapa en memoria de una instancia única (Railway). El dashboard corre **multi-instancia** (Fluid Compute): un dedupe en memoria ahí no sirve cross-instancia. Cerrar esto exige una guarda **respaldada en Postgres**, que es la única autoridad compartida entre instancias.

## Decisiones cerradas en brainstorming

1. **La llave de dedupe es `reservation_code`, no un fingerprint.** Dos reservas legítimas distintas reciben dos ConfID distintos de Localiza, así que el índice nunca las funde. Solo colisiona cuando vuelve el **mismo** code, que es exactamente el caso de resubmit (el proxy de #99 lo replaya). Un cliente que hace varias reservas reales seguidas está a salvo.
2. **El índice excluye el string vacío**, no solo `NULL`. Coherente con #99 ("no cachear reserveCode vacío"). Si Localiza devolviera `''` para dos bookings reales, ambos deben insertar; un `''` indexado los fundiría por error.
3. **Cutoff `created_at >= '2026-01-01'` para grandfatherear el histórico legacy.** Prod tiene 49 pares de codes duplicados, **100% legacy** (ETL #20, `created_at` 2024-04 → 2025-12-06). La partición 2026+ tiene **cero** duplicados (verificado). No se borra ni un registro.
4. **`findOrCreateCustomer` entra en el mismo PR.** Es el TOCTOU gemelo (camino de escritura de cliente nuevo) y la rampa directa al problema.
5. **Mensualidades fuera de alcance.** Tienen `reservation_code = NULL`, no llaman Localiza, y el índice no las cubre. Su dedupe necesitaría otro mecanismo (fingerprint); no es el incidente. Queda anotado.

### Por qué no limpiamos los 49 pares legacy

De los 49 pares: ~4 son codes basura compartidos entre personas **distintas** (p. ej. `ABCD1234`, o `LOCALIZADOR DE LA RESERVA:` —la etiqueta del campo capturada como valor); ~25 son el **mismo** cliente con reservas realmente distintas (fechas/precio/categoría diferentes); solo ~15 son filas idénticas. Borrar los Tipos 1 y 2 destruiría historia real, y ni los idénticos los creamos nosotros (son del ETL). El cutoff los excluye del índice sin tocarlos. Limpiar histórico legacy, si alguna vez se quiere, es un data-ops aparte con backup y dry-run — no parte de #138.

## Arquitectura — Postgres como árbitro cross-instancia

```
instancia A                          instancia B (resubmit / paralelo)
  INSERT reservation_code=K  ──┐       INSERT reservation_code=K
  (commit, gana)               │         └── viola índice único parcial
  → notifica                   │             → 23505
                               │             → catch: NO inserta, NO notifica
                               └──────────────→ return {reserveCode:K, status} (idéntico)
```

El índice único parcial es la **única** sincronización que funciona entre instancias de Fluid Compute. La memoria no, los locks de aplicación no. La carrera la resuelve Postgres: el segundo `INSERT` se bloquea hasta que el primero commitea y luego recibe `23505`.

## Componentes

### 1. Migración `062` — índice único parcial (solo DDL)

```sql
-- supabase/migrations/<timestamp>_062_reservations_reservation_code_unique.sql
create unique index reservations_reservation_code_unique
  on public.reservations (reservation_code)
  where reservation_code is not null
    and reservation_code <> ''
    and created_at >= '2026-01-01';
```

- Construye instantáneo: la partición 2026+ es chica y está verificada sin duplicados.
- No se usa `CONCURRENTLY` (innecesario para esta partición y `apply_migration` corre en transacción).
- Se aplica a prod por **MCP `apply_migration`**, nunca `db push` (arrastra los drops 049/051 — memoria `feedback_supabase_migration_naming` / incidente #133).
- Tras aplicar: regenerar `lib/types/database.ts` no aplica (un índice no cambia tipos); igual ese archivo es vestigial (memoria `reference_db_types_vestigial_untyped_clients`).

### 2. Insert idempotente — `lib/api/reservation-service.ts`

En `createReservation`, el bloque de insert (líneas 289-347):

- Detecta `insertError.code === '23505'` **y** que el mensaje refiera a `reservations_reservation_code_unique` (cualquier otro `23505` → `ServiceError(500)`, no se enmascara).
- **Campo exacto del match:** el `PostgrestError` de supabase-js expone `code`, `message`, `details`, `hint` — **no** un campo `constraint` limpio. El nombre del índice aparece en `message` (`duplicate key value violates unique constraint "reservations_reservation_code_unique"`). La implementación matchea `code === '23505' && message.includes('reservations_reservation_code_unique')`, y el mock del test usa **ese mismo campo** (`message`), no un `constraint` que puede no existir (SCEN-A/E).
- En ese caso: **return temprano** `{ reserveCode, reservationStatus: status }` — valores ya computados, idénticos a los de la fila ganadora— y **se salta** el bloque de notificaciones (líneas 354-379). No hace falta re-SELECT.
- **Sobre la igualdad de `status`:** descansa en que el replay de #99 devuelva el **mismo payload** del proxy (mismo `reserveCode` ⇒ misma reserva ⇒ mismo `reservationStatus` mapeado). #99 garantiza el mismo code; el mismo status es consecuencia, no una garantía independiente. Riesgo bajo (misma reserva → mismo estado); se documenta el supuesto.
- El happy path queda intacto.

### 3. `findOrCreateCustomer` find-after-conflict — `lib/api/resolve-references.ts`

El flujo actual `SELECT → (si no existe) INSERT → throw genérico en error` gana una rama:

- Si el `INSERT` falla con `23505` en `customers_identification_number_key`, re-SELECT por `identification_number` y devolver el id existente **sin escribir** (respeta #25: nunca mutar un customer desde input de booking).
- Cualquier otro error sigue lanzando como hoy.

Esto vuelve atómico el camino de cliente nuevo concurrente: hoy uno de los dos requests cae a un 500 genérico.

**`identification_number` es la ÚNICA constraint UNIQUE de `customers`** (verificado en prod: solo `customers_identification_number_key` + la PK; `customers_email_key` se eliminó en migración 030, los emails pueden repetirse). Por eso el find-after-conflict sobre `identification_number` cubre el caso completo — no hay un segundo camino de colisión (p. ej. por email) que tratar.

## Escenarios observables (holdout SDD)

| ID | Given | When | Then |
|----|-------|------|------|
| **SCEN-A** dedupe fila | un booking con code `K` ya insertado (2026+) | llega un 2º insert con el mismo `K` (resubmit / 2ª instancia) | 1 sola fila; **0 notificaciones nuevas**; respuesta `{reserveCode:K, status}` idéntica |
| **SCEN-B** no falso merge | dos bookings con codes **distintos** en <60s | ambos insertan | **2 filas**; ambas notifican |
| **SCEN-C** code vacío | dos filas con `reservation_code=''` | ambas insertan | **2 filas** (el predicado excluye `''`) |
| **SCEN-D** cliente concurrente | dos requests de cliente **nuevo** idéntico en paralelo | uno gana el INSERT, el otro choca | 1 customer; el 2º recupera el id; **sin 500, sin escritura** |
| **SCEN-E** otros 23505 no se enmascaran | un `INSERT` viola **otra** constraint (no la del code) | `createReservation` la maneja | `ServiceError(500)`, **no** se trata como replay |
| **SCEN-F** legacy intacto | la migración corre sobre prod con 49 pares legacy duplicados | `CREATE UNIQUE INDEX` | éxito; 0 filas borradas/modificadas |

## Estrategia de satisfacción (testing)

- **Unit (vitest)** en `tests/unit/api/reservation-service.test.ts` y `resolve-references.test.ts`: mockear el cliente de Supabase para que el `.insert()` devuelva `{ error: { code: '23505', message: '...reservation_code_unique...' } }` (SCEN-A/E) o un `23505` de otra constraint (SCEN-E), y verificar que las notificaciones (`sendReservationNotifications`, `sendStatusWhatsApp`, `syncReservationToGhl`) **no** se llaman en el replay. SCEN-D análogo sobre `findOrCreateCustomer`.
- **SCEN-C/B** se cubren a nivel lógica del predicado (no se puede crear el índice en jsdom): test del valor del code que entra al insert + un test SQL de la migración documentado en el plan.
- **SCEN-F**: verificación contra prod vía MCP **antes** de aplicar (ya hecho: 0 dups en 2026+) y confirmación post-`apply_migration`.
- **Concurrencia real vs. mock**: los mocks de Supabase validan la **lógica de rama** (qué pasa al recibir un `23505`), no el ordenamiento TOCTOU real. La atomicidad efectiva de SCEN-A/D solo es demostrable en la capa SQL/integración (el índice no se puede construir en jsdom). Por eso SCEN-F (índice sobre prod) y la verificación post-`apply_migration` no son opcionales: cierran lo que el unit no puede.
- **Red verificado primero**: cada test debe fallar contra el código actual (insert incondicional / throw genérico) antes de implementar.
- Gates CI: `build` / `type-check` / `lint` / `test` exit 0. Quality gate de 4 agentes (security, performance, code, edge-case) como en #99.

## Blast radius

**Archivos modificados:**
- `lib/api/reservation-service.ts` — rama `23505` en el insert + skip de notificaciones.
- `lib/api/resolve-references.ts` — find-after-conflict en `findOrCreateCustomer`.
- `supabase/migrations/<ts>_062_*.sql` — índice nuevo.
- Tests en `tests/unit/api/`.

**Consumidores de `createReservation` / `POST /api/reservations`:** los dos funnels activos (rentacar-web y rentacar-reservas — memoria `reference_two_active_funnels_double_blast_radius`) y el endpoint MCP en construcción (#72). El contrato de respuesta **no cambia**: el replay devuelve el mismo `{reserveCode, reservationStatus}` que un éxito. Ningún funnel necesita cambios.

**`findOrCreateCustomer`:** lo usan `reservation-service.ts` y los tests. El cambio solo convierte un 500 en un éxito idempotente; ningún caller ve un contrato distinto.

**Schema:** un índice parcial nuevo. No toca columnas, RLS, ni otros índices. El `idx_reservations_reservation_code` no-único (008) y el GIN trigram (059) conviven sin conflicto.

## Fuera de alcance

- **Mensualidades** (`reservation_code` null): sin dedupe DB; necesitarían fingerprint. Anotado, no construido.
- **SCEN-2 de #99** (reconciliación del fantasma en 504): sigue requiriendo búsqueda por referencia en Localiza, aún no confirmada.
- **SCEN-4 de #99** (submit-guard del frontend): repo Nuxt `rentacar-reserva`.
- **Limpieza del histórico legacy**: data-ops separado, no necesario para #138.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| El índice falla por duplicados legacy | Cutoff `2026-01-01`; partición 2026+ verificada con 0 dups antes de aplicar |
| `23505` de otra constraint tratado como replay | Match explícito por nombre de constraint `reservations_reservation_code_unique` (SCEN-E) |
| Code vacío fundiría bookings reales | Predicado excluye `reservation_code <> ''` (SCEN-C) |
| Deploy code antes que schema | El catch del `23505` es inerte si el índice no existe (nunca dispara). Orden seguro: migración a prod (MCP) → merge del código. Si un resubmit cae en la ventana, da 500 (seguro, sin duplicado) |
| Legacy con `created_at` en 2026 compartiendo code con uno nuevo | Verificado: el último dup legacy es 2025-12-06; 2026+ sin dups |

## Referencias

- Issue #99 (PR #139 merged): idempotencia proxy + timeouts — la base sobre la que se construye esto.
- Memorias: `issue_99_idempotency_timeouts_pr139`, `incident_reservation_slow_504_double_submit_2026_06_04`, `incident_customer_record_mutation_2026_05_12`, `feedback_findorcreate_no_mutate`, `reference_two_active_funnels_double_blast_radius`, `feedback_prefer_automated_migrations`.
- Código: `lib/api/reservation-service.ts`, `lib/api/resolve-references.ts`, `supabase/migrations/008_reservations.sql`, `007_customers.sql`.
