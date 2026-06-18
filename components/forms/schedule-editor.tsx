"use client";

import { useState } from "react";
import { type LocationSchedule } from "@/lib/schemas/location";
import { Label } from "@/components/ui/label";

// Issue #97 (ola D3) — editor de horario por día + festivo.
//
// Un rango por día (Cerrado / 24 h / Horario). Usa `<select>` NATIVO (no Radix):
// jsdom no renderiza opciones de Radix (gotcha #90) y este control es crítico
// para integridad de datos → queremos AC-D3.1..D3.5 como tests vitest en CI.

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" | "hol";
type Mode = "closed" | "24h" | "range";

const ROWS: ReadonlyArray<readonly [DayKey, string]> = [
  ["mon", "Lunes"],
  ["tue", "Martes"],
  ["wed", "Miércoles"],
  ["thu", "Jueves"],
  ["fri", "Viernes"],
  ["sat", "Sábado"],
  ["sun", "Domingo"],
  ["hol", "Festivos"],
];

const TWENTY_FOUR_HOURS = "00:00-24:00";

// Grilla de 30 min. Inicio 00:00..23:30; fin 00:30..24:00.
function fmt(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const START_OPTIONS = Array.from({ length: 48 }, (_, i) => fmt(i * 30));
const END_OPTIONS = Array.from({ length: 48 }, (_, i) => fmt((i + 1) * 30));

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

type RowState = { mode: Mode; start: string; end: string };

function rowFromRanges(ranges: string[] | undefined): RowState {
  if (!ranges || ranges.length === 0) {
    return { mode: "closed", start: "08:00", end: "18:00" };
  }
  if (ranges.length === 1 && ranges[0] === TWENTY_FOUR_HOURS) {
    return { mode: "24h", start: "08:00", end: "18:00" };
  }
  const [start, end] = ranges[0].split("-");
  return { mode: "range", start, end };
}

function rangesFromRow(row: RowState): string[] | undefined {
  if (row.mode === "closed") return undefined;
  if (row.mode === "24h") return [TWENTY_FOUR_HOURS];
  return [`${row.start}-${row.end}`];
}

function isInvalid(row: RowState): boolean {
  return row.mode === "range" && minutes(row.start) >= minutes(row.end);
}

function buildSchedule(rows: Record<DayKey, RowState>): LocationSchedule {
  const out: LocationSchedule = {};
  for (const [key] of ROWS) {
    const ranges = rangesFromRow(rows[key]);
    if (ranges) out[key] = ranges; // Cerrado → clave omitida
  }
  return out;
}

interface ScheduleEditorProps {
  value: LocationSchedule;
  onChange: (next: LocationSchedule) => void;
}

export function ScheduleEditor({ value, onChange }: ScheduleEditorProps) {
  // CONTRATO seed-once: `value` siembra el estado UNA vez (preload de edición).
  // El editor es la fuente de verdad de los cambios; reseedear desde `value` en
  // cada cambio arriesga pisar la edición en curso. Hoy es seguro porque el form
  // es route-keyed (cada sucursal es su propia ruta /locations/[id]/edit → remonta)
  // y navega al guardar. Si se añade un botón "Reset"/"Descartar" o un refresh que
  // re-alimente defaultValues, hay que volver el editor controlado o remontarlo
  // con `key`.
  const [rows, setRows] = useState<Record<DayKey, RowState>>(() => {
    const init = {} as Record<DayKey, RowState>;
    for (const [key] of ROWS) init[key] = rowFromRanges(value[key]);
    return init;
  });

  function update(key: DayKey, patch: Partial<RowState>) {
    const next = { ...rows, [key]: { ...rows[key], ...patch } };
    setRows(next);
    onChange(buildSchedule(next));
  }

  return (
    <fieldset className="space-y-3" aria-label="Horario por día">
      <legend className="text-sm font-medium">Horario</legend>
      {ROWS.map(([key, label]) => {
        const row = rows[key];
        const invalid = isInvalid(row);
        return (
          <div key={key} className="flex flex-wrap items-center gap-2">
            <Label className="w-24 shrink-0">{label}</Label>

            <select
              aria-label={`Modo ${label}`}
              value={row.mode}
              onChange={(e) => update(key, { mode: e.target.value as Mode })}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="closed">Cerrado</option>
              <option value="24h">24 horas</option>
              <option value="range">Horario</option>
            </select>

            {row.mode === "range" && (
              <>
                <select
                  aria-label={`Inicio ${label}`}
                  value={row.start}
                  onChange={(e) => update(key, { start: e.target.value })}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  {START_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">–</span>
                <select
                  aria-label={`Fin ${label}`}
                  value={row.end}
                  onChange={(e) => update(key, { end: e.target.value })}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  {END_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {invalid && (
                  <p role="alert" className="w-full text-sm text-destructive">
                    El horario de {label} es inválido: la hora de inicio debe ser
                    menor que la de fin.
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
