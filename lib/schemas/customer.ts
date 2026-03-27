import { z } from "zod";

export const customerSchema = z.object({
  first_name: z.string().min(1, "Nombre es requerido"),
  last_name: z.string().min(1, "Apellido es requerido"),
  identification_type: z.enum(["CC", "CE", "NIT", "PP", "TI"]),
  identification_number: z.string().min(1, "Número de identificación es requerido"),
  phone: z.string().default(""),
  email: z.string().email("Email inválido"),
  notes: z.string().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type CustomerFormData = z.infer<typeof customerSchema>;
