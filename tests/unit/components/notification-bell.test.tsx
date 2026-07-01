import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { NotificationBell } from "@/components/layout/notification-bell";
import type { OperatorNotification } from "@/lib/schemas/operator-notification";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/operator-notifications", () => ({
  markAllRead: vi.fn(),
  resolveNotification: vi.fn(),
  resendOperatorNotification: vi.fn(),
}));

afterEach(cleanup);

const item: OperatorNotification = {
  id: "n1",
  type: "notification_failed",
  severity: "error",
  source: "notification_logs",
  source_id: "log-1",
  title: "No salió el WhatsApp a +57 300 111 2233",
  body: "WATI 500 timeout · tipo: whatsapp_reservado",
  resource_type: "reservation",
  resource_id: "res-1",
  action: "resend",
  action_ref: "log-1",
  status: "unread",
  created_at: new Date().toISOString(),
  read_at: null,
  resolved_at: null,
};

describe("NotificationBell (SCEN-006 badge)", () => {
  it("shows the unread count badge when there are unread alerts", () => {
    const { getByTestId } = render(
      <NotificationBell items={[item]} unreadCount={3} />,
    );
    expect(getByTestId("notification-badge").textContent).toBe("3");
  });

  it("caps the badge at 99+", () => {
    const { getByTestId } = render(
      <NotificationBell items={[item]} unreadCount={150} />,
    );
    expect(getByTestId("notification-badge").textContent).toBe("99+");
  });

  it("renders no badge when there are zero unread alerts (SCEN-005 zero noise)", () => {
    const { queryByTestId, getByLabelText } = render(
      <NotificationBell items={[]} unreadCount={0} />,
    );
    expect(queryByTestId("notification-badge")).toBeNull();
    // The bell itself is still present in the header.
    expect(getByLabelText("Notificaciones")).toBeTruthy();
  });
});
