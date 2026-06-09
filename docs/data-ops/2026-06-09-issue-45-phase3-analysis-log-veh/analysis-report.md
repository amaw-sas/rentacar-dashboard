# Análisis del histórico de búsquedas legacy (log_veh) — Issue #45 Fase 3

**Fecha:** 2026-06-09
**Fuente:** extracción cruda 1:1 de `log_veh_available_rates_queries` (Fase 2, 664,126 filas, point-in-time).
**Naturaleza:** reporte exploratorio. NO es dato operativo. Insumo para el futuro módulo de análisis. Nada de esto va a `public.search_logs`.

Este documento lleva solo agregados PII-free. La carga se hizo en un MariaDB desechable en `/tmp` (borrado al terminar); las dos columnas con PII —el payload SOAP crudo de la respuesta y la IP de origen— nunca se leyeron como valores. Los códigos de sucursal (Localiza) y de categoría no son PII.

---

## Cómo se hizo

664,126 filas restauradas desde los 27 chunks gzip a un MariaDB local desechable, dos tablas materializadas una sola vez (`search_flat` 1 fila/búsqueda; `cat_quotes` ~3M cotizaciones explotadas con `JSON_TABLE`), y 11 cortes corridos con SQL versionado (`scripts/analysis/log-veh/`). La carga reconcilió exacto: `COUNT(*) == 664,126`. Determinista: dos corridas de las queries dan output idéntico.

`created_at` está en UTC. Colombia es UTC−5, así que las horas locales (COT) restan 5 a las horas UTC de abajo.

## Volumen y profundidad

| Métrica | Valor |
|---|---|
| Búsquedas totales | **664,126** |
| Rango temporal | 2024-05-27 → 2026-05-11 (**715 días**) |
| Promedio | **928.8 búsquedas/día** |
| IPs de origen distintas | **1** |

Dos cosas importan acá. Primero: la pregunta abierta del issue queda respondida —el prune nunca corrió, hay **dos años completos** de histórico, no una ventana de 3 meses. Segundo: hay **una sola** IP de origen en las 664,126 filas. El legacy registraba las llamadas SOAP a Localiza desde el backend, no desde el navegador del usuario, así que la IP guardada es la del servidor y no discrimina nada. Esa columna PII no aporta señal analítica.

## Calidad de los datos

`processed_data` y `request_parameters` se clasificaron fila por fila; ninguna se descartó en silencio. Las dos clasificaciones suman 664,126 exacto.

| `pd_kind` | filas | % |
|---|---|---|
| array (cotizaciones) | 479,402 | 72.19% |
| error (objeto `{error,message}`) | 184,724 | 27.81% |
| malformed | 0 | 0% |
| null | 0 | 0% |

| `rp_kind` | filas | % |
|---|---|---|
| valid (4 campos camelCase) | 664,126 | 100% |
| malformed / null | 0 | 0% |

`request_parameters` está 100% sano —el `CHECK(json_valid)` del schema legacy lo garantizaba en origen. De las 479,402 búsquedas con array de cotizaciones, **8,978 traen un array vacío `[]`** (cotización sin resultados pero sin error explícito): un matiz que el corte de categorías excluye por construcción.

Hay un problema de calidad en las **fechas de pickup**: una cola de búsquedas pide recogida en años imposibles (2027, 2028, 2029, 2031, 2034, 2038 — unas pocas centenas en total más allá de 2026). Son entradas de usuario mal tipeadas, no errores del extractor. No afectan los cortes por fecha de búsqueda (`created_at`, siempre confiable), pero contaminan cualquier corte por fecha de pickup, que habría que filtrar a un rango plausible antes de usar.

## Cortes

### 1 · Distribución de errores de cotización (denominador: todas las filas)

27.81% de las búsquedas no devuelven cotización. El desglose por código (sobre las 184,724 con error):

| código de error | filas | % de errores |
|---|---|---|
| out_of_schedule_pickup_hour_error | 46,962 | 25.42% |
| out_of_schedule_return_hour_error | 40,814 | 22.10% |
| no_available_categories_error | 34,662 | 18.76% |
| inferior_pickup_date | 23,772 | 12.87% |
| same_hour | 19,876 | 10.76% |
| out_of_schedule_return_date_error | 7,064 | 3.82% |
| out_of_schedule_pickup_date_error | 6,662 | 3.61% |
| unknown_error | 1,672 | 0.91% |
| holiday_out_of_schedule_return_date_branch | 1,598 | 0.87% |
| holiday_return_date_branch | 1,155 | 0.63% |
| holiday_pickup_date_branch | 487 | 0.26% |

