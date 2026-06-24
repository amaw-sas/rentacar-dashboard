import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks -----------------------------------------------------------------

// info_sedes is pure given the directory; mock the directory loader.
const directory = [
  {
    slug: "bogota-fontibon",
    code: "AABOT",
    city: "Bogotá",
    name: "Fontibón",
    status: "active",
    pickup_address: "Cra 1",
    pickup_map: "http://map/1",
    schedule: { display: "24 horas" },
  },
  {
    slug: "bogota-centro",
    code: "ACBOG",
    city: "Bogotá",
    name: "Centro",
    status: "active",
    pickup_address: "Calle 2",
    pickup_map: "http://map/2",
    schedule: { mon: ["08:00-16:00"], sat: ["08:00-12:00"] },
  },
  {
    slug: "cali-norte",
    code: "AACLO",
    city: "Cali",
    name: "Norte",
    status: "active",
    pickup_address: "Av 3",
    pickup_map: "http://map/3",
    schedule: { display: "L-V 8-18" },
  },
];

vi.mock("@/lib/api/location-directory", () => ({
  getLocationDirectory: vi.fn(async () => directory),
}));

// Mock the admin client for tarifa_mensual / info_gamas. A chain object that is
// awaitable (thenable → {data}) and supports .single() (→ {data: single}).
type TableCfg = { data?: unknown; single?: unknown; error?: unknown };
let tables: Record<string, TableCfg> = {};

function makeChain(cfg: TableCfg) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) {
    chain[m] = () => chain;
  }
  chain.single = () =>
    Promise.resolve({ data: cfg.single ?? null, error: cfg.error ?? null });
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: cfg.data ?? null, error: cfg.error ?? null }).then(
      resolve,
      reject,
    );
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => makeChain(tables[table] ?? {}),
  }),
}));

import {
  runInfoSedes,
  runTarifaMensual,
  runInfoGamas,
} from "@/lib/chat/knowledge-tools";

const LOCALIZA = { single: { id: "loc-1" } };

beforeEach(() => {
  tables = { rental_companies: LOCALIZA };
});

// --- info_sedes ------------------------------------------------------------

describe("info_sedes", () => {
  it("returns all branches of a city (diacritic/case-insensitive)", async () => {
    const res = (await runInfoSedes({ ciudad: "BOGOTA" })) as {
      sedes: { nombre: string; horario: string }[];
    };
    expect(res.sedes.map((s) => s.nombre).sort()).toEqual(["Centro", "Fontibón"]);
    // schedule.display preferred; per-day compacted otherwise.
    const fontibon = res.sedes.find((s) => s.nombre === "Fontibón");
    expect(fontibon?.horario).toBe("24 horas");
    const centro = res.sedes.find((s) => s.nombre === "Centro");
    expect(centro?.horario).toContain("Lun 08:00-16:00");
  });

  it("narrows by sede when several share the city", async () => {
    const res = (await runInfoSedes({ ciudad: "bogota", sede: "centro" })) as {
      sedes: { nombre: string }[];
    };
    expect(res.sedes).toHaveLength(1);
    expect(res.sedes[0].nombre).toBe("Centro");
  });

  it("returns an error listing valid cities when the city is unknown", async () => {
    const res = (await runInfoSedes({ ciudad: "Pasto" })) as { error: string };
    expect(res.error).toContain("Bogotá");
    expect(res.error).toContain("Cali");
  });
});

// --- tarifa_mensual --------------------------------------------------------

