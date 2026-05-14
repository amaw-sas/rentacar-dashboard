# Design: Pre-flight check de lookup legacy → destino

> **Issue:** [#16](https://github.com/amaw-sas/rentacar-dashboard/issues/16)
> **Audit ref:** [#13](https://github.com/amaw-sas/rentacar-dashboard/issues/13) (commit `c70503e`), §6 #N1
> **Fecha:** 2026-05-12
> **Status:** Design draft — pendiente review

---

## Propósito

Script Python read-only que valida que todos los identificadores legacy tienen equivalente en el destino Supabase antes de que el ETL ejecute. Bloqueante para [#19], [#20] y [#21]: si algún lookup falla, abortamos antes de tocar datos. Mejor descubrir un gap acá que a mitad de la migración productiva con la mitad de las tablas ya escritas.

El audit (Issue #13) ya encontró un ejemplo claro: 390 reservas legacy usan códigos de categoría (`GR`, `VP`, `G`, `LP`) que no existen en el destino. El pre-flight es para que ese tipo de cosas no nos pille después.

## Arquitectura

Script Python single-file en `scripts/migration/preflight-check.py`.

- **Read-only** sobre dos fuentes:
  - Legacy: MariaDB local (`rentacar_audit`) ya cargado con el dump del audit.
  - Destino: Supabase prod via conexión Postgres directa con `SUPABASE_SERVICE_ROLE_KEY` (SELECT-only, sin writes).
- Por cada uno de **4 lookups**: ejecuta una query en cada lado, computa `legacy − destination` para detectar gaps, agrega al reporte.
- Sale con exit code `0` (todos OK) o `1` (≥1 gap detectado), más códigos específicos para errores operacionales.

Dependencias Python (instaladas en venv local, fuera del repo):
- `pymysql` — cliente MariaDB
- `psycopg2-binary` — cliente Postgres
- `python-dotenv` — carga de `.env`

## Componentes

Todo en un solo archivo `preflight-check.py`. Cuatro grupos lógicos:

### Connection layer

```python
def connect_legacy() -> pymysql.Connection:
    """Lee LEGACY_DB_{HOST,USER,PASSWORD,NAME} del entorno."""

def connect_destination() -> psycopg2.Connection:
    """Lee SUPABASE_DB_URL (postgresql://...). Read-only enforced por convención."""
```

### Check layer

```python
@dataclass
class Check:
    name: str                # 'franchises', 'branches', 'categories', 'identification_type'
    description: str         # human-readable
    legacy_query: str        # SQL para MariaDB
    destination_query: str   # SQL para Postgres
    static_destination: set[str] | None = None  # para identification_type (mapping hardcoded)

CHECKS = [Check(...), Check(...), Check(...), Check(...)]

@dataclass
class CheckResult:
    name: str
    legacy_count: int
    destination_count: int
    legacy_values: list[str]
    destination_values: list[str]
    gaps: list[str]           # legacy − destination
    passed: bool              # len(gaps) == 0
    error: str | None = None  # si el check explotó

def run_check(check: Check, legacy_cur, dest_cur) -> CheckResult:
    """Ejecuta ambas queries (o static set), computa gaps, devuelve resultado."""
```

### Report layer

```python
def write_json_report(results: list[CheckResult], path: Path) -> None:
    """JSON estructurado a docs/migration-runs/preflight-<UTC timestamp>.json"""

def print_stdout_summary(results: list[CheckResult]) -> None:
    """Tabla simple: name | legacy_count | dest_count | gaps_count | status"""
```

### Main

```python
def main() -> int:
    dotenv.load_dotenv()
    # Validar env vars requeridas → exit 4 si faltan
    legacy = connect_legacy()
    dest = connect_destination()
    results = [run_check(c, legacy, dest) for c in CHECKS]
    write_json_report(results, output_path())
    print_stdout_summary(results)
    return 0 if all(r.passed for r in results) else 1
```

## Data flow

```
1. dotenv.load_dotenv()
2. Validate required env vars (exit 4 if missing)
3. Open MariaDB connection (legacy)
4. Open Postgres connection (destination, read-only intent)
5. For each check in CHECKS:
     a. Execute legacy_query  → set of values
     b. Execute destination_query (or use static set)  → set of values
     c. gaps = legacy_set − destination_set
     d. Append CheckResult
6. Write JSON report to docs/migration-runs/preflight-<ts>.json
7. Print human summary table to stdout
8. Exit 0 if all_passed else 1
```

### Las 4 queries

#### Check 1 — franchises

Validar que las 3 franchises legacy mapean al enum destino. Como el destino usa `franchise text CHECK IN (...)` en `reservations` (no una tabla aparte), comparamos contra el set hardcoded del check constraint.

```python
Check(
    name="franchises",
    description="legacy franchises.name → enum destino reservations.franchise",
    legacy_query="SELECT DISTINCT name FROM franchises",
    destination_query=None,
    static_destination={"alquilatucarro", "alquilame", "alquicarros"},
)
```

Esperado: legacy devuelve 3, set diff vacía. 0 gaps.

#### Check 2 — branches → locations

```python
Check(
    name="branches",
    description="legacy branches.code → destino locations.code (filtrado por Localiza)",
    legacy_query="SELECT DISTINCT code FROM branches WHERE code IS NOT NULL",
    destination_query="""
        SELECT DISTINCT l.code FROM locations l
        JOIN rental_companies rc ON l.rental_company_id = rc.id
        WHERE rc.code = 'localiza'
    """,
)
```

Esperado: las 31 sucursales legacy deben existir en `locations`. 0 gaps si #17 aplicada y locations seedeadas.

#### Check 3 — categories → vehicle_categories

```python
Check(
    name="categories",
    description="legacy categories.identification → destino vehicle_categories.code (Localiza)",
    legacy_query="SELECT DISTINCT identification FROM categories WHERE identification IS NOT NULL",
    destination_query="""
        SELECT DISTINCT vc.code FROM vehicle_categories vc
        JOIN rental_companies rc ON vc.rental_company_id = rc.id
        WHERE rc.code = 'localiza'
    """,
)
```

Esperado:
- **Sin #17 aplicada**: 4 gaps (`GR`, `VP`, `G`, `LP`).
- **Con #17 aplicada**: 0 gaps.

Nota: filtramos por `rental_company_id = Localiza` porque el UNIQUE de `vehicle_categories` es `(rental_company_id, code)`, no `code` solo. Si en el futuro hay otra rental_company con su propio set de códigos, el filtro evita falsos negativos.

#### Check 4 — identification_type

```python
Check(
    name="identification_type",
    description="legacy reservations.identification_type → mapping a destino CC/CE/PP",
    legacy_query="SELECT DISTINCT identification_type FROM reservations",
    destination_query=None,
    static_destination={"Cedula Ciudadania", "Cedula Extranjeria", "Pasaporte"},
)
```

Esperado: 3 valores legacy, todos en el set permitido. 0 gaps.

### Estructura del JSON de salida

```json
{
  "timestamp": "2026-05-12T15:30:00Z",
  "legacy_source": "mariadb://localhost/rentacar_audit",
  "destination_source": "supabase prod (sanitized)",
  "passed": false,
  "checks": [
    {
      "name": "franchises",
      "description": "...",
      "legacy_count": 3,
      "destination_count": 3,
      "legacy_values": ["alquilatucarro", "alquilame", "alquicarros"],
      "destination_values": ["alquilatucarro", "alquilame", "alquicarros"],
      "gaps": [],
      "passed": true,
      "error": null
    },
    {
      "name": "categories",
      "description": "...",
      "legacy_count": 17,
      "destination_count": 13,
      "legacy_values": ["C", "F", "FX", "GC", "G4", "LE", "GR", "VP", "FU", "CX", "FL", "GL", "G", "GY", "LP", "GX", "LY"],
      "destination_values": ["C", "F", "FX", "GC", "G4", "LE", "FU", "CX", "FL", "GL", "GY", "GX", "LY"],
      "gaps": ["GR", "VP", "G", "LP"],
      "passed": false,
      "error": null
    }
  ]
}
```

## Error handling

Exit codes claros, fallos visibles, ningún silencio:

| código | causa | acción |
|---|---|---|
| `0` | Todos los checks `passed=true` | OK — ETL puede correr |
| `1` | ≥1 check con gaps | Reporte muestra gaps, decisión humana |
| `2` | Connection failure (legacy o destino) | Mensaje a stderr identificando lado, sin credenciales |
| `3` | Query failure (sintaxis, tabla no existe) | Mensaje con `check.name` + error SQL + qué lado |
| `4` | Env vars requeridas faltantes | Lista las vars faltantes a stderr |
| `5` | Output dir no escribible | Fallback a `/tmp/preflight-<ts>.json`, warn a stderr |

Reglas operacionales:
- Nunca imprimimos passwords ni URLs completas. `SUPABASE_DB_URL` aparece en el reporte como `postgresql://***@host:port/db`.
- Si falla la conexión a un lado, abortamos antes de intentar el otro. No queremos connections parciales colgando.
- Las queries son resilientes: cada check corre en su propia transacción. Si una tabla legacy no existe (o el SQL tiene un typo), el `CheckResult` guarda `error=...` y seguimos con los demás. El exit code refleja qué pasó: 0 si todos OK, 3 si hubo error de query en alguno, 1 si solo había gaps.
- `try/finally` cierra cursors y connections aunque algo explote.

## Testing

Sin test suite automatizada. Son ~250 líneas de script read-only one-off; armar pytest acá es overhead que no devuelve nada.

La verificación es manual y sigue un ciclo rojo-verde:

1. Estado actual (sin #17 aplicada): corremos el script. Tiene que salir `exit 1` con 4 gaps en `categories` (`GR`, `VP`, `G`, `LP`) y los otros 3 checks pasando.
2. Aplicamos #17 en una branch de Supabase o local (la migración que agrega las 4 categorías con `status='inactive'`).
3. Corremos el script otra vez. Tiene que salir `exit 0` con 0 gaps en todos los checks.

El paso 1 demuestra que el script detecta gaps reales: si no lo hace, hay un falso negativo y el ETL después va a fallar a ciegas. El paso 3 confirma que pasa cuando el escenario es limpio.

Si la branch para #17 no está disponible cuando toque testear, hacemos solo el paso 1.

## Observable scenarios

Extraídos para alimentar `/scenario-driven-development`:

### SCEN-001 — Happy path con todos los gaps resueltos

**Given** el dump legacy cargado en MariaDB local (rentacar_audit) y Supabase destino con las 4 categorías legacy GR/VP/G/LP presentes en `vehicle_categories` (status='inactive'),
**When** ejecuto `python scripts/migration/preflight-check.py`,
**Then** exit code = 0, stdout muestra los 4 checks con `passed=true` y `gaps=[]`, y se genera `docs/migration-runs/preflight-<timestamp>.json` con `passed: true` global.

### SCEN-002 — Detección de gaps en categorías

**Given** Supabase destino **sin** las 4 categorías legacy (#17 NO aplicada — estado prod actual antes de la migración),
**When** ejecuto el script,
**Then** exit code = 1, reporte JSON lista exactamente `["GR", "VP", "G", "LP"]` como gaps en el check `categories`, los otros 3 checks pasan, y stdout muestra la tabla con el check de categorías marcado como FAIL.

### SCEN-003 — Env vars faltantes

**Given** un `.env` sin la variable `SUPABASE_DB_URL`,
**When** ejecuto el script,
**Then** exit code = 4, stderr lista `SUPABASE_DB_URL` como faltante (junto con cualquier otra requerida que falte), no se crea archivo JSON, no se abren conexiones.

### SCEN-004 — Connection failure al destino

**Given** connection legacy OK pero `SUPABASE_DB_URL` apunta a host inaccesible o credenciales inválidas,
**When** ejecuto el script,
**Then** exit code = 2, stderr menciona "destination connection failed" sin exponer la URL completa ni el password, el script no procesa ningún check.

### SCEN-005 — Idempotencia

**Given** dos corridas consecutivas del script sin cambios en legacy ni en destino entre corridas,
**When** ejecuto el script 2 veces seguidas,
**Then** ambos producen el mismo `passed` global, el mismo set de gaps por check, y el mismo exit code. Solo el `timestamp` del archivo JSON y el nombre del archivo difieren entre corridas.

---

## Notas operacionales

- El script no crea el venv solo. El operador lo arma una vez con `python -m venv .venv && pip install pymysql psycopg2-binary python-dotenv`. Lo dejamos documentado en un README chico al lado del script.
- `.env` queda fuera de git. Incluimos `.env.example` con las vars requeridas y valores vacíos.
- `docs/migration-runs/` también queda ignorado en git. Los reportes pueden tener códigos legacy completos y otra info que no queremos publicada; si después algún reporte sirve como evidencia, el operador lo archiva a mano.

## Referencias

- Issue tracker: [#16](https://github.com/amaw-sas/rentacar-dashboard/issues/16)
- Audit doc: `docs/migration-data-legacy-audit.md` §6 #N1
- Schema destino verificado:
  - `supabase/migrations/003_locations.sql` — locations + UNIQUE (rental_company_id, code)
  - `supabase/migrations/004_vehicle_categories.sql` — vehicle_categories + UNIQUE (rental_company_id, code) + status check
  - `supabase/migrations/008_reservations.sql` — franchise CHECK constraint
- Workspace evidencia audit:
  - `docs/audit-workspace/01-legacy-schema-snapshot.md`
  - `docs/audit-workspace/02-destination-schema-snapshot.md`
- Issue dependiente: [#17](https://github.com/amaw-sas/rentacar-dashboard/issues/17) (agregar categorías legacy GR/VP/G/LP a destino)
