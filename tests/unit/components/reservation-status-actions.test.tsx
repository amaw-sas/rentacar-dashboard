import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ReservationStatusActions } from "@/components/layout/reservation-status-actions";
import { updateReservationStatus } from "@/lib/actions/reservations";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/reservations", () => ({
  updateReservationStatus: vi.fn(() => Promise.resolve({})),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const statusActionMock = vi.mocked(updateReservationStatus);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Issue #153 inverts #90: instead of blocking on unsaved edits, the status
// button delegates to an async `onBeforeStatusChange` callback (autosave) that
// must resolve true before the status is dispatched. The detail page omits the
// prop → behavior identical to before (direct dispatch).
describe("ReservationStatusActions — onBeforeStatusChange delegation (issue #153)", () => {
  // SCEN-011: detail-page usage (prop absent) dispatches the status directly.
  it("dispatches the status directly when onBeforeStatusChange is absent", async () => {
    render(
      <ReservationStatusActions reservationId="res-123" currentStatus="nueva" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(statusActionMock).toHaveBeenCalledWith("res-123", "reservado"),
    );
  });

  // Component-level invariant for SCEN-005/006: the callback resolving false
  // (save failed/invalid) aborts the dispatch — updateReservationStatus is
  // never called.
  it("aborts the dispatch when onBeforeStatusChange resolves false", async () => {
    const onBeforeStatusChange = vi.fn(() => Promise.resolve(false));
    render(
      <ReservationStatusActions
        reservationId="res-123"
        currentStatus="nueva"
        onBeforeStatusChange={onBeforeStatusChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() => expect(onBeforeStatusChange).toHaveBeenCalledTimes(1));
    expect(statusActionMock).not.toHaveBeenCalled();
  });

  // Proceeds when the callback resolves true (autosave succeeded).
  it("dispatches the status when onBeforeStatusChange resolves true", async () => {
    const onBeforeStatusChange = vi.fn(() => Promise.resolve(true));
    render(
      <ReservationStatusActions
        reservationId="res-123"
        currentStatus="nueva"
        onBeforeStatusChange={onBeforeStatusChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(statusActionMock).toHaveBeenCalledWith("res-123", "reservado"),
    );
    expect(onBeforeStatusChange).toHaveBeenCalledTimes(1);
  });

  // SCEN-007 (component half): for a dangerous target the confirm runs BEFORE
  // the callback; cancelling the confirm aborts before any save attempt.
  it("invokes window.confirm BEFORE the callback for a dangerous target", async () => {
    const order: string[] = [];
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => {
        order.push("confirm");
        return true;
      });
    const onBeforeStatusChange = vi.fn(() => {
      order.push("callback");
      return Promise.resolve(true);
    });

    render(
      <ReservationStatusActions
        reservationId="res-123"
        currentStatus="nueva"
        onBeforeStatusChange={onBeforeStatusChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancelado" }));

    await waitFor(() => expect(onBeforeStatusChange).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["confirm", "callback"]);

    confirmSpy.mockRestore();
  });

  // SCEN-007 (component half): cancelling the dangerous-target confirm aborts —
  // neither the callback nor the dispatch run.
  it("aborts before the callback when the dangerous-target confirm is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onBeforeStatusChange = vi.fn(() => Promise.resolve(true));

    render(
      <ReservationStatusActions
        reservationId="res-123"
        currentStatus="nueva"
        onBeforeStatusChange={onBeforeStatusChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancelado" }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onBeforeStatusChange).not.toHaveBeenCalled();
    expect(statusActionMock).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  // SCEN-014: while the autosave is in flight (the callback hasn't resolved),
  // the status buttons must be disabled and a second click must NOT trigger a
  // second autosave or a second dispatch. On resolve(true) the status fires
  // exactly once. Guards against double-dispatch on slow saves (#100).
  it("disables the buttons during autosave and does not double-dispatch", async () => {
    let resolveCallback!: (ok: boolean) => void;
    const deferred = new Promise<boolean>((resolve) => {
      resolveCallback = resolve;
    });
    const onBeforeStatusChange = vi.fn(() => deferred);

    render(
      <ReservationStatusActions
        reservationId="res-123"
        currentStatus="nueva"
        onBeforeStatusChange={onBeforeStatusChange}
      />,
    );

    const reservadoBtn = screen.getByRole("button", { name: "Reservado" });
    fireEvent.click(reservadoBtn);

    // Autosave in flight → buttons disabled.
    await waitFor(() => expect(reservadoBtn).toBeDisabled());
    expect(onBeforeStatusChange).toHaveBeenCalledTimes(1);

    // A second click while in flight must NOT call the callback again.
    fireEvent.click(reservadoBtn);
    fireEvent.click(screen.getByRole("button", { name: "Pendiente" }));
    expect(onBeforeStatusChange).toHaveBeenCalledTimes(1);

    // Resolve the autosave → status dispatches exactly once.
    resolveCallback(true);
    await waitFor(() =>
      expect(statusActionMock).toHaveBeenCalledWith("res-123", "reservado"),
    );
    expect(statusActionMock).toHaveBeenCalledTimes(1);
  });
});
