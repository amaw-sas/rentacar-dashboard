import nodemailer from "nodemailer";

const FRANCHISE_ENV_PREFIX: Record<string, string> = {
  alquilatucarro: "ALQUILATUCARRO",
  alquilame: "ALQUILAME",
  alquicarros: "ALQUICARROS",
};

export function createTransporter(franchise: string) {
  const prefix = FRANCHISE_ENV_PREFIX[franchise];

  if (!prefix) {
    throw new Error(`Unknown franchise: ${franchise}`);
  }

  const host = process.env[`${prefix}_MAIL_HOST`];
  const port = process.env[`${prefix}_MAIL_PORT`];
  const user = process.env[`${prefix}_MAIL_USER`];
  const pass = process.env[`${prefix}_MAIL_PASS`];

  if (!host || !port || !user || !pass) {
    throw new Error(
      `Missing SMTP config for franchise "${franchise}". Required: ${prefix}_MAIL_HOST, ${prefix}_MAIL_PORT, ${prefix}_MAIL_USER, ${prefix}_MAIL_PASS`
    );
  }

  return nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
  });
}
