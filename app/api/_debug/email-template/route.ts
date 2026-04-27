import { NextResponse } from "next/server";
import { renderEmail } from "@/lib/email/render";
import { ReservedClientEmail } from "@/lib/email/templates/reserved-client";

// Diagnostic endpoint — confirms which version of ReservedClientEmail the
// deployed bundle actually executes. Compare `htmlLength` + presence of new
// vs old marker strings to source code on the active commit. Remove once
// the email-template-stale incident is resolved.
export async function GET() {
  const html = await renderEmail(
    ReservedClientEmail({
      franchiseName: "Debug",
      franchiseColor: "#000000",
      franchiseWebsite: "https://example.com",
      franchisePhone: "+57 000 000 0000",
      franchiseLogo: undefined,
      customerName: "Debug User",
      categoryName: "Debug",
      pickupLocation: "Debug",
      pickupDate: "1 de enero 2026",
      pickupHour: "10:00 AM",
      returnLocation: "Debug",
      returnDate: "5 de enero 2026",
      returnHour: "10:00 AM",
      selectedDays: 4,
      reserveCode: "DEBUG",
      totalPrice: 100000,
      taxFee: 5000,
      ivaFee: 15000,
      totalPriceToPay: 120000,
      totalInsurance: true,
      extraDriver: true,
      babySeat: true,
      wash: true,
      extraDriverDayPrice: 10000,
      washPrice: 20000,
      washOnsitePrice: 30000,
      washDeepPrice: 40000,
      washDeepUpholsteryPrice: 50000,
    })
  );

  const markers = {
    new_antes_recoger: html.includes("Antes de recoger"),
    new_autoseguro: html.includes("AUTOSEGURO"),
    new_lavado: html.includes("Lavado de vehículo"),
    new_pico_placa: html.includes("pico y placa"),
    old_requisitos: html.includes("Requisitos para la Recogida"),
    old_tarjeta_titular: html.includes("Tarjeta de crédito a nombre del titular"),
  };

  return NextResponse.json(
    {
      buildCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      buildCommitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      vercelRegion: process.env.VERCEL_REGION ?? null,
      htmlLength: html.length,
      markers,
      verdict:
        markers.new_antes_recoger && markers.new_autoseguro && !markers.old_requisitos
          ? "fresh-bundle"
          : markers.old_requisitos
          ? "stale-bundle-pre-a02f8b9"
          : "unknown",
    },
    { headers: { "cache-control": "no-store" } }
  );
}
