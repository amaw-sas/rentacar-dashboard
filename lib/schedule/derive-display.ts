import { type LocationSchedule } from "@/lib/schemas/location";

/**
 * Issue #97 (ola D3) — derivación pura del `display` desde el horario estructurado.
 *
 * Inversa del parser de D2 (`scripts/migration/parse-schedule.ts`), reimplementada
 * de forma INDEPENDIENTE: NO importa el parser (eso arrastraría lógica de migración
 * al bundle del cliente). Su correspondencia con el parser se verifica por el
 * round-trip test, no por compartir código. Sin I/O, client-safe (la usan la action
 * y el form para el preview en vivo).
 *
 * El `display` derivado es la fuente que la web lee hasta la ola W1, así que debe
 * re-parsear al mismo estructurado (propiedad de round-trip normalizado).
 */

type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

// Recorrido semanal con su etiqueta ES (capitalización canónica; el parser
// normaliza acentos al leer, así que `Mié`/`Sáb` round-trip sin problema).
const WEEK: ReadonlyArray<readonly [Weekday, string]> = [
  ["mon", "Lun"],
  ["tue", "Mar"],
  ["wed", "Mié"],
  ["thu", "Jue"],
  ["fri", "Vie"],
  ["sat", "Sáb"],
  ["sun", "Dom"],
];

const TWENTY_FOUR_HOURS = "00:00-24:00";

function isClosed(ranges: string[] | undefined): boolean {
  return !ranges || ranges.length === 0;
}

// Clave de igualdad para agrupar corridas de días con el mismo valor.
function valueKey(ranges: string[] | undefined): string {
  return isClosed(ranges) ? "·closed·" : ranges!.join(",");
}

// Token de display de un día. El `24 horas` es literal y requerido por el regex
// del parser (`/\s+24\s+horas$/i`); emitir `24 h` rompería el round-trip.
function renderValue(ranges: string[] | undefined): string {
  if (isClosed(ranges)) return "Cerrado";
  if (ranges!.length === 1 && ranges![0] === TWENTY_FOUR_HOURS) return "24 horas";
  return ranges!.join(", ");
}

/**
 * Descarta la clave `display`, dejando solo las claves de día. El form la usa para
 * enviar al server únicamente el estructurado; el server re-deriva `display`.
 */
export function stripDisplay(schedule: LocationSchedule): LocationSchedule {
  const { display: _display, ...days } = schedule;
  void _display;
  return days;
}

/**
 * Deriva el texto de horario agrupado en ES desde el estructurado v2.
 * Ignora cualquier clave `display` entrante.
 */
export function deriveScheduleDisplay(schedule: LocationSchedule): string {
  const holRanges = schedule.hol;

  // Regla de semana vacía (precedencia máxima): nada configurado → "" (no afirma
  // "Cerrado" para sucursales aún sin horario).
  const weekAllClosed = WEEK.every(([key]) => isClosed(schedule[key]));
  if (weekAllClosed && isClosed(holRanges)) return "";

  // Colapsa corridas consecutivas de mon..sun con valor idéntico en un segmento.
  type Segment = { labels: string[]; vk: string; ranges: string[] | undefined };
  const segments: Segment[] = [];
  for (const [key, abbr] of WEEK) {
    const ranges = schedule[key];
    const vk = valueKey(ranges);
    const last = segments[segments.length - 1];
    if (last && last.vk === vk) last.labels.push(abbr);
    else segments.push({ labels: [abbr], vk, ranges });
  }

  const segLabel = (seg: Segment): string =>
    seg.labels.length === 1
      ? seg.labels[0]
      : `${seg.labels[0]}-${seg.labels[seg.labels.length - 1]}`;

  const parts = segments.map((seg) => `${segLabel(seg)} ${renderValue(seg.ranges)}`);

  // Festivo: si su valor iguala al del último segmento de semana (típico `Dom`),
  // se fusiona en "Dom y fest <valor>"; si no, segmento propio "Fest <valor>".
  const lastSeg = segments[segments.length - 1];
  if (valueKey(holRanges) === lastSeg.vk) {
    parts[parts.length - 1] = `${segLabel(lastSeg)} y fest ${renderValue(lastSeg.ranges)}`;
  } else {
    parts.push(`Fest ${renderValue(holRanges)}`);
  }

  return parts.join(" | ");
}
