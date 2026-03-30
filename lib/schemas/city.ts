import { z } from "zod";

export const citySchema = z.object({
  name: z.string().min(1, "Nombre es requerido"),
  slug: z
    .string()
    .min(1, "Slug es requerido")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug debe ser URL-safe (letras minúsculas, números y guiones)"),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type CityFormData = z.infer<typeof citySchema>;
