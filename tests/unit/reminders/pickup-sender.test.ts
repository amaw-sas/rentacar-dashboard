import { describe, it, expect, vi, beforeEach } from "vitest";
import { addContact, sendTemplateMessage } from "@/lib/wati/client";
import { logNotification } from "@/lib/actions/notification-logs";
import {
  getPostLateReservations,
  getReservationForReminder,
} from "@/lib/reminders/pickup-queries";
import {
  sendPickupReminderForReservation,
  sendPickupReminders,
  sendSinglePickupReminder,
  type ReminderType,
} from "@/lib/reminders/pickup-sender";
import type { ReservationRecord } from "@/lib/reminders/pickup-queries";

vi.mock("@/lib/wati/client", () => ({
  addContact: vi.fn().mockResolvedValue(undefined),
  sendTemplateMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/actions/notification-logs", () => ({
  logNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/reminders/pickup-queries", () => ({
  getWeekPickupReservations: vi.fn().mockResolvedValue([]),
  getThreeDaysPickupReservations: vi.fn().mockResolvedValue([]),
  getSameDayMorningReservations: vi.fn().mockResolvedValue([]),
  getSameDayLateReservations: vi.fn().mockResolvedValue([]),
  getPostMorningReservations: vi.fn().mockResolvedValue([]),
  getPostLateReservations: vi.fn().mockResolvedValue([]),
  getReservationForReminder: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              display_name: "AlquilaTuCarro",
              phone: "+573001112233",
              logo_url: null,
              website: "https://alquilatucarro.com",
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

const baseReservation = {
  id: "res-abc-123",
  franchise: "alquilatucarro",
  reservation_code: "AV78XC3JDA",
  pickup_date: "2026-05-06",
  pickup_hour: "10:30",
  customers: {
    first_name: "Juan",
    last_name: "Perez",
    phone: "+573001234567",
    email: "juan@example.com",
  },
  pickup_location: {
    name: "Bogotá Aeropuerto",
    pickup_address: "Av El Dorado",
    pickup_map: "https://maps.app.goo.gl/test123",
  },
} as unknown as ReservationRecord;

const TYPE_TO_NOTIFICATION_TYPE: Record<ReminderType, string> = {
  week: "whatsapp_pre_pickup_week",
  "three-days": "whatsapp_pre_pickup_3d",
  "same-day-morning": "whatsapp_pre_pickup_same_day_am",
  "same-day-late": "whatsapp_pre_pickup_same_day_pm",
  "post-morning": "whatsapp_post_pickup_am",
  "post-late": "whatsapp_post_pickup_pm",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendTemplateMessage).mockResolvedValue(undefined);
  vi.mocked(addContact).mockResolvedValue(undefined);
  vi.mocked(logNotification).mockResolvedValue(undefined);
});

describe("sendPickupReminderForReservation", () => {
  for (const reminderType of Object.keys(TYPE_TO_NOTIFICATION_TYPE) as ReminderType[]) {
    it(`logs status="sent" with notification_type ${TYPE_TO_NOTIFICATION_TYPE[reminderType]} for ${reminderType}`, async () => {
      await sendPickupReminderForReservation(baseReservation, reminderType);

      expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
      expect(logNotification).toHaveBeenCalledTimes(1);
      expect(logNotification).toHaveBeenCalledWith({
        reservation_id: "res-abc-123",
        channel: "whatsapp",
        notification_type: TYPE_TO_NOTIFICATION_TYPE[reminderType],
        recipient: "+573001234567",
        status: "sent",
      });
    });
  }

  it("does not send or log when customer has no phone", async () => {
    const noPhone: ReservationRecord = {
      ...baseReservation,
      customers: { ...baseReservation.customers, phone: "" },
    };

    await sendPickupReminderForReservation(noPhone, "post-late");

    expect(sendTemplateMessage).not.toHaveBeenCalled();
    expect(addContact).not.toHaveBeenCalled();
    expect(logNotification).not.toHaveBeenCalled();
  });

  it("uses post_reserva template for post-* types and recordatorio_recogida for pre-* types", async () => {
    await sendPickupReminderForReservation(baseReservation, "post-late");
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      "+573001234567",
      "post_reserva",
      expect.any(String),
      expect.any(Array),
    );

    vi.mocked(sendTemplateMessage).mockClear();

    await sendPickupReminderForReservation(baseReservation, "week");
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      "+573001234567",
      "recordatorio_recogida",
      expect.any(String),
      expect.any(Array),
    );
  });

  for (const type of ["post-morning", "post-late"] as ReminderType[]) {
    it(`sends only fullname + franchise_name params for ${type}`, async () => {
      await sendPickupReminderForReservation(baseReservation, type);
      const params = vi.mocked(sendTemplateMessage).mock.calls[0][3];
      expect(params).toEqual([
        { name: "fullname", value: "Juan Perez" },
        { name: "franchise_name", value: "AlquilaTuCarro" },
      ]);
    });
  }

  for (const type of ["week", "three-days"] as ReminderType[]) {
    it(`sends 6 params (no address/map) for ${type}`, async () => {
      await sendPickupReminderForReservation(baseReservation, type);
      const params = vi.mocked(sendTemplateMessage).mock.calls[0][3];
      const names = params.map((p) => p.name);
      expect(names).toEqual([
        "fullname",
        "reservation_code",
        "pickup_date",
        "pickup_hour",
        "pickup_location",
        "franchise_name",
      ]);
      expect(names).not.toContain("pickup_location_address");
      expect(names).not.toContain("pickup_location_map");
    });
  }

  for (const type of ["same-day-morning", "same-day-late"] as ReminderType[]) {
    it(`sends 8 params including pickup_location_address + pickup_location_map for ${type}`, async () => {
      await sendPickupReminderForReservation(baseReservation, type);
      const params = vi.mocked(sendTemplateMessage).mock.calls[0][3];
      const byName = Object.fromEntries(params.map((p) => [p.name, p.value]));
      expect(Object.keys(byName)).toEqual(
        expect.arrayContaining([
          "fullname",
          "reservation_code",
          "pickup_date",
          "pickup_hour",
          "pickup_location",
          "franchise_name",
          "pickup_location_address",
          "pickup_location_map",
        ]),
      );
      expect(params).toHaveLength(8);
      expect(byName.pickup_location_address).toBe("Av El Dorado");
      expect(byName.pickup_location_map).toBe("https://maps.app.goo.gl/test123");
    });
  }
});

