import { z } from "zod";

export const referralSchema = z.object({
  code: z
    .string()
    .min(1, "Código es requerido")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Código debe ser URL-safe (letras minúsculas, números y guiones)"),
  name: z.string().min(1, "Nombre es requerido"),
  type: z.enum(["company", "hotel", "salesperson", "other"]),
  contact_name: z.string().default(""),
  contact_email: z.string().default(""),
  contact_phone: z.string().default(""),
  commission_notes: z.string().default(""),
  notes: z.string().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type ReferralFormData = z.infer<typeof referralSchema>;
