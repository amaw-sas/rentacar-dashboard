/**
 * Typed error carrying an HTTP status + the exact response payload.
 *
 * The public route handlers used to `return NextResponse.json(payload, { status })`
 * at several points mid-flow. When that core moves into a reusable service
 * (issue #72), the service must THROW instead of returning a Response — but the
 * public endpoint contract (consumed by rentacar-web + rentacar-reservas) must
 * stay byte-identical, including the structured Localiza business-error
 * passthrough. `ServiceError` transports both `status` and the full `payload` so
 * the handler can re-emit `NextResponse.json(payload, { status })` unchanged,
 * while an MCP tool can read `payload.shortText/message/error` for a
 * human-readable Spanish message.
 */
import { NextResponse } from "next/server";

export class ServiceError extends Error {
  constructor(
    public status: number,
    public payload: { error: string } | Record<string, unknown>,
  ) {
    super(
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "service error",
    );
    this.name = "ServiceError";
  }
}

/**
 * Maps a caught error to the public HTTP response. A `ServiceError` becomes
 * `NextResponse.json(payload, { status })` (the byte-identical contract the two
 * funnels consume); anything else is re-thrown so genuine bugs surface as 500.
 * Shared by every public route handler that delegates to a service function.
 */
export function serviceErrorToResponse(e: unknown): NextResponse {
  if (e instanceof ServiceError) {
    return NextResponse.json(e.payload, { status: e.status });
  }
  throw e;
}