Casi la mitad de los errores (47.5%) son horarios fuera de schedule de la sucursal (pickup u return). Otro 18.8% es "sin categorías disponibles". `inferior_pickup_date` y `same_hour` (juntos 23.6%) son fechas/horas inválidas que el usuario tipeó.

### 2 · Distribución por sucursal (denominador: rp_kind=valid, NULL=0)

Top sucursales de pickup (sin NULL ni vacío en ninguna fila):

| sucursal | búsquedas pickup |
|---|---|
| AABOT | 63,258 |
| AARME | 47,630 |
| ACMNZ | 42,455 |
| ACIBG | 40,994 |
| ACVLL | 33,234 |
| AAPEI | 33,134 |
| AABCR | 32,138 |
| AACTG | 29,349 |
| AACUC | 26,695 |
| AASMR | 26,691 |

La distribución de return sigue casi exactamente la de pickup (mismo top, diferencias de centenas), consistente con el 92% de round-trips del corte 9. AABOT (Bogotá) domina con ~9.5% de la demanda.

### 3 · Estacionalidad (búsquedas por mes de `created_at`)

| mes | búsquedas | | mes | búsquedas |
|---|---|---|---|---|
| 2024-06 | 26,040 | | 2025-06 | 47,134 |
| 2024-12 | 47,483 | | 2025-12 | 48,566 |
| 2025-01 | 29,887 | | 2026-01 | 34,804 |
| 2025-04 | 37,239 | | 2026-04 | 20,130 |

Patrón claro: **diciembre es el pico** los dos años (47–49k), seguido de mitad de año (junio). Febrero es el valle. Los meses extremos (2024-05 con 4,240, 2026-05 con 5,668) son parciales por los bordes de la extracción.

### 4 · Categorías más buscadas y tasa de disponibilidad (denominador: pd_kind=array = 479,402)

"Disponibilidad" = en cuántas búsquedas con cotización apareció esa categoría:

| código | descripción | búsquedas con la categoría | disponibilidad |
|---|---|---|---|
| G4 | SUV MANUAL | 434,746 | 90.69% |
| F | INTERMEDIARIO MANUAL | 428,454 | 89.37% |
| FX | COMPACTO AUTOMÁTICO | 427,336 | 89.14% |
| C | ECONÔMICO COM AR | 406,584 | 84.81% |
| GC | SUV COMPACTO AUTOMÁTICO | 390,306 | 81.42% |
| LE | SUV ESPECIAL | 307,845 | 64.21% |
| VP | PICK-UP COM AR PLUS | 197,740 | 41.25% |
| GR | SUV ELITE | 86,664 | 18.08% |
| FL | HÍBRIDO | 63,893 | 13.33% |
| FU | AUTOMÁTICO HÍBRIDO | 62,440 | 13.03% |
| GL | SUV HÍBRIDO | 60,352 | 12.59% |
| GY | SUV HÍBRIDO | 57,117 | 11.91% |
| LU | SUV ESPECIAL LIVRE | 29,775 | 6.21% |
| CX | ECONÔMICO COM AR | 14,782 | 3.08% |
| G | SUV COMPACTA | 3,098 | 0.65% |
| LP | SEDAN PRIME | 2,994 | 0.63% |

Cinco categorías (G4, F, FX, C, GC) aparecen en >80% de las cotizaciones —el core de la flota. Los híbridos (FL/FU/GL/GY) rara vez tienen disponibilidad (~12%). Esto cruza con el audit #13: GR, VP, G, LP son códigos legacy fuera del set del destino, y acá se ve que GR/VP sí tienen volumen real (86k / 197k búsquedas), no son residuales.

### 5 · Anticipación de la reserva (lead-time pickup − búsqueda; denominador: rp_kind=valid)

| ventana | búsquedas |
|---|---|
| negativa (pickup en el pasado) | 57,328 |
| < 1 día | 167,263 |
| 1–3 días | 97,496 |
| 3–7 días | 87,521 |
| 7–30 días | 143,425 |
| 30–90 días | 77,121 |
| > 90 días | 33,972 |

