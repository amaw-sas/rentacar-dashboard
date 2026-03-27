import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseCommissionExcel } from "@/lib/parsers/commission-parser";

async function createTestExcel(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // Main sheet: COMISION — replicates real Localiza format
  const main = workbook.addWorksheet("COMISION");
  // Header rows 1-4 (metadata)
  main.getCell("A1").value = "Proveedor (convenio travel)";
  main.getCell("B1").value = "CONVENIO 7334927 AMAW SAS";
  main.getCell("A2").value = "Nit";
  main.getCell("B2").value = 9006659177;
  main.getCell("A3").value = "Concepto";
  main.getCell("B3").value = "COMISION A TERCEROS";
  main.getCell("A4").value = "% Comisión";
  main.getCell("B4").value = "15% Y 10%";
  // Row 5: Column headers
  main.getCell("A5").value = "MES";
  main.getCell("B5").value = "USUARIO";
  main.getCell("C5").value = "RESERVA";
  main.getCell("D5").value = "VALOR";
  main.getCell("E5").value = "COMISION";
  // Row 6: First data row (has date in col A)
  main.getCell("A6").value = new Date(2026, 1, 1); // 2026-02-01
  main.getCell("B6").value = "CAMILO ANDRES OREJUELA SANDOVAL";
  main.getCell("C6").value = "AV78XC3JDA";
  main.getCell("D6").value = 163260.07;
  main.getCell("E6").value = { formula: "D6*15%", result: 24489.0105 };
  // Row 7: Second data row (no date — inherits month)
  main.getCell("B7").value = "JUAN MIGUEL SALAZAR PATIO";
  main.getCell("C7").value = "AVA5XBK63KA";
  main.getCell("D7").value = 186630.99;
  main.getCell("E7").value = { formula: "D7*15%", result: 27994.6485 };
  // Row 8: Third row with 10% commission rate
  main.getCell("B8").value = "NARDA DUQUE FRANCO";
  main.getCell("C8").value = "AVA5W9WH6A";
  main.getCell("D8").value = 189926.39;
  main.getCell("E8").value = { formula: "D8*10%", result: 18992.639 };
  // Row 9: TOTAL row — parser must stop here
  main.getCell("B9").value = "TOTAL FACTURADO";
  main.getCell("C9").value = 539817.45;

  // Detail sheet: Hoja1 — enrichment data
  const detail = workbook.addWorksheet("Hoja1");
  detail.getCell("A1").value = "Usuario Vehículo";
  detail.getCell("B1").value = "Reserva";
  detail.getCell("C1").value = "Tipo Contrato";
  detail.getCell("D1").value = "Suma de Valor Real";
  detail.getCell("A2").value = "CAMILO ANDRES OREJUELA SANDOVAL";
  detail.getCell("B2").value = "AV78XC3JDA";
  detail.getCell("C2").value = "DIARIO";
  detail.getCell("D2").value = 159460.07;
  detail.getCell("A3").value = "JUAN MIGUEL SALAZAR PATIO";
  detail.getCell("B3").value = "AVA5XBK63KA";
  detail.getCell("C3").value = "DIARIO";
  detail.getCell("D3").value = 159460.07;

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe("parseCommissionExcel", () => {
  it("parses exactly 3 data rows, stopping before TOTAL FACTURADO", async () => {
    const buffer = await createTestExcel();
    const rows = await parseCommissionExcel(buffer);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.customer_name)).not.toContain("TOTAL FACTURADO");
  });

  it("extracts customer_name from column B", async () => {
    const buffer = await createTestExcel();
    const rows = await parseCommissionExcel(buffer);
    expect(rows[0].customer_name).toBe("CAMILO ANDRES OREJUELA SANDOVAL");
    expect(rows[1].customer_name).toBe("JUAN MIGUEL SALAZAR PATIO");
    expect(rows[2].customer_name).toBe("NARDA DUQUE FRANCO");
  });

  it("extracts reservation_code from column C", async () => {
    const buffer = await createTestExcel();
    const rows = await parseCommissionExcel(buffer);
    expect(rows[0].reservation_code).toBe("AV78XC3JDA");
    expect(rows[1].reservation_code).toBe("AVA5XBK63KA");
    expect(rows[2].reservation_code).toBe("AVA5W9WH6A");
  });

  it("extracts exact reservation_value from column D", async () => {
    const buffer = await createTestExcel();
    const rows = await parseCommissionExcel(buffer);
    expect(rows[0].reservation_value).toBe(163260.07);
    expect(rows[1].reservation_value).toBe(186630.99);
    expect(rows[2].reservation_value).toBe(189926.39);
  });

  it("extracts commission_amount from formula result (=D*15% and =D*10%)", async () => {
    const buffer = await createTestExcel();
    const rows = await parseCommissionExcel(buffer);
    expect(rows[0].commission_amount).toBeCloseTo(24489.0105, 2);
    expect(rows[1].commission_amount).toBeCloseTo(27994.6485, 2);
    expect(rows[2].commission_amount).toBeCloseTo(18992.639, 2);
  });

  it("calculates implicit commission_rate as percentage per row", async () => {
    const buffer = await createTestExcel();
    const rows = await parseCommissionExcel(buffer);
    expect(rows[0].commission_rate).toBe(15);
    expect(rows[1].commission_rate).toBe(15);
    expect(rows[2].commission_rate).toBe(10);
  });

  it("extracts commission_month from first row date and propagates to all rows", async () => {
    const buffer = await createTestExcel();
    const rows = await parseCommissionExcel(buffer);
    expect(rows[0].commission_month).toBe("2026-02-01");
    expect(rows[1].commission_month).toBe("2026-02-01");
    expect(rows[2].commission_month).toBe("2026-02-01");
  });

  it("enriches rows with contract_type and real_value from Hoja1 by reservation_code", async () => {
    const buffer = await createTestExcel();
    const rows = await parseCommissionExcel(buffer);
    // Rows matched in Hoja1
    expect(rows[0].contract_type).toBe("DIARIO");
    expect(rows[0].real_value).toBe(159460.07);
    expect(rows[1].contract_type).toBe("DIARIO");
    expect(rows[1].real_value).toBe(159460.07);
    // Row NOT in Hoja1 → null
    expect(rows[2].contract_type).toBeNull();
    expect(rows[2].real_value).toBeNull();
  });

  it("throws descriptive error if COMISION sheet is missing", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("OtraHoja");
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await expect(parseCommissionExcel(buffer)).rejects.toThrow(
      'Hoja "COMISION" no encontrada',
    );
  });
});
