import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createConversation,
  appendMessages,
  countRecentMessages,
  loadMessages,
} from "@/lib/chat/persistence";

// Chat persistence writes via the service-role admin client. Each function
// accepts an injected client, so we pass chainable stubs and assert the exact
// table/operation shape — no real Supabase.

describe("createConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a conversation row and returns the new id", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "conv-1" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    const client = { from } as unknown as SupabaseClient;

    const id = await createConversation("alquilatucarro", "Manizales", client);

    expect(id).toBe("conv-1");
    expect(from).toHaveBeenCalledWith("chat_conversations");
    expect(insert).toHaveBeenCalledWith({
      brand: "alquilatucarro",
      city_detected: "Manizales",
    });
  });

  it("throws when Supabase returns an error", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    const client = { from } as unknown as SupabaseClient;

    await expect(
      createConversation("alquilame", null, client),
    ).rejects.toEqual({ message: "boom" });
  });
});

describe("appendMessages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps messages to rows and inserts them", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const client = { from } as unknown as SupabaseClient;

    await appendMessages(
      "conv-1",
      [
        { role: "user", content: "hola", parts: [{ type: "text", text: "hola" }] },
        { role: "assistant", content: "buenas", parts: undefined },
      ],
      client,
    );

    expect(from).toHaveBeenCalledWith("chat_messages");
    expect(insert).toHaveBeenCalledWith([
      {
        conversation_id: "conv-1",
        role: "user",
        content: "hola",
        parts: [{ type: "text", text: "hola" }],
      },
      {
        conversation_id: "conv-1",
        role: "assistant",
        content: "buenas",
        parts: null,
      },
    ]);
  });

  it("is a no-op on an empty array (no DB call)", async () => {
    const insert = vi.fn();
    const from = vi.fn().mockReturnValue({ insert });
    const client = { from } as unknown as SupabaseClient;

    await appendMessages("conv-1", [], client);

    expect(from).not.toHaveBeenCalled();
  });
});

describe("loadMessages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the thread oldest-first, returning parts verbatim", async () => {
    const rows = [
      { role: "user", content: "hola", parts: [{ type: "text", text: "hola" }] },
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-cotizar",
            toolCallId: "call_1",
            state: "output-available",
            input: { ciudad: "cartagena" },
            output: { disponibilidad: { quote: "OPAQUE_QUOTE" } },
          },
        ],
      },
    ];
    const orderId = vi.fn().mockResolvedValue({ data: rows, error: null });
    const orderCreated = vi.fn().mockReturnValue({ order: orderId });
    const eq = vi.fn().mockReturnValue({ order: orderCreated });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as SupabaseClient;

    const result = await loadMessages("conv-1", client);

    expect(result).toBe(rows); // verbatim, not reshaped
    expect(from).toHaveBeenCalledWith("chat_messages");
    expect(select).toHaveBeenCalledWith("role, content, parts, created_at");
    expect(eq).toHaveBeenCalledWith("conversation_id", "conv-1");
    expect(orderCreated).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(orderId).toHaveBeenCalledWith("id", { ascending: true });
  });

  it("returns an empty array when there are no rows", async () => {
    const orderId = vi.fn().mockResolvedValue({ data: null, error: null });
    const orderCreated = vi.fn().mockReturnValue({ order: orderId });
    const eq = vi.fn().mockReturnValue({ order: orderCreated });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as SupabaseClient;

    await expect(loadMessages("conv-1", client)).resolves.toEqual([]);
  });

  it("throws when Supabase returns an error", async () => {
    const orderId = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const orderCreated = vi.fn().mockReturnValue({ order: orderId });
    const eq = vi.fn().mockReturnValue({ order: orderCreated });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as SupabaseClient;

    await expect(loadMessages("conv-1", client)).rejects.toEqual({ message: "boom" });
  });
});

describe("countRecentMessages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts messages at/after the given instant", async () => {
    const gte = vi.fn().mockResolvedValue({ count: 7, error: null });
    const eq = vi.fn().mockReturnValue({ gte });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as SupabaseClient;

    const n = await countRecentMessages("conv-1", "2026-06-20T00:00:00Z", client);

    expect(n).toBe(7);
    expect(from).toHaveBeenCalledWith("chat_messages");
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(eq).toHaveBeenCalledWith("conversation_id", "conv-1");
    expect(gte).toHaveBeenCalledWith("created_at", "2026-06-20T00:00:00Z");
  });

  it("returns 0 when count is null", async () => {
    const gte = vi.fn().mockResolvedValue({ count: null, error: null });
    const eq = vi.fn().mockReturnValue({ gte });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as SupabaseClient;

    const n = await countRecentMessages("conv-1", "2026-06-20T00:00:00Z", client);
    expect(n).toBe(0);
  });
});
