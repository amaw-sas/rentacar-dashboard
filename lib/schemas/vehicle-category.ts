import { z } from "zod";

export const vehicleCategorySchema = z.object({
  rental_company_id: z.string().uuid("ID de rentadora inválido"),
  code: z.string().min(1, "Código es requerido"),
  name: z.string().min(1, "Nombre es requerido"),
  description: z.string().default(""),
  image_url: z.string().default(""),
  passenger_count: z.coerce.number().int().min(0).default(0),
  luggage_count: z.coerce.number().int().min(0).default(0),
  extra_km_charge: z.coerce.number().min(0).default(0),
  has_ac: z.boolean().default(true),
  // Issue #28 Ola B2: true = exempt from pico y placa (web shows the
  // "sin pico y placa" badge). Source of truth, replaces the web hardcoded list.
  picoyplaca_exempt: z.boolean().default(false),
  transmission: z.enum(["automatic", "manual"]).default("manual"),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type VehicleCategoryFormData = z.infer<typeof vehicleCategorySchema>;
