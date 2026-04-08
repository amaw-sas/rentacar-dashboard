import { NextResponse } from "next/server";

export async function POST(request: Request) {
  // Validate API key
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.RESERVATION_API_KEY) {
    return NextResponse.json(
      { error: "No autorizado" },
      { status: 401 }
    );
  }

  const proxyUrl = process.env.LOCALIZA_PROXY_URL;
  const proxyApiKey = process.env.PROXY_API_KEY;

  if (!proxyUrl || !proxyApiKey) {
    console.error("[availability] Missing LOCALIZA_PROXY_URL or PROXY_API_KEY");
    return NextResponse.json(
      { error: "Configuración del servidor incompleta" },
      { status: 500 }
    );
  }

  let body: {
    pickupLocation: string;
    returnLocation: string;
    pickupDateTime: string;
    returnDateTime: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Cuerpo de solicitud inválido" },
      { status: 400 }
    );
  }

  const { pickupLocation, returnLocation, pickupDateTime, returnDateTime } = body;

  if (!pickupLocation || !returnLocation || !pickupDateTime || !returnDateTime) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: pickupLocation, returnLocation, pickupDateTime, returnDateTime" },
      { status: 400 }
    );
  }

  try {
    const proxyResponse = await fetch(`${proxyUrl}/api/localiza/availability`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": proxyApiKey,
      },
      body: JSON.stringify({ pickupLocation, returnLocation, pickupDateTime, returnDateTime }),
    });

    if (!proxyResponse.ok) {
      const errorBody = await proxyResponse.text();
      console.error(`[availability] Proxy error ${proxyResponse.status}:`, errorBody);
      return NextResponse.json(
        { error: "Error al consultar disponibilidad" },
        { status: 502 }
      );
    }

    const data = await proxyResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[availability] Request failed:", error);
    return NextResponse.json(
      { error: "Error al conectar con el servicio de disponibilidad" },
      { status: 502 }
    );
  }
}
