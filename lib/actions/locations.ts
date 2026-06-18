"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { locationSchema, type LocationFormData } from "@/lib/schemas/location";
import { deriveScheduleDisplay, stripDisplay } from "@/lib/schedule/derive-display";

/**
 * Parses + validates the location FormData and derives `schedule.display`
 * server-side (authoritative — a client cannot bypass it).
 *
 * `schedule` arrives as a JSON string (the form serializes the structured days);
 * `Object.fromEntries` leaves it as text, so it must be JSON-parsed before zod.
 * Without this round-trip the schema's `schedule.default({})` would silently
 * blank the column on every save (the issue #97 latent data-loss bug).
 */
function parseLocation(
  formData: FormData
): { data: LocationFormData } | { error: string } {
  const raw = Object.fromEntries(formData.entries()) as Record<string, unknown>;

  if (typeof raw.schedule === "string") {
    try {
      raw.schedule = JSON.parse(raw.schedule);
    } catch {
      return { error: "schedule: JSON inválido" };
    }
  }

  const parsed = locationSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Re-derive display from the structured days (ignores any injected display).
  const days = stripDisplay(parsed.data.schedule);

  // Fail-loud on multi-range days: the editor only emits one range per day (D3
  // scope), but the D1 schema allows arrays. A multi-range day would derive to a
  // `display` the D2 parser (and the web) cannot parse — reject before persisting
  // rather than write a string that breaks rentacar-web.
  for (const [key, ranges] of Object.entries(days)) {
    if (Array.isArray(ranges) && ranges.length > 1) {
      return { error: `schedule: solo se admite un rango por día (${key})` };
    }
  }

  const data: LocationFormData = {
    ...parsed.data,
    schedule: { ...days, display: deriveScheduleDisplay(days) },
  };
  return { data };
}

export async function createLocation(
  formData: FormData
): Promise<{ error?: string }> {
  const result = parseLocation(formData);
  if ("error" in result) return { error: result.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("locations")
    .insert(result.data);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una sucursal con ese código para esta rentadora" };
    }
    return { error: error.message };
  }

  revalidatePath("/locations");
  return {};
}

export async function updateLocation(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const result = parseLocation(formData);
  if ("error" in result) return { error: result.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("locations")
    .update(result.data)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una sucursal con ese código para esta rentadora" };
    }
    return { error: error.message };
  }

  revalidatePath("/locations");
  return {};
}
