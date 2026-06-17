import { parseSchedule } from "@/scripts/migration/parse-schedule";
import { locationScheduleSchema, type LocationSchedule } from "@/lib/schemas/location";

/**
 * Issue #96 (ola D2) — runner sin DB.
 *
 * Lee un dump de `locations(code, name, schedule)`, aplica el parser puro y
 * produce dos artefactos deterministas:
 *   1. un reporte de revisión markdown (las 32 filas) para el gate humano, y
 *   2. SQL idempotente de UPDATE con guard `IS DISTINCT FROM`.
 *
 * No toca la base de datos: el dump lo genera MCP (read-only) y el SQL se aplica
 * vía MCP tras la aprobación fila-por-fila. La parte pura (`buildScheduleMigration`)
 * es determinista — misma entrada, misma salida byte-idéntica (AC-D2.5).
 */

export interface DumpRow {
  code: string;
  name: string;
  schedule: Record<string, unknown> | null;
}

export interface MigrationArtifacts {
  review: string;
  sql: string;
  changedCount: number;
}

/**
 * Correcciones del operador que el texto NO contiene (revisión humana fila-por-fila).
 * Se mergean sobre el parse fiel: cada clave del override reemplaza/añade la del parse.
 * Mapa code → claves parciales de LocationSchedule.
 */
export type ScheduleOverrides = Record<string, Partial<LocationSchedule>>;

const KEY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "hol", "display"];

/** Serializa con orden de claves estable para salida byte-idéntica entre corridas. */
function stableStringify(schedule: LocationSchedule): string {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(schedule).sort(
    (a, b) => KEY_ORDER.indexOf(a) - KEY_ORDER.indexOf(b)
  )) {
    ordered[key] = (schedule as Record<string, unknown>)[key];
  }
  return JSON.stringify(ordered);
}

/** Escapa comillas simples para un literal SQL (duplicándolas). */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function displayOf(row: DumpRow): string | null {
  const display = row.schedule?.display;
  return typeof display === "string" ? display : null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Núcleo puro: dump → artefactos. Sin I/O, sin timestamp, determinista. */
export function buildScheduleMigration(
  rows: DumpRow[],
  overrides: ScheduleOverrides = {}
): MigrationArtifacts {
  const sorted = [...rows].sort((a, b) => a.code.localeCompare(b.code));

  const reviewLines: string[] = [
    "# Revisión de migración de horarios — ola D2 (#96)",
    "",
    "Validar cada fila contra el horario operativo real ANTES de aplicar. Festivos no",
    "mencionados en el texto quedan como `hol` ausente (= cerrado), salvo corrección del",
    "operador (columna `corregida`).",
    "",
    "| code | name | display original | schedule original | parsed | corregida |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  const attention: string[] = [];
  const corrections: string[] = [];
  const sqlLines: string[] = [
    "-- Migración de horarios texto → estructurado (issue #96, ola D2).",
    "-- Idempotente: el guard `IS DISTINCT FROM` hace no-op cualquier fila ya migrada.",
    "-- Generado por scripts/migration/build-schedule-migration.ts (determinista).",
    "",
  ];

  let changedCount = 0;
  for (const row of sorted) {
    const parsed = parseSchedule(displayOf(row));
    const override = overrides[row.code];
    // Merge de la corrección del operador sobre el parse fiel: las claves del
    // override reemplazan/añaden. Se re-valida para que una corrección inválida
    // (ej. minuto off-grid) falle ruidoso en vez de llegar a prod.
    const final = override
      ? locationScheduleSchema.parse({ ...parsed, ...override })
      : parsed;

    const finalJson = stableStringify(final);
    const displayCell = (displayOf(row) ?? "_(vacío)_").replace(/\|/g, "\\|");
    // Mostrar el schedule original COMPLETO para que el gate humano vea cualquier
    // clave no modelada que el `SET schedule = …` (full-replace) borraría.
    const originalJson = JSON.stringify(row.schedule ?? {}).replace(/\|/g, "\\|");
    reviewLines.push(
      `| ${row.code} | ${row.name} | ${displayCell} | \`${originalJson}\` | \`${finalJson.replace(/\|/g, "\\|")}\` | ${override ? "sí" : "—"} |`
    );

    const isEmpty = Object.keys(final).filter((k) => k !== "display").length === 0;
    const holAbsent = !("hol" in final) && !isEmpty;
    if (override) {
      corrections.push(`- ${row.code} (${row.name}): override \`${JSON.stringify(override)}\`.`);
    }
    if (isEmpty) attention.push(`- ${row.code} (${row.name}): quedó \`{}\` — sin horario.`);
    else if (holAbsent) attention.push(`- ${row.code} (${row.name}): \`hol\` ausente (festivos no declarados).`);

    if (!deepEqual(final, row.schedule ?? {})) {
      changedCount++;
      sqlLines.push(
        `UPDATE locations SET schedule = ${sqlLiteral(finalJson)}::jsonb ` +
          `WHERE code = ${sqlLiteral(row.code)} AND schedule IS DISTINCT FROM ${sqlLiteral(finalJson)}::jsonb;`
      );
    }
  }

  const review = [
    ...reviewLines,
    "",
    "## Correcciones aplicadas (override del operador)",
    "",
    ...(corrections.length ? corrections : ["- (ninguna)"]),
    "",
    "## Filas que requieren atención",
    "",
    ...(attention.length ? attention : ["- (ninguna)"]),
    "",
    `**Total**: ${sorted.length} filas · ${changedCount} con cambios · ${sorted.length - changedCount} sin cambio · ${corrections.length} corregidas.`,
    "",
  ].join("\n");

  const sql = sqlLines.join("\n") + "\n";
  return { review, sql, changedCount };
}

// --- CLI (solo al ejecutar directamente con node) ---------------------------
// node --import ./scripts/migration/_register-alias.mjs \
//   scripts/migration/build-schedule-migration.ts <dump.json> <out-dir> <timestamp> [overrides.json]
async function main(): Promise<void> {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const [dumpPath, outDir = "docs/migration-runs", timestamp, overridesPath] = process.argv.slice(2);
  if (!dumpPath) {
    throw new Error("uso: build-schedule-migration <dump.json> [out-dir] [timestamp] [overrides.json]");
  }
  const ts = timestamp ?? new Date().toISOString().replace(/[:.]/g, "-");
  const rows = JSON.parse(readFileSync(dumpPath, "utf8")) as DumpRow[];
  const overrides: ScheduleOverrides = overridesPath
    ? (JSON.parse(readFileSync(overridesPath, "utf8")) as ScheduleOverrides)
    : {};
  const { review, sql, changedCount } = buildScheduleMigration(rows, overrides);
  const reviewPath = `${outDir}/schedule-review-${ts}.md`;
  const sqlPath = `${outDir}/schedule-migration-${ts}.sql`;
  writeFileSync(reviewPath, review);
  writeFileSync(sqlPath, sql);
  console.log(`Escritos:\n  ${reviewPath}\n  ${sqlPath}\n${changedCount} filas con cambios.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
