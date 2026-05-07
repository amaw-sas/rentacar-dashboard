# Tarifas Mensuales Localiza 2026

> **Fuente**: correo de Juan Esteban Castrillon Builes (Asistente Comercial Localiza, Renting Colombia) `Jcastrillonb@rentingcolombia.com`, asunto *"Tarifas Mensuales PN Y TRAVEL 2026"*, fecha **2026-03-18**, reenviado por Alquilame el 2026-03-18 17:47.
> Archivo PDF: `/tmp/tarifas2026-1.pdf` (3 páginas, 977 KB).
>
> Tarifas **PN (Persona Natural) y TRAVEL** — vigencia abril a diciembre 2026.
> **Todas las tarifas incluyen IVA** (declaración explícita del proveedor).

## 1. Mapa de estacionalidad 2026 (abr–dic)

| Mes | Temporada |
|---|---|
| Abril | Alta |
| Mayo | Baja |
| Junio | Alta |
| Julio | Alta |
| Agosto | Baja |
| Septiembre | Baja |
| Octubre | Alta |
| Noviembre | Baja |
| Diciembre | Alta |

5 meses en alta (abr, jun, jul, oct, dic), 4 en baja (may, ago, sep, nov).

## 2. Estructura de columnas

El proveedor presenta 2 columnas por temporada:

- **Tarifa PN — 1k**: precio mensual con cupo de 1 000 km/mes → mapea a `category_pricing.monthly_1k_price`.
- **Tarifa Final — 2k**: precio mensual con cupo de 2 000 km/mes → mapea a `category_pricing.monthly_2k_price`.

Convención del proyecto: `monthly_3k_price` se llena con el mismo valor que `monthly_2k_price` (ver migración `026_seasonal_pricing_2026.sql`).

## 3. Política operador: "Libre PYP" no se alquila por mensualidad

**Instrucción operador (2026-05-07)**: las gamas con etiqueta "Libre PYP" (exentas de pico y placa) **no se ofrecen para alquiler mensual** al público. Aplica a:

| Gama | Equivalente base | Suffix rule |
|---|---|---|
| **FL** | F (Libre PYP) | sufijo `L` |
| **FU** | FX (Libre PYP) | sufijo `U` |
| **GL** | GC (Libre PYP) | sufijo `L` |
| **LU** | LE (Libre PYP) | sufijo `U` |

Regla canónica: cualquier gama Localiza con sufijo `L` o `U` es variante Libre PYP de la gama base (`docs/localiza/proceso-actualizacion-flota.md:20`). Las 4 gamas activas con este patrón están enumeradas arriba.

**Implicación en BD**: los 5 campos `monthly_*_price` de `category_pricing` deben quedar `NULL` para FL, FU, GL, LU. Solo `total_coverage_unit_charge` (Seguro Total/día) conserva valor.

## 4. Tarifa Temporada Baja 2026 (mayo, agosto, septiembre, noviembre)

| Gama | 1k (PN) | 2k (Final) |
|---|---:|---:|
| C  | 3.806.000 | 4.252.000 |
| CX | 4.166.000 | 4.613.000 |
| F  | 4.527.000 | 4.974.000 |
| FX | 4.676.000 | 5.124.000 |
| FL¹ | *(no aplica — Libre PYP)* | *(no aplica — Libre PYP)* |
| FU¹ | *(no aplica — Libre PYP)* | *(no aplica — Libre PYP)* |
| GC | 6.017.000 | 6.670.000 |
| G4 | 6.544.000 | 7.197.000 |
| GL¹ | *(no aplica — Libre PYP)* | *(no aplica — Libre PYP)* |
| LE | 7.071.000 | 8.435.000 |
| LU¹ | *(no aplica — Libre PYP)* | *(no aplica — Libre PYP)* |
| GY | 15.471.000 | 16.836.000 |

¹ Ver sección 3. Los precios del PDF para Libre PYP (FL 5.685k/6.132k, FU 6.005k/6.453k, GL 6.911k/7.564k, LU 7.568k/8.933k baja) **no se cargan en BD**.

## 5. Tarifa Temporada Alta 2026 (abril, junio, julio, octubre, diciembre)

