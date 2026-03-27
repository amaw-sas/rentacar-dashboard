import { z } from "zod";

export const rentalCompanySchema = z.object({
  name: z.string().min(1, "Nombre es requerido"),
  code: z.string().min(1, "Código es requerido"),
  commission_rate_min: z.coerce.number().min(0).max(100).nullable().default(null),
  commission_rate_max: z.coerce.number().min(0).max(100).nullable().default(null),
  contact_name: z.string().default(""),
  contact_email: z.string().default(""),
  contact_phone: z.string().default(""),
  api_base_url: z.string().default(""),
  extra_driver_day_price: z.coerce.number().min(0).default(0),
  baby_seat_day_price: z.coerce.number().min(0).default(0),
  wash_price: z.coerce.number().min(0).default(0),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type RentalCompanyFormData = z.infer<typeof rentalCompanySchema>;
