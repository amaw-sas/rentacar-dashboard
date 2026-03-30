import { z } from "zod";

export const categoryModelSchema = z.object({
  category_id: z.string().uuid("ID de categoría inválido"),
  name: z.string().min(1, "Nombre es requerido"),
  description: z.string().default(""),
  image_url: z.string().default(""),
  is_default: z.boolean().default(false),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type CategoryModelFormData = z.infer<typeof categoryModelSchema>;
