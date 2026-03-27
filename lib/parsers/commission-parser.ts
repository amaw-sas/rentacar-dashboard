import ExcelJS from "exceljs";

export interface CommissionRow {
  customer_name: string;
  reservation_code: string;
  reservation_value: number;
  commission_amount: number;
  commission_rate: number | null;
  commission_month: string | null;
  contract_type: string | null;
  real_value: number | null;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function parseCommissionExcel(
  buffer: Buffer | ArrayBuffer,
): Promise<CommissionRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);

  // Parse main sheet "COMISION"
  const mainSheet = workbook.getWorksheet("COMISION");
  if (!mainSheet) throw new Error('Hoja "COMISION" no encontrada');

  // Build lookup from Hoja1 (detail sheet) keyed by reservation_code
  const detailMap = new Map<
    string,
    { contract_type: string; real_value: number }
  >();
  const detailSheet = workbook.getWorksheet("Hoja1");
  if (detailSheet) {
    detailSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      const reservationCode = String(row.getCell(2).value ?? "").trim();
      const contractType = String(row.getCell(3).value ?? "").trim();
      const realValue = Number(row.getCell(4).value) || 0;
      if (reservationCode) {
        detailMap.set(reservationCode, {
          contract_type: contractType,
          real_value: realValue,
        });
      }
    });
  }

  const rows: CommissionRow[] = [];
  let commissionMonth: string | null = null;
  const DATA_START_ROW = 6; // Data starts at row 6 (after 4 header rows + 1 column header row)

  mainSheet.eachRow((row, rowNumber) => {
    if (rowNumber < DATA_START_ROW) return;

    // Check for TOTAL row — stop parsing
    const colB = String(row.getCell(2).value ?? "");
    if (colB.includes("TOTAL FACTURADO") || colB.includes("TOTAL COMISION")) {
      return;
    }

    // Column A: MES (date, only first row has it)
    const cellA = row.getCell(1).value;
    if (cellA instanceof Date) {
      commissionMonth = formatDate(cellA);
    }

    // Column B: USUARIO (customer name)
    const customerName = String(row.getCell(2).value ?? "").trim();
    if (!customerName) return;

    // Column C: RESERVA (reservation code)
    const reservationCode = String(row.getCell(3).value ?? "").trim();
    if (!reservationCode) return;

    // Column D: VALOR (reservation value)
    const reservationValue = Number(row.getCell(4).value) || 0;

    // Column E: COMISION (formula result)
    const cellE = row.getCell(5);
    const commissionAmount =
      typeof cellE.result === "number"
        ? cellE.result
        : Number(cellE.value) || 0;

    // Calculate implicit rate
    const commissionRate =
      reservationValue > 0
        ? (commissionAmount / reservationValue) * 100
        : null;

    // Enrich from Hoja1
    const detail = detailMap.get(reservationCode);

    rows.push({
      customer_name: customerName,
      reservation_code: reservationCode,
      reservation_value: reservationValue,
      commission_amount: commissionAmount,
      commission_rate: commissionRate ? Math.round(commissionRate * 100) / 100 : null,
      commission_month: commissionMonth,
      contract_type: detail?.contract_type ?? null,
      real_value: detail?.real_value ?? null,
    });
  });

  return rows;
}
