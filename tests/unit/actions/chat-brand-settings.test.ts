import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { setChatBrandEnabled } from "@/lib/actions/chat-brand-settings";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Build a server client whose auth + upsert outcomes are configurable.
function setupMock({
  user = { id: "u1" } as { id: string } | null,
  upsertError = null as { message: string } | null,
} = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError });
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn(() => ({ upsert })),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return { upsert };
}

describe("setChatBrandEnabled", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an invalid brand before touching the DB", async () => {
    setupMock();
    const res = await setChatBrandEnabled("notabrand", true);
    expect(res.error).toBe("Marca inválida");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("S7: requires an authenticated user", async () => {
    const { upsert } = setupMock({ user: null });
    const res = await setChatBrandEnabled("alquilatucarro", true);
    expect(res.error).toBe("No autenticado");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("S4: upserts the brand state and revalidates the page", async () => {
    const { upsert } = setupMock();
    const res = await setChatBrandEnabled("alquilatucarro", true);
    expect(res.error).toBeUndefined();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ brand: "alquilatucarro", enabled: true }),
      { onConflict: "brand" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/chat-knowledge");
  });

  it("surfaces a DB error and does not revalidate", async () => {
    setupMock({ upsertError: { message: "rls denied" } });
    const res = await setChatBrandEnabled("alquilame", false);
    expect(res.error).toBe("rls denied");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
