import { describe, it, expect, beforeAll, vi } from "vitest";
import { render } from "@testing-library/react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

// usePathname drives only active-item highlighting; "/" keeps it deterministic.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// signOut is a "use server" action; the footer only needs a callable stub.
vi.mock("@/lib/actions/auth", () => ({
  signOut: vi.fn(),
}));

// jsdom ships no matchMedia; useIsMobile reads it on mount. Force desktop so
// Sidebar renders the inline group structure (not the mobile Sheet).
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

function renderSidebar() {
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

function groupLabels(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('[data-slot="sidebar-group-label"]'),
  ).map((el) => el.textContent?.trim() ?? "");
}

function itemsOf(container: HTMLElement, label: string) {
  const group = Array.from(
    container.querySelectorAll('[data-slot="sidebar-group"]'),
  ).find(
    (g) =>
      g
        .querySelector('[data-slot="sidebar-group-label"]')
        ?.textContent?.trim() === label,
  );
  if (!group) throw new Error(`group "${label}" not found`);
  return Array.from(group.querySelectorAll("a")).map((a) => ({
    title: a.textContent?.trim() ?? "",
    href: a.getAttribute("href"),
  }));
}

describe("AppSidebar navigation order", () => {
  // SCEN-1: Operaciones sits immediately below General (the Dashboard section)
  // and before Datos de Referencia.
  it("places Operaciones directly under General and before Datos de Referencia", () => {
    const { container } = renderSidebar();
    const labels = groupLabels(container);

    expect(labels).toEqual([
      "General",
      "Operaciones",
      "Datos de Referencia",
      "Finanzas",
      "Analytics",
    ]);

    const general = labels.indexOf("General");
    const operaciones = labels.indexOf("Operaciones");
    expect(operaciones).toBe(general + 1);
    expect(operaciones).toBeLessThan(labels.indexOf("Datos de Referencia"));
  });

  // SCEN-2: Operaciones items read Reservas, Conversaciones, Clientes, Referidos.
  it("orders Operaciones items as Reservas, Conversaciones, Clientes, Referidos", () => {
    const { container } = renderSidebar();
    const titles = itemsOf(container, "Operaciones").map((i) => i.title);

    expect(titles).toEqual([
      "Reservas",
      "Conversaciones",
      "Clientes",
      "Referidos",
    ]);
  });

  // SCEN-3: reordering must not disturb the destinations each item links to.
  it("preserves each Operaciones item's href after the reorder", () => {
    const { container } = renderSidebar();
    const items = itemsOf(container, "Operaciones");

    expect(items).toEqual([
      { title: "Reservas", href: "/reservations" },
      { title: "Conversaciones", href: "/conversations" },
      { title: "Clientes", href: "/customers" },
      { title: "Referidos", href: "/referrals" },
    ]);
  });
});
