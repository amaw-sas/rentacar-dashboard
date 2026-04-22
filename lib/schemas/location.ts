import { z } from "zod";

export const locationSchema = z.object({
  rental_company_id: z.string().uuid("ID de rentadora inválido"),
  code: z.string().min(1, "Código es requerido"),
  name: z.string().min(1, "Nombre es requerido"),
  city: z.string().default(""),
  pickup_address: z.string().min(1, "Dirección de recogida es requerida"),
  pickup_map: z.string().min(1, "URL de mapa de recogida es requerida"),
  return_address: z.string().nullable().default(null),
  return_map: z.string().nullable().default(null),
  schedule: z.record(z.string(), z.string()).default({}),
  city_id: z.string().uuid("Debes seleccionar una ciudad"),
  slug: z.string().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type LocationFormData = z.infer<typeof locationSchema>;
