import { Resend } from "resend";

const FRANCHISE_ENV_PREFIX = {
  alquilatucarro: "ALQUILATUCARRO",
  alquilame: "ALQUILAME",
  alquicarros: "ALQUICARROS",
} as const;

export function getResendClient(franchise: string): Resend {
  const prefix =
    FRANCHISE_ENV_PREFIX[franchise as keyof typeof FRANCHISE_ENV_PREFIX];

  if (!prefix) {
    throw new Error(`Unknown franchise: ${franchise}`);
  }

  const apiKey = process.env[`${prefix}_RESEND_API_KEY`];
  if (!apiKey) {
    throw new Error(
      `Missing Resend API key for franchise "${franchise}". Required: ${prefix}_RESEND_API_KEY`
    );
  }

  return new Resend(apiKey);
}