describe("sendPickupReminders error path", () => {
  it("logs status='failed' with error_message and increments errors when Wati throws", async () => {
    vi.mocked(getPostLateReservations).mockResolvedValueOnce([baseReservation]);
    vi.mocked(sendTemplateMessage).mockRejectedValueOnce(
      new Error("Wati 500 server error"),
    );

    const result = await sendPickupReminders("post-late");

    expect(result).toEqual({ sent: 0, errors: 1, total: 1 });
    expect(logNotification).toHaveBeenCalledWith({
      reservation_id: "res-abc-123",
      channel: "whatsapp",
      notification_type: "whatsapp_post_pickup_pm",
      recipient: "+573001234567",
      status: "failed",
      error_message: "Wati 500 server error",
    });
  });

  it("does not abort the loop when logNotification rejects (sent counter still increments)", async () => {
    vi.mocked(getPostLateReservations).mockResolvedValueOnce([
      baseReservation,
      { ...baseReservation, id: "res-xyz-789" },
    ]);
    vi.mocked(logNotification).mockRejectedValue(new Error("DB unavailable"));

    const result = await sendPickupReminders("post-late");

    expect(result).toEqual({ sent: 2, errors: 0, total: 2 });
    expect(sendTemplateMessage).toHaveBeenCalledTimes(2);
  });
});

describe("sendSinglePickupReminder", () => {
  it("fetches reservation by id and delegates to the helper", async () => {
    vi.mocked(getReservationForReminder).mockResolvedValueOnce(baseReservation);

    await sendSinglePickupReminder("res-abc-123", "week");

    expect(getReservationForReminder).toHaveBeenCalledWith("res-abc-123");
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      "+573001234567",
      "recordatorio_recogida",
      expect.any(String),
      expect.any(Array),
    );
    expect(logNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation_id: "res-abc-123",
        notification_type: "whatsapp_pre_pickup_week",
        status: "sent",
      }),
    );
  });

  it("throws when reservation is not found", async () => {
    vi.mocked(getReservationForReminder).mockResolvedValueOnce(null);

    await expect(
      sendSinglePickupReminder("missing", "week"),
    ).rejects.toThrow(/no encontrada/i);
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });
});
