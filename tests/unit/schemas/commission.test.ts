import { describe, it, expect } from "vitest";
import { commissionSchema } from "@/lib/schemas/commission";

describe("commissionSchema", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const valid = {
    import_batch_id: uuid,
    customer_name_raw: "CAMILO ANDRES OREJUELA",
    reservation_code_raw: "AV78XC3JDA",
    reservation_value: 163260.07,
    commission_amount: 24489.01,
    commission_rate: 15,
    match_status: "matched" as const,
    payment_status: "pending" as const,
  };

  it("accepts valid commission data", () => {
    const result = commissionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects invalid match_status", () => {
    const result = commissionSchema.safeParse({ ...valid, match_status: "partial" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid payment_status", () => {
    const result = commissionSchema.safeParse({ ...valid, payment_status: "overdue" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid match statuses", () => {
    for (const s of ["matched", "unmatched", "manual"]) {
      expect(commissionSchema.safeParse({ ...valid, match_status: s }).success).toBe(true);
    }
  });

  it("accepts all valid payment statuses", () => {
    for (const s of ["pending", "invoiced", "paid"]) {
      expect(commissionSchema.safeParse({ ...valid, payment_status: s }).success).toBe(true);
    }
  });

  it("allows nullable optional fields", () => {
    const result = commissionSchema.safeParse({
      ...valid,
      reservation_id: null,
      contract_type: null,
      real_value: null,
      commission_month: null,
      invoice_number: null,
    });
    expect(result.success).toBe(true);
  });
});