describe("tarifa_mensual", () => {
  it("picks the active pricing row for the rental date and ignores expired ones", async () => {
    tables = {
      rental_companies: LOCALIZA,
      vehicle_categories: { data: [{ id: "cat-c", code: "C", name: "Económico" }] },
      category_pricing: {
        data: [
          {
            status: "active",
            valid_from: "2019-01-01",
            valid_until: "2019-12-31",
            monthly_1k_price: 1,
          },
          {
            status: "active",
            valid_from: "2020-01-01",
            valid_until: null,
            monthly_1k_price: 4149000,
            monthly_2k_price: 4635000,
            monthly_3k_price: 4635000,
            monthly_insurance_price: 476000,
          },
        ],
      },
    };
    const res = (await runTarifaMensual({
      gama: "c",
      fecha_recogida: "2026-06-15",
    })) as {
      gama: string;
      mensual_1000km: number;
    };
    expect(res.gama).toBe("C");
    expect(res.mensual_1000km).toBe(4149000);
  });

  it("selects the pricing row valid for the rental month, not today", async () => {
    tables = {
      rental_companies: LOCALIZA,
      vehicle_categories: {
        data: [{ id: "cat-cx", code: "CX", name: "Económico Automático" }],
      },
      category_pricing: {
        data: [
          {
            status: "active",
            valid_from: "2026-06-01",
            valid_until: "2026-06-30",
            monthly_1k_price: 4542000,
            monthly_2k_price: 5029000,
            monthly_3k_price: 5029000,
            monthly_insurance_price: 476000,
          },
          {
            status: "active",
            valid_from: "2026-08-01",
            valid_until: "2026-08-31",
            monthly_1k_price: 4166000,
            monthly_2k_price: 4613000,
            monthly_3k_price: 4613000,
            monthly_insurance_price: 476000,
          },
        ],
      },
    };
    const res = (await runTarifaMensual({
      gama: "cx",
      fecha_recogida: "2026-08-05",
    })) as { mensual_1000km: number; mensual_2000km: number };
    expect(res.mensual_1000km).toBe(4166000);
    expect(res.mensual_2000km).toBe(4613000);
  });

  it("errors (never falls back to today) when fecha_recogida is missing or malformed", async () => {
    tables = {
      rental_companies: LOCALIZA,
      vehicle_categories: {
        data: [{ id: "cat-cx", code: "CX", name: "Económico Automático" }],
      },
      category_pricing: {
        data: [
          {
            status: "active",
            valid_from: "2020-01-01",
            valid_until: null,
            monthly_1k_price: 4542000,
          },
        ],
      },
    };
    const malformed = (await runTarifaMensual({
      gama: "cx",
      fecha_recogida: "no-es-fecha",
    })) as { error: string };
    expect(malformed.error).toMatch(/fecha de inicio/i);

    const missing = (await runTarifaMensual({
      gama: "cx",
      fecha_recogida: "",
    })) as { error: string };
    expect(missing.error).toMatch(/fecha de inicio/i);
  });

  it("errors with available gamas when the gama is unknown", async () => {
    tables = {
      rental_companies: LOCALIZA,
      vehicle_categories: { data: [{ id: "cat-c", code: "C", name: "Económico" }] },
    };
    const res = (await runTarifaMensual({
      gama: "Z",
      fecha_recogida: "2026-06-15",
    })) as { error: string };
    expect(res.error).toContain("C");
  });

  it("errors when no active monthly row exists", async () => {
    tables = {
      rental_companies: LOCALIZA,
      vehicle_categories: { data: [{ id: "cat-c", code: "C", name: "Económico" }] },
      category_pricing: {
        data: [
          {
            status: "active",
            valid_from: "2019-01-01",
            valid_until: "2019-12-31",
            monthly_1k_price: 1,
          },
        ],
      },
    };
    const res = (await runTarifaMensual({
      gama: "C",
      fecha_recogida: "2026-06-15",
    })) as { error: string };
    expect(res.error).toMatch(/mensual/i);
  });
});

// --- info_gamas ------------------------------------------------------------

describe("info_gamas", () => {
  it("maps gama attributes to a Spanish shape", async () => {
    tables = {
      rental_companies: LOCALIZA,
      vehicle_categories: {
        data: [
          {
            code: "C",
            name: "Económico",
            passenger_count: 5,
            luggage_count: 2,
            has_ac: true,
            transmission: "manual",
            picoyplaca_exempt: false,
            extra_km_charge: 500,
            short_description: "Compacto",
          },
        ],
      },
    };
    const res = (await runInfoGamas({})) as {
      gamas: { codigo: string; pasajeros: number; transmision: string }[];
    };
    expect(res.gamas[0]).toMatchObject({
      codigo: "C",
      pasajeros: 5,
      transmision: "manual",
      sin_pico_y_placa: false,
    });
  });

  it("errors when a requested gama does not exist", async () => {
    tables = {
      rental_companies: LOCALIZA,
      vehicle_categories: { data: [{ code: "C", name: "Económico" }] },
    };
    const res = (await runInfoGamas({ gama: "ZZ" })) as { error: string };
    expect(res.error).toContain("C");
  });
});
