import {
  locationScheduleSchema,
  type LocationSchedule,
} from "@/lib/schemas/location";

/**
 * Issue #96 (ola D2) — parser puro de horarios de sucursal.
 *
 * Transforma el `display` de texto libre (ej. "Lun-Vie 08:00-18:00 | Sáb, Dom y
 * fest 08:00-16:00") a la forma estructurada `LocationSchedule` de D1, CONSERVANDO
 * el `display` original. Sin I/O — el corazón unit-testeable de la migración.
 *
 * Reglas (cerradas en el diseño 2026-06-17-issue-96-...):
 * - Festivos no mencionados → clave `hol` AUSENTE (no se infiere horario festivo).
 * - Token de día o tiempo desconocido → `throw` (fail-loud, aflora en el dry-run).
 * - La salida siempre pasa `locationScheduleSchema` de D1 antes de retornar.
 */

const WEEK_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type WeekDay = (typeof WEEK_ORDER)[number];
type DayKey = WeekDay | "hol";

// Abreviatura ES (normalizada: minúsculas, sin acentos) → clave del schema.
const DAY_MAP: Record<string, DayKey> = {
  lun: "mon",
  mar: "tue",
  mie: "wed",
  jue: "thu",
  vie: "fri",
  sab: "sat",
  dom: "sun",
  fest: "hol",
  festivos: "hol",
};

/** Minúsculas + sin diacríticos + trim, para emparejar "Sáb"/"Mié"/"días". */
function normalize(token: string): string {
  return token
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Separa un segmento en su día-spec (prefijo) y los rangos de tiempo, emparejando
 * el tiempo-spec contra el conjunto enumerado anclado al final del segmento
 * (NO partiendo por el último token — "24 horas" son dos palabras).
 */
function splitSegment(segment: string): { daySpec: string; ranges: string[] } {
  const trimmed = segment.trim();
  let daySpec: string;
  let ranges: string[];

  if (/\s+24\s+horas$/i.test(trimmed)) {
    daySpec = trimmed.replace(/\s+24\s+horas$/i, "").trim();
    ranges = ["00:00-24:00"];
  } else if (/\s+cerrado$/i.test(trimmed)) {
    daySpec = trimmed.replace(/\s+cerrado$/i, "").trim();
    ranges = [];
  } else {
    const range = trimmed.match(/\s+(\d{2}:\d{2}-\d{2}:\d{2})$/);
    if (!range) {
      throw new Error(`parseSchedule: tiempo no reconocido en segmento "${segment}"`);
    }
    daySpec = trimmed.slice(0, range.index).trim();
    ranges = [range[1]];
  }

  // Guard de turno partido / multi-rango: un fragmento de hora sobrante en el
  // día-spec significa una forma no soportada (ej. "Lun-Vie 08:00-12:00, 14:00-18:00");
  // el match del rango final descartaría en silencio el rango de la mañana. Fail-loud.
  if (/\d{1,2}:\d{2}/.test(daySpec)) {
    throw new Error(`parseSchedule: segmento con múltiples rangos no soportado "${segment}"`);
  }

  return { daySpec, ranges };
}

/** Resuelve el día-spec a un conjunto ordenado de claves del schema. */
function parseDaySpec(daySpec: string): DayKey[] {
  if (normalize(daySpec) === "todos los dias") {
    return [...WEEK_ORDER];
  }

  // Grupos: separados por coma o " y " (ej. "Sáb, Dom y fest").
  const tokens = daySpec
    .split(/\s*,\s*|\s+y\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const keys: DayKey[] = [];
  for (const token of tokens) {
    if (token.includes("-")) {
      const [from, to] = token.split("-").map(normalize);
      const keyFrom = DAY_MAP[from];
      const keyTo = DAY_MAP[to];
      const start = WEEK_ORDER.indexOf(keyFrom as WeekDay);
      const end = WEEK_ORDER.indexOf(keyTo as WeekDay);
      if (start < 0 || end < 0 || start > end) {
        throw new Error(`parseSchedule: rango de días inválido "${token}"`);
      }
      for (let i = start; i <= end; i++) keys.push(WEEK_ORDER[i]);
    } else {
      const key = DAY_MAP[normalize(token)];
      if (!key) {
        throw new Error(`parseSchedule: día no reconocido "${token}"`);
      }
      keys.push(key);
    }
  }
  return keys;
}

export function parseSchedule(display: string | null | undefined): LocationSchedule {
  if (display == null || display.trim() === "") {
    return {};
  }

  const structured: Partial<Record<DayKey, string[]>> = {};
  const segments = display
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const { daySpec, ranges } = splitSegment(segment);
    const keys = parseDaySpec(daySpec);
    if (keys.length === 0) {
      throw new Error(`parseSchedule: segmento sin días "${segment}"`);
    }
    for (const key of keys) {
      const existing = structured[key];
      structured[key] = existing ? existing.concat(ranges) : [...ranges];
    }
  }

  // Validación final contra el schema de D1 (AC-D2.7): falla ruidoso si el parser
  // produjera algo inválido, en vez de escribir basura a la columna. Se envuelve el
  // error de Zod nombrando el display ofensivo para que el dry-run sea legible.
  try {
    return locationScheduleSchema.parse({ ...structured, display });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`parseSchedule: salida inválida para "${display}": ${detail}`);
  }
}
