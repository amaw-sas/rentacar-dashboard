# Proceso de actualización de flota Localiza

Cómo incorporar una nueva versión del catálogo de Localiza (PDF "Gamas y Vehículos") al dashboard.

## 1. Insumos requeridos

- **PDF de Localiza** con el catálogo vigente (ej. `gamas2026.pdf`).
- **Carpeta de imágenes** organizada por gama: `imagenes-modelos-categorias/gamaC/<modelo>.jpeg`, `gamaCX/...`, etc.
- **Imagen placeholder** (`placeholder.jpeg`) para modelos sin foto disponible al momento de la actualización.
- **Acceso al proyecto Supabase** `rentacar-dashboard` (vía MCP o CLI).
- **`BLOB_READ_WRITE_TOKEN`** en `.env.local` para subir imágenes a Vercel Blob.

## 2. Flujo end-to-end

### 2.1. Extraer y normalizar el PDF

Convertir el PDF en una lista estructurada de gamas y modelos. Salida esperada: `docs/localiza/gamas-<año>.md` con una sección por gama (código, tipo, modelos, características).

Convenciones del PDF que se repiten año a año:
- Gamas con sufijo `L` o `U` son la variante **Libre PYP** (exenta de pico y placa) de la gama base. Ej. `FL = F Libre PYP`, `LU = LE Libre PYP`.
- El nombre de archivo del PDF puede no coincidir con el título interno (ej. `gamas2027.pdf` con título "Colombia 2026"). Confiar en el título.
- Los datos detallados (cilindrada, tanque, fabricante) **solo viven en el PDF** — la BD no almacena estos campos.

### 2.2. Comparar contra la BD

Generar un diff entre `vehicle_categories` + `category_models` (filtrado por `rental_companies.name = 'Localiza'`) y el PDF nuevo. Salida esperada: `docs/localiza/gamas-<año>-comparacion.md`. Identificar:

1. **Gamas nuevas** que no existen en BD.
2. **Modelos nuevos** por gama.
3. **Modelos que cambiaron de gama** (ej. Hyundai Accent migra de FX a FU).
4. **Modelos obsoletos** (no figuran en el PDF nuevo).
5. **Cambios en `is_default`** sugeridos por el orden del PDF o instrucción explícita.
6. **Inconsistencias del PDF** (ej. transmisión que contradice el tipo de gama). Se documentan y se corrigen al pasar a BD.

### 2.3. Subir imágenes a Vercel Blob

Las imágenes se sirven desde Vercel Blob bajo el prefijo `rentacar/localiza-2026/`. Usar el script auxiliar:

```bash
node --env-file=.env.local scripts/upload-localiza-images.mjs <ruta-carpeta-imagenes>
```

El script:
- Recorre subcarpetas por gama.
- Sube cada `.jpeg` / `.jpg` / `.png` con sufijo aleatorio (vía `addRandomSuffix: true`).
- Imprime un mapa JSON `{ "gamaX/archivo.jpeg": "URL" }` que se usa al generar el SQL.

### 2.4. Generar la migración SQL

Crear `supabase/migrations/<timestamp>_<NNN>_localiza_<año>_<resumen>.sql` envuelto en un bloque `DO $$ ... END $$`. Patrón:

```sql
DO $$
DECLARE
  v_company_id uuid;
  v_cat_<código> uuid;
BEGIN
  SELECT id INTO v_company_id FROM public.rental_companies WHERE name='Localiza';
  SELECT id INTO v_cat_<código> FROM public.vehicle_categories
    WHERE rental_company_id=v_company_id AND code='<CÓDIGO>';

  -- INSERT de nuevas gamas
  -- INSERT de nuevos modelos
  -- UPDATE de image_url para modelos existentes
  -- UPDATE de is_default
  -- UPDATE status='inactive' para modelos obsoletos
END $$;
```

