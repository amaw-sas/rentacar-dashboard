import { z } from "zod";

// --- Structured schedule v2 (issue #95, ola D1) -----------------------------
// Replaces the free-text `z.record(z.string(), z.string())` with a day-keyed
// contract that is queryable per day, so the web funnel can restrict the
// calendar/time selector. Source of truth: rentacar-web ADR
// docs/specs/2026-06-03-issue-47-schedule-restrictions-design.md.

// Range shape. The start/end hour asymmetry is DELIBERATE: end hour allows 24
// to admit the `24:00` end-of-day sentinel; start hour stops at 23. Minutes are
// pinned to the 30-minute grid (:00 / :30).
const SCHEDULE_RANGE_RE = /^([01]\d|2[0-3]):(00|30)-([01]\d|2[0-4]):(00|30)$/;

// Minutes-from-midnight, mapping the `24:00` sentinel to 1440. A naive Date or
// string comparator breaks the sentinel, so compare numerically.
function rangeMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const scheduleRange = z
  .string()
  .regex(SCHEDULE_RANGE_RE, "Rango horario inválido (HH:MM-HH:MM, minutos :00 o :30)")
  .refine(
    (range) => {
      const [start, end] = range.split("-");
      const startMin = rangeMinutes(start);
      const endMin = rangeMinutes(end);
      // start before end, and end may not exceed the 24:00 sentinel (1440):
      // the regex admits 24:30, which is past end-of-day, so reject it here.
      return startMin < endMin && endMin <= 1440;
    },
    "El rango debe ir de menor a mayor y no superar 24:00"
  );

// Per-day list of ranges. D1 validates each range in isolation; array-level
// invariants (non-overlap, sorted order, dedupe) are intentionally NOT enforced
// here — they are deferred to ola D2/W1, which owns the day-querying contract.
const scheduleDay = z.array(scheduleRange);

// Optional day keys; absent key or [] = closed. `display` is preserved so the
// web reading `schedule.display` does not break before web ola W1.
// `.strict()`: a misspelled/locale day key (e.g. `monday`, `lun`) must fail
// loudly — without it, z.object silently strips it and the schedule collapses
// to "closed", silently blocking bookings on a day the branch is actually open.
export const locationScheduleSchema = z
  .object({
    mon: scheduleDay.optional(),
    tue: scheduleDay.optional(),
    wed: scheduleDay.optional(),
    thu: scheduleDay.optional(),
    fri: scheduleDay.optional(),
    sat: scheduleDay.optional(),
    sun: scheduleDay.optional(),
    hol: scheduleDay.optional(),
    display: z.string().optional(),
  })
  .strict();

export type LocationSchedule = z.infer<typeof locationScheduleSchema>;

export const locationSchema = z.object({
  rental_company_id: z.string().uuid("ID de rentadora inválido"),
  code: z.string().min(1, "Código es requerido"),
  name: z.string().min(1, "Nombre es requerido"),
  city: z.string().default(""),
  pickup_address: z.string().min(1, "Dirección de recogida es requerida"),
  pickup_map: z.string().min(1, "URL de mapa de recogida es requerida"),
  return_address: z.string().nullable().default(null),
  return_map: z.string().nullable().default(null),
  schedule: locationScheduleSchema.default({}),
  city_id: z.string().uuid("Debes seleccionar una ciudad"),
  slug: z.string().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type LocationFormData = z.infer<typeof locationSchema>;
