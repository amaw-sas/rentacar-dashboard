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

// Subconjunto de contacto editable desde la edición de reserva (#36).
// Omite notes y status: el update parcial NO debe resetearlos a sus defaults.
// Endurece los 3 campos de texto con trim + non-empty (whitespace-only
// corromper­ía el label del combobox y las notificaciones). No toca
// customerSchema — el endurecimiento vive solo en este path.
export const customerContactSchema = customerSchema
  .pick({
    first_name: true,
    last_name: true,
    identification_type: true,
    identification_number: true,
    phone: true,
    email: true,
  })
  .extend({
    first_name: z.string().trim().min(1, "Nombre es requerido"),
    last_name: z.string().trim().min(1, "Apellido es requerido"),
    identification_number: z
      .string()
      .trim()
      .min(1, "Número de identificación es requerido"),
  });

export type CustomerContactFormData = z.infer<typeof customerContactSchema>;
