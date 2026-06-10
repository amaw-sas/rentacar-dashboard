# log_veh — reporte PDF para gerencia

Genera un PDF presentable (gráficos + narrativa en español + tablas de respaldo) a partir del bundle
markdown canónico de la Fase 3.5. El PDF es un **artefacto derivado regenerable**; la fuente versionada
única es el markdown.

## Regenerar

```bash
bash scripts/analysis/log-veh/pdf/render-pdf.sh
```

Salida: `scripts/analysis/log-veh/pdf/log-veh-reports-<fecha>.pdf` (la fecha sale del nombre del bundle).
El script también deja `report.html` intermedio. Ambos están **gitignored**.

## Entrada (canónica, versionada)

`docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md`
— las 4 secciones (demanda, precios, fallo de cotización, disponibilidad/comportamiento) ya reconciliadas
y libres de PII por la Fase 3.5. El PDF **no** recalcula nada: solo re-presenta esos números.

## Piezas

| Archivo | Rol | Pureza |
|---|---|---|
| `parse-bundle.mjs` | bundle markdown → `{report}{cut}{columns,rows}`; expone `numAt` | puro |
| `charts.mjs` | `hbar`/`vbar`/`line` → SVG (coords enteras, labels enteros) | puro |
| `compose-html.mjs` | datos + narrativa + charts + CSS → HTML | puro |
| `theme.css` | CSS de impresión A4, marca, control de salto de página | estático |
| `narrative.es.md` | narrativa ejecutiva en español (humanizada), 4 bloques anclados | estático |
| `branch-labels.json` | mapa código→ciudad de sucursal (fallback al código crudo) | datos |
| `render-pdf.sh` | orquesta: bundle → HTML (atómico) → `check-pii.sh` → Chromium `--print-to-pdf` → valida `%PDF` | orquestador |

Cero dependencias npm. Chromium se resuelve desde PATH o el cache de Playwright (igual que `generate-reports.sh`
resuelve `duckdb`).

## Garantías

- **Determinismo** a nivel HTML+SVG: misma entrada → mismo `report.html` byte a byte. El binario PDF se excluye
  (Chromium incrusta timestamps).
- **Sin PII**: `render-pdf.sh` corre `check-pii.sh` sobre el HTML compuesto antes de invocar Chromium. Las coords
  SVG son enteras por construcción, así que no disparan el falso-positivo IPv4 del scanner.
- **Falla ruidosa**: si falta un cut esperado en el bundle, `parse-bundle.mjs` lanza error nombrando el cut; nunca
  renderiza una sección vacía.

## Tests

```bash
./node_modules/.bin/vitest run tests/unit/analysis/log-veh-pdf/
```

Cubren fidelidad del parser + guard de cut faltante, determinismo de charts/HTML, labels enteros, y el
invariante anti-IPv4 de las coords SVG.

## Ampliar `branch-labels.json`

Mapa actual poblado desde `supabase/migrations/017_populate_location_data.sql` (+018) y el seed. Códigos sin
ciudad conocida se muestran crudos. El mapa completo (desde la tabla `locations`) es trabajo futuro.
