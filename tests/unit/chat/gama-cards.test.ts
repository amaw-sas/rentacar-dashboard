import { describe, it, expect, vi, beforeEach } from "vitest";

// The chat route is anonymous, so getGamaCards reads via the service-role admin
// client. Mock it with a chainable builder: the category query ends in
// `.maybeSingle()` (a promise) and the models query is awaited directly (thenable).

interface Result {
  data: unknown;
  error: unknown;
}

function makeBuilder(maybeSingleResult: Result, awaitedResult: Result) {
  const q = {
    select: () => q,
    ilike: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve(maybeSingleResult),
    then: (
      res: (v: Result) => unknown,
      rej?: (e: unknown) => unknown,
    ) => Promise.resolve(awaitedResult).then(res, rej),
  };
  return q;
}

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

import { getGamaCards } from "@/lib/chat/orchestrator/gama-cards";

beforeEach(() => {
  fromMock.mockReset();
});

/** Wire the two table reads (category lookup + models list). */
function wire(category: Result, models: Result) {
  fromMock.mockImplementation((table: string) =>
    table === "vehicle_categories"
      ? makeBuilder(category, { data: null, error: null })
      : makeBuilder({ data: null, error: null }, models),
  );
}

describe("getGamaCards", () => {
  it("returns the active models ordered (default first), incl. ones without image", async () => {
    wire(
      { data: { id: "cat-f" }, error: null },
      {
        data: [
          { name: "KIA Soluto Emotion MT", image_url: "https://img/kia.png", is_default: true },
          { name: "Renault Logan 1.6", image_url: null, is_default: false },
        ],
        error: null,
      },
    );

    const part = await getGamaCards("f", "Sedán mecánico");
    expect(part).not.toBeNull();
    expect(part!.gama).toBe("F"); // uppercased
    expect(part!.descripcion).toBe("Sedán mecánico");
    expect(part!.modelos).toEqual([
      { nombre: "KIA Soluto Emotion MT", imagen: "https://img/kia.png" },
      { nombre: "Renault Logan 1.6", imagen: "" }, // no image → "" (page shows name only)
    ]);
  });

  it("returns null when the category code does not exist", async () => {
    wire({ data: null, error: null }, { data: [], error: null });
    expect(await getGamaCards("zz")).toBeNull();
  });

  it("returns null when the category has no active models", async () => {
    wire({ data: { id: "cat-f" }, error: null }, { data: [], error: null });
    expect(await getGamaCards("f")).toBeNull();
  });

  it("returns null on a DB error (best-effort, never breaks the turn)", async () => {
    wire({ data: { id: "cat-f" }, error: null }, { data: null, error: { message: "boom" } });
    expect(await getGamaCards("f")).toBeNull();
  });

  it("returns null for a blank code without touching the DB", async () => {
    expect(await getGamaCards("   ")).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });
});
