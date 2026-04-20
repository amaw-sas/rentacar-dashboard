import { MONTHLY_MILEAGE_OPTIONS } from "@/lib/schemas/reservation";

const CANONICAL = new Set<number>(
  MONTHLY_MILEAGE_OPTIONS.map((o) => o.value),
);

const LEGACY_ENUM: Record<string, number> = {
  "1k_kms": 1000,
  "2k_kms": 2000,
  "3k_kms": 3000,
};

const LEGACY_SMALL: Record<number, number> = {
  1: 1000,
  2: 2000,
  3: 3000,
};

export function parseMonthlyMileage(
  input: unknown,
): number | null {
  if (input === null || input === undefined || input === "") return null;

  if (typeof input === "string") {
    if (input in LEGACY_ENUM) return LEGACY_ENUM[input];
    const asNumber = Number(input);
    if (Number.isFinite(asNumber)) return normalizeNumber(asNumber);
    return null;
  }

  if (typeof input === "number" && Number.isFinite(input)) {
    return normalizeNumber(input);
  }

  return null;
}

function normalizeNumber(n: number): number | null {
  if (CANONICAL.has(n)) return n;
  if (n in LEGACY_SMALL) return LEGACY_SMALL[n];
  return null;
}
