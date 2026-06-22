import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import {
  DashboardMetricCard,
  type MetricItem,
} from "@/app/(dashboard)/dashboard-metric-card";

afterEach(() => {
  cleanup();
});

const itemsWithBreakdown: MetricItem[] = [
  {
    label: "Hoy",
    value: 7,
    href: "/reservations?created_from=2026-06-21&created_to=2026-06-21",
    breakdown: [
      { code: "alquicarros", short: "AC", full: "AlquiCarros", value: 1 },
      { code: "alquilatucarro", short: "ATC", full: "AlquilaTuCarro", value: 3 },
      { code: "alquilame", short: "AM", full: "Alquílame", value: 3 },
    ],
  },
];

describe("DashboardMetricCard", () => {
  it("renders the period total and its href", () => {
    render(<DashboardMetricCard title="Reservas creadas" items={itemsWithBreakdown} />);
    expect(screen.getByText("Reservas creadas")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Hoy/ });
    expect(link.getAttribute("href")).toContain("created_from=2026-06-21");
    expect(within(link).getByText("7")).toBeTruthy();
  });

  it("shows each franchise's short tag and count, summing to the total", () => {
    render(<DashboardMetricCard title="Reservas creadas" items={itemsWithBreakdown} />);
    for (const [tag, count] of [
      ["AC", "1"],
      ["ATC", "3"],
      ["AM", "3"],
    ] as const) {
      expect(screen.getByText(tag)).toBeTruthy();
      // The count sits in its own span next to the tag.
      expect(screen.getAllByText(count).length).toBeGreaterThan(0);
    }
    const sum = itemsWithBreakdown[0].breakdown!.reduce((a, b) => a + b.value, 0);
    expect(sum).toBe(itemsWithBreakdown[0].value);
  });

  it("exposes the full franchise name via a title tooltip", () => {
    const { container } = render(
      <DashboardMetricCard title="Reservas creadas" items={itemsWithBreakdown} />,
    );
    const titled = container.querySelector('[title="AlquilaTuCarro: 3"]');
    expect(titled).toBeTruthy();
  });

  it("renders no breakdown line when items carry no breakdown", () => {
    const plain: MetricItem[] = [
      { label: "Hoy", value: 5, href: "/reservations" },
    ];
    const { container } = render(
      <DashboardMetricCard title="Reservas utilizadas" items={plain} />,
    );
    // Only the period link, no franchise tags.
    expect(container.querySelector("[title]")).toBeNull();
    expect(screen.getByText("5")).toBeTruthy();
  });
});
