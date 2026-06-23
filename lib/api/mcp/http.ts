// ChatGPT-connector compatibility shim for the anonymous MCP server (issue #172,
// WS3). The MCP SDK is spec-strict in two ways the ChatGPT connector violates,
// which left the connector unable to connect or execute tools while Claude and
// raw curl worked. Both fixes were validated empirically against the real
// ChatGPT connector in the WS2 spike before being ported here.
//
//   1. Connection probe: ChatGPT opens a connector with an empty-body POST and
//      `Accept: */*`. That is NOT an MCP message; the SDK answers 406, which
//      ChatGPT reads as "endpoint down" and never connects. We answer the probe
//      with a benign 200 before the SDK sees it.
//   2. Accept header: the SDK requires BOTH `application/json` and
//      `text/event-stream` literally. A wildcard/partial Accept (which ChatGPT
//      sends) is 406'd. We normalize it before delegating.
//
// Claude and conformant clients are unaffected: a non-empty body is delegated and
// an already-conformant Accept is left untouched.

const MCP_ACCEPT = "application/json, text/event-stream";

/** True when the SDK would 406 this Accept (missing, wildcard, or partial). */
export function needsAcceptNormalization(accept: string | null): boolean {
  return (
    !accept ||
    !accept.includes("application/json") ||
    !accept.includes("text/event-stream")
  );
}

/** A copy of the request's headers with a conformant Accept guaranteed. */
function normalizedHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  if (needsAcceptNormalization(headers.get("accept"))) {
    headers.set("accept", MCP_ACCEPT);
  }
  return headers;
}

/**
 * Wrap an mcp-handler (or any `(Request) => Promise<Response>`) so the ChatGPT
 * connector can reach it. Short-circuits the empty-body liveness probe with a
 * 200 and normalizes the Accept header on every delegated request.
 */
export function withChatGptConnectorCompat(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === "POST") {
      // Reading the body consumes the stream once; reinject it into the request
      // forwarded to the SDK. A string body needs no `duplex` option.
      const raw = await request.text();
      if (raw.trim().length === 0) {
        return Response.json({ ok: true });
      }
      return handler(
        new Request(request.url, {
          method: "POST",
          headers: normalizedHeaders(request),
          body: raw,
        }),
      );
    }

    // GET (SSE stream open) and any other method: delegate with a conformant
    // Accept, never short-circuited as a probe.
    return handler(
      new Request(request.url, {
        method: request.method,
        headers: normalizedHeaders(request),
      }),
    );
  };
}
