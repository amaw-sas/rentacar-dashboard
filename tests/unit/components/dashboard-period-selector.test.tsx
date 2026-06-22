import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

const replaceMock = vi.fn();
let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => currentParams,
}));

import { DashboardPeriodSelector } from "@/app/(dashboard)/dashboard-period-selector";

beforeEach(() => {
  replaceMock.mockClear();
  currentParams = new URLSearchParams("period=week");
});

afterEach(() => {
  cleanup();
});

// router.replace(href, opts) — href is the first arg.
function lastReplaceParams(): URLSearchParams {
  expect(replaceMock).toHaveBeenCalled();
  const href = replaceMock.mock.calls.at(-1)?.[0] as string;
  return new URLSearchParams(href.split("?")[1] ?? "");
}

describe("DashboardPeriodSelector", () => {
  it("renders the three presets and marks the active one", () => {
    render(<DashboardPeriodSelector period="week" from="2026-06-15" to="2026-06-21" />);
    const weekBtn = screen.getByRole("button", { name: "Semana actual" });
    expect(weekBtn.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Mes actual" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "Personalizado" })).toBeTruthy();
  });

  it("navigates to ?period=month and clears any custom from/to", () => {
    currentParams = new URLSearchParams("period=custom&from=2026-06-01&to=2026-06-10");
    render(<DashboardPeriodSelector period="custom" from="2026-06-01" to="2026-06-10" />);

    fireEvent.click(screen.getByRole("button", { name: "Mes actual" }));

    const qs = lastReplaceParams();
    expect(qs.get("period")).toBe("month");
    expect(qs.has("from")).toBe(false);
    expect(qs.has("to")).toBe(false);
  });

  it("seeds custom with the resolved range when Personalizado is clicked", () => {
    render(<DashboardPeriodSelector period="week" from="2026-06-15" to="2026-06-21" />);

    fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));

    const qs = lastReplaceParams();
    expect(qs.get("period")).toBe("custom");
    expect(qs.get("from")).toBe("2026-06-15");
    expect(qs.get("to")).toBe("2026-06-21");
  });
});