| Gama | 1k (PN) | 2k (Final) |
|---|---:|---:|
| C  | 4.149.000 | 4.635.000 |
| CX | 4.542.000 | 5.029.000 |
| F  | 4.935.000 | 5.423.000 |
| FX | 5.097.000 | 5.585.000 |
| FL¹ | *(no aplica — Libre PYP)* | *(no aplica — Libre PYP)* |
| FU¹ | *(no aplica — Libre PYP)* | *(no aplica — Libre PYP)* |
| GC | 6.560.000 | 7.271.000 |
| G4 | 7.134.000 | 7.846.000 |
| GL¹ | *(no aplica — Libre PYP)* | *(no aplica — Libre PYP)* |
| LE | 7.709.000 | 9.196.000 |
| LU¹ | *(no aplica — Libre PYP)* | *(no aplica — Libre PYP)* |
| GY | 16.864.000 | 18.351.000 |

¹ Ver sección 3. Precios PDF para Libre PYP en alta (FL 6.197k/6.685k, FU 6.546k/7.034k, GL 7.534k/8.245k, LU 8.206k/9.693k) **no se cargan en BD**.

## 6. Gamas excluidas del catálogo público

Dos gamas adicionales del PDF **no se cargan**:

| Gama | Motivo de exclusión | `vehicle_categories.status` |
|---|---|---|
| GR | Descontinuado por el operador | `inactive` |
| VP | No se ofrece al público | `inactive` |

Ambas tienen ya `status='inactive'` en BD (verificado 2026-05-07). Sus tarifas del PDF se ignoran.

## 7. Estado actual en BD vs estado objetivo

Verificación en `category_pricing` (2026-05-07, rango 2026-04-01..12-31, `status='active'`):

| Gama | Activa | Filas 2026 | `monthly_1k` actual | Acción requerida |
|---|---|---:|---|---|
| C, CX, F, FX, GC, G4, LE, GY | sí | 9 cada una | valores correctos | **ninguna** |
| **FL** | sí | 9 | 6.197.000 / 5.685.000 | **CORREGIR**: setear `monthly_*` a `NULL` |
| **FU** | sí | 9 | 6.546.000 / 6.005.000 | **CORREGIR**: setear `monthly_*` a `NULL` |
| **GL** | sí | 9 | 7.534.000 / 6.911.000 | **CORREGIR**: setear `monthly_*` a `NULL` |
| **LU** | sí | 0 | — | **INSERTAR** con `monthly_*` = `NULL` |
| GR, VP, G, GX, LP, LY | no (`inactive`) | 0 | — | ninguna |

**Bug en producción**: rentacar-web está mostrando precios mensuales para FL, FU, GL — gamas que el operador no ofrece para mensualidad. Las 27 filas (3 gamas × 9 meses) requieren corrección. La cache del sitio público es 1 h (ver `reference_rentacar_web_data_endpoint.md`), así que el fix se propaga en ≤1 h tras la migración.

## 8. Soporte del esquema para "sin mensualidad"

Schema y stack ya soportan el patrón NULL:

- `category_pricing.monthly_1k_price`/`2k`/`3k`/`insurance`/`one_day` → todas **NULLABLE** (`supabase/migrations/005_category_pricing.sql:5-9`).
- Validación Zod permite `null` (`lib/schemas/category-pricing.ts:6-10`).
- Action normaliza `''` → `null` (`lib/actions/category-pricing.ts:14-15, 47-48`).
- Tabla del dashboard muestra `"—"` para campos null (`components/layout/category-pricing-table.tsx:28-30`).

No hay precedente *aplicado* en BD (todas las filas existentes tienen valores no-null). Esta migración establece el patrón para las 4 gamas Libre PYP.

## 9. Datos consolidados de la migración

| Gama | `total_coverage_unit_charge` | `monthly_*_price` | Filas a generar |
|---|---:|---|---|
| FL | **77.000** *(actual; ver `029_fix_total_coverage_unit_charge.sql`)* | `NULL` | corrección |
| FU | **77.000** *(actual)* | `NULL` | corrección |
| GL | **99.000** *(actual)* | `NULL` | corrección |
| LU | **102.000** *(confirmado operador)* | `NULL` | nueva |

