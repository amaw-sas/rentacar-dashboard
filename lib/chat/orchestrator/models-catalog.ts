import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Model names per gama code, for the Controller's context (Controlador · resolución de
 * referencias). Customers name a model ("el Picanto", "el Sandero", "la Duster") to mean a
 * gama; the model→gama map lives in Supabase `category_models` (the same table that feeds the
 * vehicle cards). The Controller needs it to map that model back to a quoted gama code.
 *
 * Batched into TWO queries (categories + their models) regardless of how many gamas, then
 * cached in conversation state at quote time so later turns cost nothing. Codes are matched
 * case-insensitively (Localiza returns "C"/"G4"; the table's casing may differ) and the result
 * is keyed by the QUOTE's code so the Controller's lookup lines up with the shown table.
 *
 * Anonymous chat route → service-role admin client (same as gama-cards/persistence).
 * Best-effort: ANY failure returns {} so the turn (and the Controller) never breaks.
 */
export async function getModelsByGama(
  codes: string[],
): Promise<Record<string, string[]>> {
  try {
    const wanted = Array.from(
      new Set(codes.map((c) => c.trim()).filter(Boolean)),
    );
    if (!wanted.length) return {};

    const supabase = createAdminClient();

    // vehicle_categories is a small reference table → read it and match in JS so casing
    // mismatches ("c" vs "C") never drop a gama (a case-sensitive `.in()` would).
    const { data: cats, error: catErr } = await supabase
      .from("vehicle_categories")
      .select("id, code");
    if (catErr || !cats?.length) return {};

    const lcToQuoteCode = new Map(wanted.map((w) => [w.toLowerCase(), w]));
    const idToQuoteCode = new Map<string, string>();
    for (const c of cats as Array<{ id?: string; code?: string }>) {
      const qc = c.code ? lcToQuoteCode.get(c.code.toLowerCase()) : undefined;
      if (c.id && qc) idToQuoteCode.set(c.id, qc);
    }
    const ids = Array.from(idToQuoteCode.keys());
    if (!ids.length) return {};

    const { data: models, error: mErr } = await supabase
      .from("category_models")
      .select("category_id, name")
      .in("category_id", ids)
      .eq("status", "active");
    if (mErr || !models?.length) return {};

    const out: Record<string, string[]> = {};
    for (const m of models as Array<{
      category_id?: string;
      name?: string | null;
    }>) {
      const code = m.category_id ? idToQuoteCode.get(m.category_id) : undefined;
      const name = String(m.name ?? "").trim();
      if (!code || !name) continue;
      (out[code] ??= []).push(name);
    }
    return out;
  } catch {
    return {};
  }
}
