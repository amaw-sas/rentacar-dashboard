export function splitVehicleName(name: string): [string, string] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return [words.join(" "), ""];
  }
  return [words.slice(0, 2).join(" "), words.slice(2).join(" ")];
}

export interface IncludedFeesInput {
  selected_days: number;
  total_insurance: boolean | null;
  monthly_mileage: number | null;
}

export function formatIncludedFees(r: IncludedFeesInput): string {
  const isMonthly = r.selected_days === 30;
  const hasTotalInsurance = r.total_insurance === true;
  const insuranceLabel = hasTotalInsurance ? "Seguro total" : "Seguro básico";
  if (isMonthly) {
    return `Kilometraje: ${r.monthly_mileage ?? ""}, ${insuranceLabel}`;
  }
  return `Kilometraje ilimitado, ${insuranceLabel}`;
}

export interface CategoryModelImage {
  image_url: string | null;
  is_default: boolean;
  status: string;
}

export function pickVehicleImage(
  category: { image_url: string | null } | null,
  models: CategoryModelImage[] | null,
): string | null {
  const active = (models ?? []).filter(
    (m) => m.status === "active" && m.image_url,
  );
  const def = active.find((m) => m.is_default);
  if (def?.image_url) return def.image_url;
  if (active[0]?.image_url) return active[0].image_url;
  return category?.image_url || null;
}

export interface ExtrasInput {
  baby_seat: boolean;
  wash: boolean;
  extra_driver: boolean;
}

export function formatExtras(r: ExtrasInput): string[] {
  const out: string[] = [];
  if (r.baby_seat) out.push("Silla de Bebé");
  if (r.wash) out.push("Lavado");
  if (r.extra_driver) out.push("Conductor Adicional");
  return out;
}
