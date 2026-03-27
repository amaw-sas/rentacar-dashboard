import { z } from "zod";

export const MATCH_STATUSES = ["matched", "unmatched", "manual"] as const;
export const PAYMENT_STATUSES = ["pending", "invoiced", "paid"] as const;

export const MATCH_STATUS_LABELS: Record<(typeof MATCH_STATUSES)[number], string> = {
  matched: "Vinculada",
  unmatched: "Sin vincular",
  manual: "Vinculación manual",
};

export const PAYMENT_STATUS_LABELS: Record<(typeof PAYMENT_STATUSES)[number], string> = {
  pending: "Pendiente",
  invoiced: "Facturada",
  paid: "Pagada",
};

export const commissionSchema = z.object({
  reservation_id: z.string().uuid().nullable().default(null),
  import_batch_id: z.string().uuid(),
  customer_name_raw: z.string().min(1),
  reservation_code_raw: z.string().min(1),
  reservation_value: z.coerce.number().min(0),
  commission_amount: z.coerce.number().min(0),
  commission_rate: z.coerce.number().nullable().default(null),
  contract_type: z.string().nullable().default(null),
  real_value: z.coerce.number().nullable().default(null),
  commission_month: z.string().nullable().default(null),
  match_status: z.enum(MATCH_STATUSES).default("unmatched"),
  payment_status: z.enum(PAYMENT_STATUSES).default("pending"),
  invoice_number: z.string().nullable().default(null),
  invoice_date: z.string().nullable().default(null),
  payment_date: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

export type CommissionFormData = z.infer<typeof commissionSchema>;
