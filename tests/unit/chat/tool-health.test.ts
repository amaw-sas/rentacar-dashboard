import { describe, it, expect } from "vitest";
import {
  computeToolHealth,
  aggregateToolEvents,
} from "@/lib/queries/chat-tool-health";

const config = { threshold: 0.3, minVolume: 10 };

describe("aggregateToolEvents", () => {
  it("folds raw rows into per-tool totals/failures, one entry per known tool", () => {
    const rows = [
      { tool: "cotizar", ok: true },
      { tool: "cotizar", ok: false },
      { tool: "crear_reserva", ok: true },
      { tool: "unknown", ok: false }, // ignored
    ];
    const agg = aggregateToolEvents(rows);
    expect(agg).toEqual([
      { tool: "cotizar", total: 2, failed: 1 },
      { tool: "crear_reserva", total: 1, failed: 0 },
    ]);
  });
});

describe("computeToolHealth", () => {
  it("alerts when the fail rate meets the threshold AND volume is sufficient", () => {
    const out = computeToolHealth(
      [{ tool: "crear_reserva", total: 10, failed: 4 }],
      config,
    );
    expect(out[0]).toMatchObject({ failRate: 0.4, alert: true });
  });

  it("does NOT alert below the minimum volume even at a high fail rate", () => {
    const out = computeToolHealth(
      [{ tool: "crear_reserva", total: 3, failed: 3 }],
      config,
    );
    expect(out[0]).toMatchObject({ failRate: 1, alert: false });
  });

  it("does NOT alert when the fail rate is below the threshold", () => {
    const out = computeToolHealth(
      [{ tool: "cotizar", total: 100, failed: 10 }],
      config,
    );
    expect(out[0]).toMatchObject({ failRate: 0.1, alert: false });
  });

  it("treats zero volume as a 0 fail rate, no alert", () => {
    const out = computeToolHealth([{ tool: "cotizar", total: 0, failed: 0 }], config);
    expect(out[0]).toMatchObject({ failRate: 0, alert: false });
  });
});
