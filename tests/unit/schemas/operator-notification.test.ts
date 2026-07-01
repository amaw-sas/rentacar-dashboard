import { describe, it, expect } from "vitest";
import { notificationIdSchema } from "@/lib/schemas/operator-notification";

describe("notificationIdSchema", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  it("accepts a valid uuid", () => {
    const result = notificationIdSchema.safeParse(uuid);
    expect(result.success).toBe(true);
  });

  it("rejects a non-uuid with a Spanish message", () => {
    const result = notificationIdSchema.safeParse("not-a-uuid");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Identificador de notificación inválido",
      );
    }
  });

  it("rejects a non-string", () => {
    expect(notificationIdSchema.safeParse(123).success).toBe(false);
  });
});
