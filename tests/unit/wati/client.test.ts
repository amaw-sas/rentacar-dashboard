import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.stubEnv("WATI_API_URL", "https://live-mt-server.wati.io/460084");
vi.stubEnv("WATI_API_TOKEN", "test-token");

const { addContact, sendTemplateMessage } = await import("@/lib/wati/client");

describe("wati client URL construction", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("addContact hits /api/v1/addContact/{phone}", async () => {
    await addContact("+57 300-123 4567", "Juan Perez");

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe(
      "https://live-mt-server.wati.io/460084/api/v1/addContact/573001234567"
    );
  });

  it("sendTemplateMessage hits /api/v1/sendTemplateMessage?whatsappNumber={phone}", async () => {
    await sendTemplateMessage(
      "+57 300-123 4567",
      "nueva_reserva_5",
      "broadcast-1",
      []
    );

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe(
      "https://live-mt-server.wati.io/460084/api/v1/sendTemplateMessage?whatsappNumber=573001234567"
    );
  });
});