**Reglas duras**:
- **Nunca eliminar** modelos. Marcar `status='inactive'` para conservar historial. `category_models` no es referenciado por `reservations`, pero el patrón se mantiene por auditoría.
- **Una sola fila** con `is_default=true` por categoría. Antes de cambiar el default, bajar el actual a `false`.
- **Preservar nombres y descripciones** existentes salvo instrucción explícita: tags, `short_description`, `long_description` y `name` de las gamas se mantienen.
- Los modelos compartidos entre gamas (ej. Kona en GC y GL) se insertan **dos veces** con la misma `image_url` — son filas independientes con distinto `category_id`.

### 2.5. Aplicar la migración

Dos vías:

- **Local + push**: `pnpm supabase migration up` localmente para validar, luego `supabase db push` contra remoto. Solo si tienes el stack de supabase corriendo.
- **MCP directo** (si no hay entorno local): `mcp__supabase__apply_migration` con el contenido del archivo. La función registra automáticamente la migración en `supabase_migrations.schema_migrations` con un `version` timestamp generado por el servidor.

> ⚠️ Si aplicas vía MCP y el archivo local tiene formato secuencial `NNN_<name>.sql`, el remoto registrará un `version` con timestamp y el `name` con el nombre que pasaste a `apply_migration`. Para que `supabase db push` reconozca el archivo después, **renombrar el archivo local al formato `<timestamp>_<NNN>_<name>.sql`** que Supabase CLI espera (ver convención adoptada en este repo desde `20260505153020_036_localiza_2026_fleet.sql`).

### 2.6. Verificación post-aplicación

Consultar conteos por gama y validar contra el PDF:

```sql
select vc.code,
       count(*) filter (where cm.status='active') as activos,
       count(*) filter (where cm.is_default and cm.status='active') as default_count,
       string_agg(case when cm.is_default and cm.status='active' then cm.name end, '') as default_model
from public.category_models cm
join public.vehicle_categories vc on vc.id = cm.category_id
join public.rental_companies rc on rc.id = vc.rental_company_id
where rc.name='Localiza'
group by vc.code
order by vc.code;
```

**Criterios de éxito**:
- `default_count = 1` para cada gama activa.
- Cantidad de `activos` por gama coincide con la cantidad de modelos del PDF para esa gama.
- Las URLs de las imágenes apuntan a `rentacar/localiza-2026/...` o, en su defecto, a la URL del placeholder local subido a Blob (no a `placehold.co` ni a otros servicios externos).

### 2.7. Type-check y commit

```bash
pnpm type-check
pnpm lint
git add docs/localiza/ supabase/migrations/<archivos-nuevos>.sql scripts/upload-localiza-images.mjs
git commit -m "feat(categories): align Localiza fleet with <año> PDF catalog"
git push
```

## 3. Manejo de modelos sin imagen

Cuando el modelo nuevo no tiene foto disponible:

1. Insertarlo con `image_url` apuntando al placeholder neutral de la flota:
   `https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/localiza-2026/gamaPlaceholder-placeholder-zjgOwZI1pfLQQPvY7enc0Tpj8mjlfa.jpeg`
2. Documentar en el comentario de la migración los modelos en placeholder.
3. Cuando llegue la imagen real: subirla con el script y emitir una migración mínima `UPDATE category_models SET image_url=... WHERE name=...`.

## 4. Anti-patrones a evitar

- **No eliminar** filas de `category_models` o `vehicle_categories` aunque ya no aparezcan en el PDF — se rompe trazabilidad de reservas históricas.
- **No renombrar** un modelo en lugar de crear uno nuevo si el PDF cambia el modelo (ej. Renault Duster 2.0 → 1.3 Turbo). Crear nuevo + desactivar viejo preserva el linkage histórico.
- **No usar placeholders externos** (`placehold.co`, etc.) en producción — depender de un servicio de terceros para imágenes públicas introduce riesgos de disponibilidad y caching.
- **No editar migraciones ya aplicadas**. Si hay error, emitir una migración correctiva nueva (ver `037_localiza_2026_fx_dedup.sql` como ejemplo de corrección post-hoc).