La mayoría busca para **muy corto plazo**: 25% para menos de 24h, y un 53% con menos de una semana de anticipación. Las 57k negativas son búsquedas con fecha de pickup anterior al momento de búsqueda (típicamente same-day con hora ya pasada, o fechas mal tipeadas).

### 6 · Duración de la renta (return − pickup; denominador: rp_kind=valid)

| duración | búsquedas |
|---|---|
| no positiva | 19,916 |
| < 1 día | 25,363 |
| 1–3 días | 201,157 |
| 3–7 días | 170,151 |
| 7–14 días | 210,900 |
| 14–30 días | 26,354 |
| > 30 días | 10,282 |
| no parseable / null | 3 |

La renta típica es de **1 a 14 días** (88% del total), con dos modas: 1–3 días (corta, 30%) y 7–14 días (semanal/quincenal, 32%).

### 7 · Hora y día de la búsqueda (denominador: todas las filas)

Pico de búsquedas entre las **13:00 y 20:00 UTC** (08:00–15:00 COT), con el máximo a las 15:00 UTC (10:00 COT, 46,210). El valle es de madrugada local. Por día de semana la distribución es pareja, con **viernes** apenas arriba (105,315) y domingo abajo (72,265).

### 8 · One-way vs round-trip (denominador: rp_kind=valid)

| tipo | búsquedas | % |
|---|---|---|
| round-trip (misma sucursal) | 611,027 | 92.01% |
| one-way (sucursal distinta) | 53,099 | 7.99% |

### 9 · Estado de respuesta (denominador: todas las filas)

| `response_status` | filas | % |
|---|---|---|
| 200 | 661,363 | 99.58% |
| 408 (timeout) | 2,763 | 0.42% |

### 10 · Precio por categoría (denominador: filas de cat_quotes; montos en COP)

Mediana del `total_amount` cotizado por categoría (vía `PERCENTILE_CONT`):

| código | descripción | cotizaciones | mediana COP | promedio COP |
|---|---|---|---|---|
| C | ECONÔMICO COM AR | 406,584 | 660,000 | 735,227 |
| F | INTERMEDIARIO MANUAL | 428,454 | 751,838 | 853,905 |
| FX | COMPACTO AUTOMÁTICO | 427,336 | 900,000 | 1,022,889 |
| GC | SUV COMPACTO AUTOMÁTICO | 390,306 | 1,179,095 | 1,313,755 |
| G4 | SUV MANUAL | 434,746 | 1,269,025 | 1,425,009 |
| VP | PICK-UP COM AR PLUS | 197,740 | 1,289,975 | 1,565,134 |
| LE | SUV ESPECIAL | 307,845 | 1,646,305 | 1,875,865 |
| GR | SUV ELITE | 86,664 | 1,735,245 | 2,156,836 |
| GY | SUV HÍBRIDO | 57,117 | 2,779,995 | 2,927,022 |

El promedio corre bastante por encima de la mediana en todas las categorías —hay una cola larga de cotizaciones caras (rentas largas), con máximos que llegan a decenas de millones. La mediana es la cifra honesta de "cuánto sale" por gama.

## Para llevar

- **Histórico completo de dos años, 664k búsquedas, ~929/día.** Hay profundidad real para el módulo de análisis.
- **28% de las búsquedas fallan la cotización**, y la mitad de esas fallas son horarios fuera de schedule de la sucursal —una palanca de producto clara (validar/comunicar horarios antes de cotizar).
- **Demanda concentrada en 5 gamas** (G4, F, FX, C, GC, >80% disponibilidad) y en **corto plazo** (53% con menos de una semana de anticipación).
- **92% round-trip**, pico de diciembre, búsquedas en horario laboral COT.
- `source_ip` no sirve analíticamente (un solo valor, server-side). Las fechas de pickup tienen basura de input que hay que filtrar antes de cualquier corte por fecha de pickup.

## Reproducir

```
scripts/analysis/log-veh/run-analysis.sh          # provision → load → materialize → queries → teardown
```
La DB desechable vive en `/tmp/log-veh-analysis-db/` y se borra al terminar. El archivo de entrada (27 chunks gz + manifest) está en el worktree de Fase 2, gitignored. Las queries (`materialize.sql`, `analysis-queries.sql`) son PII-free y versionadas.