### 9.1. Decisión de diseño: 1 fila vs 9 filas por gama Libre PYP

Las gamas Libre PYP no varían por temporada al carecer de tarifa mensual. Dos opciones:

- **Opción A — 1 fila por gama** (`valid_from='2026-04-01'`, `valid_until='2026-12-31'`): refleja la realidad (sin variación estacional), reduce 36 filas (9 × 4 gamas) a 4. Requiere `DELETE` previo de las 27 filas existentes en FL/FU/GL.
- **Opción B — 9 filas por gama** (una por mes): mantiene paridad con el patrón de `026`. Requiere `UPDATE` de las 27 existentes + `INSERT` de 9 para LU.

**Recomendación**: Opción A. Más simple, refleja la regla de negocio explícitamente, evita duplicación de filas idénticas. El consumidor selecciona por `category_id + date BETWEEN valid_from AND valid_until` y funciona en ambos casos.

## 10. Próximos pasos

1. Emitir migración `<timestamp>_NNN_localiza_2026_libre_pyp_no_monthly.sql` con bloque `DO $$ ... END $$`:
   - Lookup de `category_id` para FL, FU, GL, LU vía `(rental_company_id='localiza', code IN ('FL','FU','GL','LU'))`.
   - **DELETE** filas activas de FL/FU/GL en rango `2026-04-01..2026-12-31` (27 filas).
   - **INSERT** 4 filas (una por gama Libre PYP) con `monthly_* = NULL`, `total_coverage_unit_charge` según tabla 9, `valid_from='2026-04-01'`, `valid_until='2026-12-31'`, `status='active'`.
   - Idempotente: el DELETE inicial cubre re-ejecuciones.
2. **Verificación post-aplicación** vía SQL:
   ```sql
   SELECT vc.code,
          count(*) FILTER (WHERE cp.status='active') AS rows_active,
          count(*) FILTER (WHERE cp.status='active' AND cp.monthly_1k_price IS NULL) AS rows_null_1k
   FROM public.vehicle_categories vc
   JOIN public.category_pricing cp ON cp.category_id = vc.id
   WHERE vc.code IN ('FL','FU','GL','LU')
   GROUP BY vc.code;
   ```
   Esperado: cada gama Libre PYP con `rows_active=1` y `rows_null_1k=1`.
3. **Validación en rentacar-web**: confirmar que el detalle de FL/FU/GL/LU rinde correctamente cuando los campos mensuales son `null` (UI dashboard ya soporta `"—"`; revisar transformer del sitio público en `packages/logic/server/utils/transformers.ts` del repo `rentacar-web`).
4. **Esperar ≤1 h** para que el cache de Nitro (`maxAge=3600`) en rentacar-web se invalide y los precios mensuales desaparezcan de la página pública para FL/FU/GL.

## 11. Anexo: notas del PDF

- El PDF descrito como `gamas2027.pdf` en correos previos corresponde al catálogo 2026 (mismo patrón de naming inconsistente del proveedor — ya documentado en `proceso-actualizacion-flota.md`).
- El correo aclara *"Estas tarifas ya incluyen el IVA, por lo que se presentan como valores finales"* — los valores almacenados en `category_pricing` son brutos con IVA incluido (consistente con la convención actual).
- "PN" = **Persona Natural**; "TRAVEL" = canal AMAW Travel (mismo valor de tarifa, distinto canal de venta). El asunto del correo confirma que ambos canales comparten lista de precios.
- **Discrepancia PDF vs operador**: el PDF de Renting Colombia incluye tarifas mensuales para las 4 gamas Libre PYP (FL, FU, GL, LU). Estas tarifas existen en la lista de precios oficial pero **Localiza/Alquilame no las ofrece para mensualidad pública** según instrucción del 2026-05-07. Quedan documentadas aquí solo como referencia histórica; no se cargan en BD.
- Validación cruzada (2026-05-07): los valores del PDF para las 8 gamas no-Libre-PYP que se cargan en BD (C, CX, F, FX, GC, G4, LE, GY) coinciden exactamente con `026_seasonal_pricing_2026.sql`. No hay corrección pendiente para esas gamas.
