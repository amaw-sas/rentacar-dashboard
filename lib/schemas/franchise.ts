import { z } from "zod";

export const franchiseSchema = z.object({
  code: z.string().min(1, "Código es requerido"),
  display_name: z.string().min(1, "Nombre es requerido"),
  website: z.string().default(""),
  phone: z.string().default(""),
  whatsapp: z.string().default(""),
  logo_url: z.string().default(""),
  sender_email: z.string().email("Email remitente inválido"),
  sender_name: z.string().min(1, "Nombre remitente es requerido"),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type FranchiseFormData = z.infer<typeof franchiseSchema>;
