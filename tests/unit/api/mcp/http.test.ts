import { describe, it, expect, vi } from "vitest";
import {
  needsAcceptNormalization,
  withChatGptConnectorCompat,
} from "@/lib/api/mcp/http";

// WS3 (issue #172): the wrapper that makes the anonymous MCP server reachable by
// the ChatGPT connector. Holdout SCEN-W1..W3, W7. The wrapped handler is a spy —
// we assert what reaches the SDK (Accept normalized, body preserved), never the
// real transport.

const MCP_ACCEPT = "application/json, text/event-stream";

function spyHandler() {
  const received: Request[] = [];
  const handler = vi.fn(async (req: Request) => {
    received.push(req);
    return new Response("delegated", { status: 200 });
  });
  return { handler, received };
}

describe("withChatGptConnectorCompat", () => {
  // SCEN-W1 — the ChatGPT connection liveness probe.
  it("SCEN-W1: empty-body POST probe → 200 {ok:true}, SDK never called", async () => {
    const { handler } = spyHandler();
    const wrapped = withChatGptConnectorCompat(handler);

    const res = await wrapped(
      new Request("https://x/api/mcp/mcp", {
        method: "POST",
        headers: { accept: "*/*", "content-type": "application/octet-stream" },
        body: "",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).not.toHaveBeenCalled();
  });

  // SCEN-W1 (facet) — a whitespace-only body is still a probe, not an MCP message.
  it("SCEN-W1b: whitespace-only POST body is treated as the probe", async () => {
    const { handler } = spyHandler();
    const wrapped = withChatGptConnectorCompat(handler);

    const res = await wrapped(
      new Request("https://x/api/mcp/mcp", {
        method: "POST",
        headers: { accept: "*/*" },
        body: "   \n  ",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).not.toHaveBeenCalled();
  });

  // SCEN-W2 — a real MCP message with a wildcard Accept must reach the SDK with a
  // conformant Accept (else the SDK 406s it), body intact.
  it("SCEN-W2: real message with Accept:*/* → Accept normalized, body preserved, delegated", async () => {
    const { handler, received } = spyHandler();
    const wrapped = withChatGptConnectorCompat(handler);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    const res = await wrapped(
      new Request("https://x/api/mcp/mcp", {
        method: "POST",
        headers: { accept: "*/*" },
        body,
      }),
    );

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    const got = received[0];
    expect(got.method).toBe("POST");
    expect(got.headers.get("accept")).toBe(MCP_ACCEPT);
    expect(await got.text()).toBe(body);
  });

  // SCEN-W3 — a conformant client (Claude/curl) is not altered.
  it("SCEN-W3: conformant Accept preserved (no regression), body preserved", async () => {
    const { handler, received } = spyHandler();
    const wrapped = withChatGptConnectorCompat(handler);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    await wrapped(
      new Request("https://x/api/mcp/mcp", {
        method: "POST",
        headers: { accept: MCP_ACCEPT },
        body,
      }),
    );

    const got = received[0];
    expect(got.headers.get("accept")).toBe(MCP_ACCEPT);
    expect(await got.text()).toBe(body);
  });

  // SCEN-W7 — GET (SSE stream open) is delegated, never short-circuited as a probe.
  it("SCEN-W7: GET is delegated to the SDK, Accept normalized when wildcard", async () => {
    const { handler, received } = spyHandler();
    const wrapped = withChatGptConnectorCompat(handler);

    const res = await wrapped(
      new Request("https://x/api/mcp/mcp", {
        method: "GET",
        headers: { accept: "*/*" },
      }),
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(received[0].method).toBe("GET");
    expect(received[0].headers.get("accept")).toBe(MCP_ACCEPT);
  });
});

describe("needsAcceptNormalization", () => {
  it("flags missing, wildcard, and partial Accept; passes a conformant one", () => {
    expect(needsAcceptNormalization(null)).toBe(true);
    expect(needsAcceptNormalization("*/*")).toBe(true);
    expect(needsAcceptNormalization("application/json")).toBe(true);
    expect(needsAcceptNormalization("text/event-stream")).toBe(true);
    expect(needsAcceptNormalization(MCP_ACCEPT)).toBe(false);
    expect(
      needsAcceptNormalization("text/event-stream, application/json"),
    ).toBe(false);
  });
});
