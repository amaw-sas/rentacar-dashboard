import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const blob = await put(`rentacar/${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
  });

  return NextResponse.json(blob);
}
