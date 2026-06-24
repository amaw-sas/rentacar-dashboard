import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getLocationDirectory,
  type LocationDirectoryItem,
} from "@/lib/api/location-directory";
import { bogotaTodayYMD } from "@/lib/date/bogota";

/**
 * Structured knowledge tools for the chat agent (Chat Fase 2 · Incremento 2).
 * These are the PRIMARY source of truth for sedes, monthly rates and gamas — the
 * editable knowledge base (chat_knowledge) is only a fallback. Each runner
 * returns a plain object the LLM relays: data on success, `{ error }` (Spanish)
 * on the expected miss paths. Never throws for expected misses.
 *
 * All reads use the service-role admin client: the chat route is public/anonymous
 * (no session), so the RLS-bound `createClient()` used by lib/queries/* would fail
 * here. Mirrors getLocationDirectory(), which the cotizar path already uses.
 */

/** Diacritic- and case-insensitive normalization for place/gama matching. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Localiza company id is stable; cache it to avoid a lookup per tool call.
const COMPANY_TTL_MS = 10 * 60_000;
let companyCache: { id: string; at: number } | null = null;

async function getLocalizaCompanyId(): Promise<string | null> {
  const now = Date.now();
  if (companyCache && now - companyCache.at < COMPANY_TTL_MS) {
    return companyCache.id;
  }
  const sb = createAdminClient();
  const { data, error } = await sb
    .from("rental_companies")
    .select("id")
    .eq("code", "localiza")
    .single();
  if (error || !data) return null;
  companyCache = { id: data.id as string, at: now };
  return data.id as string;
}

const DAY_LABELS: Record<string, string> = {
  mon: "Lun",
  tue: "Mar",
  wed: "Mié",
  thu: "Jue",
  fri: "Vie",
  sat: "Sáb",
  sun: "Dom",
  hol: "Festivos",
};

// Prefer the curated `display` string; otherwise compact the per-day ranges.
function scheduleToText(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") return "Consultar horario";
  const s = schedule as Record<string, unknown>;
  if (typeof s.display === "string" && s.display.trim()) return s.display;
  const parts: string[] = [];
  for (const key of ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "hol"]) {
    const ranges = s[key];
    if (Array.isArray(ranges) && ranges.length > 0) {
      parts.push(`${DAY_LABELS[key]} ${ranges.join(", ")}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "Consultar horario";
}

// ---------------------------------------------------------------------------
// info_sedes
// ---------------------------------------------------------------------------

export const infoSedesSchema = {
  ciudad: z
    .string()
    .min(1)
    .describe("Ciudad de la que se quieren las sedes, p. ej. 'bogota'."),
  sede: z
    .string()
    .optional()
    .describe("Nombre o slug de sede para desambiguar si hay varias."),
};

export async function runInfoSedes(args: {
  ciudad: string;
  sede?: string;
}): Promise<unknown> {
  let directory: LocationDirectoryItem[];
  try {
    directory = await getLocationDirectory();
  } catch {
    return { error: "No pude consultar las sedes. Intenta de nuevo más tarde." };
  }

  const c = norm(args.ciudad);
  let matches = directory.filter((l) => norm(l.city) === c);
  if (matches.length === 0) {
    matches = directory.filter(
      (l) => norm(l.city).includes(c) || c.includes(norm(l.city)),
    );
  }
  if (args.sede && matches.length > 1) {
    const s = norm(args.sede);
    const narrowed = matches.filter(
      (l) => norm(l.name).includes(s) || norm(l.slug).includes(s),
    );
    if (narrowed.length > 0) matches = narrowed;
  }

  if (matches.length === 0) {
    const cities = [...new Set(directory.map((l) => l.city))].sort((a, b) =>
      a.localeCompare(b, "es"),
    );
    return {
      error: `No tengo sede en "${args.ciudad}". Ciudades con servicio: ${cities.join(", ")}.`,
    };
  }

  return {
    sedes: matches.map((l) => ({
      nombre: l.name,
      ciudad: l.city,
      direccion: l.pickup_address,
      mapa: l.pickup_map,
      horario: scheduleToText(l.schedule),
    })),
  };
}

// ---------------------------------------------------------------------------
// tarifa_mensual  (monthly is per-gama, national — NOT per-city)
// ---------------------------------------------------------------------------

export const tarifaMensualSchema = {
  gama: z
    .string()
    .min(1)
    .describe("Código o nombre de gama, p. ej. 'C', 'F', 'GC', 'económico'."),
  fecha_recogida: z
    .string()
    .optional()
    .describe(
      "Fecha de inicio del alquiler en YYYY-MM-DD. Selecciona la tarifa vigente " +
        "para ESE mes (las tarifas mensuales cambian por mes). Si se omite, usa hoy.",
    ),
};

export async function runTarifaMensual(args: {
  gama: string;
  fecha_recogida?: string;
}): Promise<unknown> {
  const companyId = await getLocalizaCompanyId();
  if (!companyId) {
    return { error: "No pude consultar tarifas en este momento." };
  }
  const sb = createAdminClient();

  const { data: cats, error: catErr } = await sb
    .from("vehicle_categories")
    .select("id, code, name")
    .eq("rental_company_id", companyId)
    .eq("status", "active");
  if (catErr || !cats) {
    return { error: "No pude consultar tarifas en este momento." };
  }
  const g = norm(args.gama);
  const cat =
    cats.find((c) => norm(c.code as string) === g) ??
    cats.find((c) => norm(c.name as string).includes(g));
  if (!cat) {
    return {
      error: `No encontré la gama "${args.gama}". Gamas disponibles: ${cats
        .map((c) => c.code)
        .join(", ")}.`,
    };
  }

  const { data: pricing } = await sb
    .from("category_pricing")
    .select(
      "monthly_1k_price, monthly_2k_price, monthly_3k_price, monthly_insurance_price, valid_from, valid_until, status",
    )
    .eq("category_id", cat.id)
    .order("valid_from", { ascending: false });

  // Select the pricing row valid for the RENTAL month, not for today: monthly
  // rates vary by month, so a quote for August must use August's row even if the
  // chat runs in June. Fall back to today when no (or a malformed) date is given.
  const refDate =
    args.fecha_recogida && /^\d{4}-\d{2}-\d{2}$/.test(args.fecha_recogida)
      ? args.fecha_recogida
      : bogotaTodayYMD();
  const active = (pricing ?? []).find(
    (p) =>
      p.status === "active" &&
      (p.valid_from as string) <= refDate &&
      (!p.valid_until || (p.valid_until as string) >= refDate),
  );
  if (!active || active.monthly_1k_price == null) {
    return {
      error: `No tengo tarifa mensual vigente para la gama ${cat.code} en este momento; un asesor te ayuda con ese valor.`,
    };
  }

  return {
    gama: cat.code,
    nombre: cat.name,
    mensual_1000km: active.monthly_1k_price,
    mensual_2000km: active.monthly_2k_price,
    mensual_3000km: active.monthly_3k_price,
    seguro_mensual: active.monthly_insurance_price,
    nota: "Kilometraje LIMITADO (1000/2000 km). Mínimo 7 días de anticipación. Valor nacional, no varía por ciudad.",
  };
}

// ---------------------------------------------------------------------------
// info_gamas
// ---------------------------------------------------------------------------

export const infoGamasSchema = {
  gama: z
    .string()
    .optional()
    .describe("Código o nombre de una gama para el detalle; vacío = todas."),
};

export async function runInfoGamas(args: { gama?: string }): Promise<unknown> {
  const companyId = await getLocalizaCompanyId();
  if (!companyId) {
    return { error: "No pude consultar las gamas en este momento." };
  }
  const sb = createAdminClient();

  const { data, error } = await sb
    .from("vehicle_categories")
    .select(
      "code, name, passenger_count, luggage_count, has_ac, transmission, picoyplaca_exempt, extra_km_charge, short_description",
    )
    .eq("rental_company_id", companyId)
    .eq("status", "active")
    .order("code");
  if (error || !data) {
    return { error: "No pude consultar las gamas en este momento." };
  }

  let rows = data;
  if (args.gama) {
    const g = norm(args.gama);
    rows = data.filter(
      (c) =>
        norm(c.code as string) === g ||
        norm(c.name as string).includes(g),
    );
    if (rows.length === 0) {
      return {
        error: `No encontré la gama "${args.gama}". Gamas: ${data
          .map((c) => c.code)
          .join(", ")}.`,
      };
    }
  }

  return {
    gamas: rows.map((c) => ({
      codigo: c.code,
      nombre: c.name,
      pasajeros: c.passenger_count,
      maletas: c.luggage_count,
      aire_acondicionado: c.has_ac,
      transmision: c.transmission,
      sin_pico_y_placa: c.picoyplaca_exempt,
      cargo_km_extra: c.extra_km_charge,
      descripcion: c.short_description,
    })),
  };
}
