/**
 * Pure selector for the raw attribution signals captured on a reservation row.
 *
 * The reservation detail page renders each NON-NULL raw signal as a labeled
 * field for audit. This module owns the single decision "which signals are
 * present, in what display order, under what label" so the page stays a thin
 * presenter and the logic is unit-testable without React.
 *
 * No I/O, no React. The DB column `landing_referrer` is surfaced under the
 * shorter "Referrer" label (the rest map 1:1 to their wire names).
 */

export interface RawSignal {
  label: string;
  value: string;
}

/**
 * The 8 raw attribution columns as stored on the `reservations` row. All
 * optional + nullable: an old reservation predating capture has every column
 * NULL, and a `direct` reservation (`{}` arrived) likewise carries no signals.
 */
export interface RawSignalRow {
  utm_source?: string | null;
  utm_medium?: string | null;
  gclid?: string | null;
  gad_source?: string | null;
  fbclid?: string | null;
  ttclid?: string | null;
  msclkid?: string | null;
  landing_referrer?: string | null;
}

/**
 * Display order + label for each raw column. Order mirrors the capture funnel:
 * utm params first, then ad click-ids, then the referrer. `landing_referrer`
 * (DB column) renders as "Referrer".
 */
const SIGNAL_ORDER: ReadonlyArray<{ key: keyof RawSignalRow; label: string }> = [
  { key: "utm_source", label: "UTM Source" },
  { key: "utm_medium", label: "UTM Medium" },
  { key: "gclid", label: "gclid" },
  { key: "gad_source", label: "gad_source" },
  { key: "fbclid", label: "fbclid" },
  { key: "ttclid", label: "ttclid" },
  { key: "msclkid", label: "msclkid" },
  { key: "landing_referrer", label: "Referrer" },
];

/**
 * Return the non-empty captured signals in display order. A value counts as
 * present only when it is a non-empty string after trimming — NULL, undefined,
 * and whitespace-only values are dropped so the audit list never shows blanks.
 */
export function presentRawSignals(row: RawSignalRow): RawSignal[] {
  const signals: RawSignal[] = [];
  for (const { key, label } of SIGNAL_ORDER) {
    const raw = row[key];
    if (typeof raw === "string" && raw.trim() !== "") {
      signals.push({ label, value: raw });
    }
  }
  return signals;
}
