import { describe, it, expect, vi, beforeEach } from "vitest";

// Turn-error capture (chat observability). recordTurnError must (1) record a
// tool='turn', ok=false telemetry row and (2) drop a 'system' marker into the
// conversation thread — both best-effort, never throwing. We mock the telemetry
// and persistence seams to assert the calls.

const { recordToolEvent } = vi.hoisted(() => ({ recordToolEvent: vi.fn() }));
vi.mock("@/lib/chat/tool-events", () => ({ recordToolEvent }));

const { appendMessages } = vi.hoisted(() => ({ appendMessages: vi.fn() }));
vi.mock("@/lib/chat/persistence", () => ({ appendMessages }));

import { recordTurnError } from "@/lib/chat/turn-error";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  recordToolEvent.mockResolvedValue(undefined);
  appendMessages.mockResolvedValue(undefined);
});

describe("recordTurnError", () => {
  it("records a tool='turn', ok=false telemetry row with the error message + context", async () => {
    await recordTurnError({
      error: new Error("boom from gateway"),
      conversationId: "conv-1",
      ipHash: "iphash",
      brand: "alquilatucarro",
    });

    expect(recordToolEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "turn",
        ok: false,
        errorCode: "boom from gateway",
        brand: "alquilatucarro",
        conversationId: "conv-1",
        ipHash: "iphash",
      }),
    );
  });

  it("persists a 'system' error marker into the conversation thread", async () => {
    await recordTurnError({ error: new Error("kaboom"), conversationId: "conv-1" });

    expect(appendMessages).toHaveBeenCalledWith("conv-1", [
      expect.objectContaining({ role: "system", content: "⚠️ Error del turno: kaboom" }),
    ]);
  });

  it("skips the thread marker when there is no conversation id", async () => {
    await recordTurnError({ error: new Error("no convo") });
    expect(recordToolEvent).toHaveBeenCalledOnce();
    expect(appendMessages).not.toHaveBeenCalled();
  });

  it("stringifies non-Error throwables and never rejects", async () => {
    await expect(
      recordTurnError({ error: "plain string", conversationId: "c" }),
    ).resolves.toBeUndefined();
    expect(recordToolEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "turn", ok: false, errorCode: "plain string" }),
    );
  });
});
