import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ReturnLink } from "@/components/data-table/return-link";

// Capture router.push so we can assert what the link navigates to.
const { pushSpy } = vi.hoisted(() => ({ pushSpy: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy }),
}));

// Stub window.location so pathname + search reflect a filtered listing URL —
// this is exactly what ReturnLink reads at click time (the real address bar,
// which mirrors the replaceState-written filter state).
function stubLocation(pathname: string, search: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, pathname, search },
  });
}

describe("ReturnLink", () => {
  beforeEach(() => {
    pushSpy.mockReset();
    stubLocation("/reservations", "?status=nueva&page=2");
  });

  afterEach(() => cleanup());

  it("on a plain left-click captures the filtered URL and pushes ?from=<encoded>", () => {
    render(<ReturnLink href="/reservations/123/edit">Editar</ReturnLink>);
    const link = screen.getByRole("link", { name: "Editar" });

    // fireEvent.click dispatches a MouseEvent with button 0 and no modifiers —
    // a plain left-click. We build it explicitly to inspect defaultPrevented.
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    fireEvent(link, event);

    const expectedFrom = encodeURIComponent("/reservations?status=nueva&page=2");
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(
      `/reservations/123/edit?from=${expectedFrom}`,
    );
    // The plain <Link> navigation must be suppressed so router.push owns it.
    expect(event.defaultPrevented).toBe(true);
  });

  it("on a cmd/meta-click does NOT preventDefault and does NOT push (SCEN-007)", () => {
    render(<ReturnLink href="/reservations/123/edit">Editar</ReturnLink>);
    const link = screen.getByRole("link", { name: "Editar" });

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    fireEvent(link, event);

    // Plain <Link href> is allowed to open the new tab without a `from`.
    expect(pushSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("on a ctrl-click also falls through to the plain link (SCEN-007)", () => {
    render(<ReturnLink href="/reservations/123/edit">Editar</ReturnLink>);
    const link = screen.getByRole("link", { name: "Editar" });

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    fireEvent(link, event);

    expect(pushSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
