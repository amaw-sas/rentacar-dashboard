import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Vehicle model cards by gama (Rediseño híbrido · Etapa 4). The chat now SHOWS the
 * representative models of a gama (with photo) instead of refusing ("no puedo enviar
 * fotos"). Code owns this: it reads `category_models` for the gama's category and
 * returns a flat part the page renders as image+name cards. The model assigned at the
 * branch is still by gama — these are illustrative.
 *
 * Anonymous chat route → uses the service-role admin client (same as persistence and
 * knowledge-store). Best-effort: any DB failure returns null so the turn never breaks.
 */

export interface GamaCard {
  nombre: string;
  /** Model photo URL; "" when the row has none (the page shows the name only). */
  imagen: string;
}

export interface GamaCardsPart {
  /** Gama code, uppercased (e.g. "F", "CX"). */
  gama: string;
  /** Human gama description when known (e.g. "Sedán mecánico"). */
  descripcion?: string;
  modelos: GamaCard[];
}

/**
 * Active models for a gama code, ordered (default first, then by name). Maps the gama
 * `code` → `vehicle_categories.id` → `category_models`. Returns null when the category
 * doesn't exist, has no active models, or the DB call fails.
 */
export async function getGamaCards(
  gamaCode: string,
  descripcion?: string,
): Promise<GamaCardsPart | null> {
  try {
    const code = gamaCode.trim();
    if (!code) return null;

    const supabase = createAdminClient();

    const { data: cat, error: catErr } = await supabase
      .from("vehicle_categories")
      .select("id")
      .ilike("code", code)
      .limit(1)
      .maybeSingle();
    const categoryId = (cat as { id?: string } | null)?.id;
    if (catErr || !categoryId) return null;

    const { data, error } = await supabase
      .from("category_models")
      .select("name, image_url, is_default")
      .eq("category_id", categoryId)
      .eq("status", "active")
      .order("is_default", { ascending: false })
      .order("name", { ascending: true });
    if (error) return null;

    const rows = (data ?? []) as Array<{
      name?: string | null;
      image_url?: string | null;
    }>;
    if (rows.length === 0) return null;

    const modelos: GamaCard[] = rows.map((m) => ({
      nombre: String(m.name ?? "").trim(),
      imagen: typeof m.image_url === "string" ? m.image_url : "",
    }));

    return { gama: code.toUpperCase(), descripcion, modelos };
  } catch {
    return null;
  }
}
