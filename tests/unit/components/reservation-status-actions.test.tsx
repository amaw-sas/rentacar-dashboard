import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ReservationStatusActions } from "@/components/layout/reservation-status-actions";
import { updateReservationStatus } from "@/lib/actions/reservations";
import { toast } from "sonner";

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
const toastErrorMock = vi.mocked(toast.error);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReservationStatusActions — unsaved-changes guard", () => {
  // SCEN-006: detail-page usage (prop absent → default false) never blocks.
  it("fires the status transition when hasUnsavedChanges is absent (default false)", async () => {
    render(
      <ReservationStatusActions reservationId="res-123" currentStatus="nueva" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(statusActionMock).toHaveBeenCalledWith("res-123", "reservado"),
    );
  });

  // SCEN-007: with unsaved changes (prop true) the click is blocked before any
  // confirm or action — inline warning + toast.error, nothing dispatched.
  it("blocks the transition and warns when hasUnsavedChanges is true", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <ReservationStatusActions
        reservationId="res-123"
        currentStatus="nueva"
        hasUnsavedChanges
      />,
    );

    // "Cancelado" is a dangerous target: it would normally trigger window.confirm.
    fireEvent.click(screen.getByRole("button", { name: "Cancelado" }));

    expect(statusActionMock).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText(/cambios sin guardar/i)).toBeInTheDocument(),
    );

    confirmSpy.mockRestore();
  });
});
