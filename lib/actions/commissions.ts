"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseCommissionExcel } from "@/lib/parsers/commission-parser";

export async function importCommissions(formData: FormData): Promise<{
  importId?: string;
  totalRows?: number;
  matchedRows?: number;
  unmatchedRows?: number;
  error?: string;
}> {
  const file = formData.get("file") as File | null;
  const rentalCompanyId = formData.get("rental_company_id") as string | null;
  const periodLabel = formData.get("period_label") as string | null;

  if (!file || file.size === 0) {
    return { error: "Debe seleccionar un archivo Excel" };
  }
  if (!rentalCompanyId) {
    return { error: "Debe seleccionar una rentadora" };
  }

  let rows;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    rows = await parseCommissionExcel(buffer);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al leer el archivo";
    return { error: message };
  }

  if (rows.length === 0) {
    return { error: "El archivo no contiene filas de comisiones" };
  }

  const supabase = await createClient();

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // Match each row against reservations by reservation_code
  const reservationCodes = rows.map((r) => r.reservation_code);
  const { data: matchedReservations } = await supabase
    .from("reservations")
    .select("id, reservation_code")
    .in("reservation_code", reservationCodes);

  const codeToReservation = new Map(
    (matchedReservations ?? []).map((r) => [r.reservation_code, r.id])
  );

  let matchedCount = 0;
  let unmatchedCount = 0;
  let totalCommission = 0;

  const commissionRecords = rows.map((row) => {
    const reservationId = codeToReservation.get(row.reservation_code) ?? null;
    const matchStatus = reservationId ? "matched" : "unmatched";
    if (reservationId) matchedCount++;
    else unmatchedCount++;
    totalCommission += row.commission_amount;

    return {
      reservation_id: reservationId,
      import_batch_id: "", // placeholder, set after import record creation
      customer_name_raw: row.customer_name,
      reservation_code_raw: row.reservation_code,
      reservation_value: row.reservation_value,
      commission_amount: row.commission_amount,
      commission_rate: row.commission_rate,
      contract_type: row.contract_type,
      real_value: row.real_value,
      commission_month: row.commission_month,
      match_status: matchStatus,
      payment_status: "pending" as const,
    };
  });

  // Create import batch record
  const { data: importRecord, error: importError } = await supabase
    .from("commission_imports")
    .insert({
      rental_company_id: rentalCompanyId,
      file_name: file.name,
      period_label: periodLabel || null,
      total_rows: rows.length,
      matched_rows: matchedCount,
      unmatched_rows: unmatchedCount,
      total_commission: totalCommission,
      imported_by: user.id,
    })
    .select("id")
    .single();

  if (importError) {
    return { error: importError.message };
  }

  // Set the import_batch_id on all commission records
  const recordsWithBatchId = commissionRecords.map((r) => ({
    ...r,
    import_batch_id: importRecord.id,
  }));

  const { error: insertError } = await supabase
    .from("commissions")
    .insert(recordsWithBatchId);

  if (insertError) {
    // Cleanup import record on failure
    await supabase.from("commission_imports").delete().eq("id", importRecord.id);
    return { error: insertError.message };
  }

  revalidatePath("/commissions");
  return {
    importId: importRecord.id,
    totalRows: rows.length,
    matchedRows: matchedCount,
    unmatchedRows: unmatchedCount,
  };
}

export async function linkCommission(
  commissionId: string,
  reservationId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("commissions")
    .update({
      reservation_id: reservationId,
      match_status: "manual",
    })
    .eq("id", commissionId);

  if (error) return { error: error.message };

  revalidatePath("/commissions");
  revalidatePath(`/commissions/${commissionId}`);
  return {};
}

export async function batchUpdatePaymentStatus(
  commissionIds: string[],
  status: "invoiced" | "paid",
  invoiceNumber?: string
): Promise<{ error?: string }> {
  if (commissionIds.length === 0) {
    return { error: "No se seleccionaron comisiones" };
  }

  const supabase = await createClient();

  const updateData: Record<string, unknown> = { payment_status: status };
  if (status === "invoiced" && invoiceNumber) {
    updateData.invoice_number = invoiceNumber;
    updateData.invoice_date = new Date().toISOString().split("T")[0];
  }
  if (status === "paid") {
    updateData.payment_date = new Date().toISOString().split("T")[0];
  }

  const { error } = await supabase
    .from("commissions")
    .update(updateData)
    .in("id", commissionIds);

  if (error) return { error: error.message };

  revalidatePath("/commissions");
  return {};
}

export async function updateCommission(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const notes = formData.get("notes") as string | null;
  const invoiceNumber = formData.get("invoice_number") as string | null;
  const invoiceDate = formData.get("invoice_date") as string | null;
  const paymentDate = formData.get("payment_date") as string | null;
  const paymentStatus = formData.get("payment_status") as string | null;

  const supabase = await createClient();

  const updateData: Record<string, unknown> = {};
  if (notes !== null) updateData.notes = notes || null;
  if (invoiceNumber !== null) updateData.invoice_number = invoiceNumber || null;
  if (invoiceDate !== null) updateData.invoice_date = invoiceDate || null;
  if (paymentDate !== null) updateData.payment_date = paymentDate || null;
  if (paymentStatus) updateData.payment_status = paymentStatus;

  const { error } = await supabase
    .from("commissions")
    .update(updateData)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/commissions");
  revalidatePath(`/commissions/${id}`);
  return {};
}
