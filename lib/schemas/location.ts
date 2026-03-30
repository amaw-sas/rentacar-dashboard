import { z } from "zod";

export const locationSchema = z.object({
  rental_company_id: z.string().uuid("ID de rentadora inválido"),
  code: z.string().min(1, "Código es requerido"),
  name: z.string().min(1, "Nombre es requerido"),
  city: z.string().default(""),
  address: z.string().default(""),
  schedule: z.record(z.string(), z.string()).default({}),
  city_id: z.preprocess(
    (val) => (val === "" || val === undefined ? null : val),
    z.string().uuid("ID de ciudad inválido").nullable().default(null)
  ),
  slug: z.string().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type LocationFormData = z.infer<typeof locationSchema>;
