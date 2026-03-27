import { z } from "zod";

export const categoryPricingSchema = z.object({
  category_id: z.string().uuid("ID de categoría inválido"),
  total_coverage_unit_charge: z.coerce.number().min(0).default(0),
  monthly_1k_price: z.coerce.number().min(0).nullable().default(null),
  monthly_2k_price: z.coerce.number().min(0).nullable().default(null),
  monthly_3k_price: z.coerce.number().min(0).nullable().default(null),
  monthly_insurance_price: z.coerce.number().min(0).nullable().default(null),
  monthly_one_day_price: z.coerce.number().min(0).nullable().default(null),
  valid_from: z.string().min(1, "Fecha inicio es requerida"),
  valid_until: z.string().nullable().default(null),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type CategoryPricingFormData = z.infer<typeof categoryPricingSchema>;
