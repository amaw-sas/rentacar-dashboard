import { createAdminClient } from "@/lib/supabase/admin";
import { getGhlConfig } from "./config";
import { upsertContact, createOpportunity, updateOpportunity } from "./client";
import {
  mapReservationToContact,
  mapReservationToOpportunity,
} from "./mapper";

export async function syncReservationToGhl(
  reservationId: string
): Promise<void> {
  try {
    const supabase = createAdminClient();

    const { data: reservation, error } = await supabase
      .from("reservations")
      .select(
        `*, customers(first_name, last_name, email, phone),
        pickup_location:locations!pickup_location_id(name),
        return_location:locations!return_location_id(name)`
      )
      .eq("id", reservationId)
      .single();

    if (error || !reservation) {
      console.error(
        `[ghl] Failed to fetch reservation ${reservationId}:`,
        error?.message
      );
      return;
    }

    const config = getGhlConfig(reservation.franchise);
    if (!config) return;

    // 1. Upsert contact
    let contactId = reservation.ghl_contact_id as string | null;

    if (!contactId) {
      const contactData = mapReservationToContact(
        reservation as Parameters<typeof mapReservationToContact>[0],
        config.location_id
      );
      contactId = await upsertContact(
        config.api_key,
        config.location_id,
        contactData
      );

      if (!contactId) {
        console.error(
          `[ghl] Failed to upsert contact for reservation ${reservationId}`
        );
        return;
      }

      await supabase
        .from("reservations")
        .update({ ghl_contact_id: contactId })
        .eq("id", reservationId);
    }

    // 2. Create or update opportunity
    const opportunityData = mapReservationToOpportunity(
      { ...reservation, ghl_contact_id: contactId } as Parameters<
        typeof mapReservationToOpportunity
      >[0],
      config
    );

    const existingOpportunityId = reservation.ghl_opportunity_id as
      | string
      | null;

    if (existingOpportunityId) {
      const success = await updateOpportunity(
        config.api_key,
        existingOpportunityId,
        opportunityData
      );
      if (!success) {
        console.error(
          `[ghl] Failed to update opportunity ${existingOpportunityId} for reservation ${reservationId}`
        );
        return;
      }
    } else {
      const opportunityId = await createOpportunity(
        config.api_key,
        opportunityData as Parameters<typeof createOpportunity>[1]
      );

      if (!opportunityId) {
        console.error(
          `[ghl] Failed to create opportunity for reservation ${reservationId}`
        );
        return;
      }

      await supabase
        .from("reservations")
        .update({ ghl_opportunity_id: opportunityId })
        .eq("id", reservationId);
    }

    // 3. Update sync timestamp
    await supabase
      .from("reservations")
      .update({ ghl_last_sync: new Date().toISOString() })
      .eq("id", reservationId);

    console.log(
      `[ghl] Synced reservation ${reservationId} (opportunity: ${existingOpportunityId ?? "new"})`
    );
  } catch (error) {
    console.error(
      `[ghl] Failed to sync reservation ${reservationId}:`,
      error
    );
  }
}
