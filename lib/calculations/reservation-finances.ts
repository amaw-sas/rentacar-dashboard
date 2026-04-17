const IVA_PCT = 19;

export interface LocalizaFinances {
  tarifa: number;
  subtotal: number;
  tax: number;
  iva: number;
  total: number;
}

export function computeLocalizaFinances(
  totalPriceToPay: number,
  returnFee = 0,
  extraHoursPrice = 0,
): LocalizaFinances {
  if (!totalPriceToPay) {
    return { tarifa: 0, subtotal: 0, tax: 0, iva: 0, total: 0 };
  }
  const totalMinusIva = Math.round(totalPriceToPay / (1 + IVA_PCT / 100));
  const iva = totalPriceToPay - totalMinusIva;
  const tax = Math.round((totalPriceToPay - iva) / 11);
  const subtotal = totalPriceToPay - iva - tax;
  const tarifa = subtotal - returnFee - extraHoursPrice;
  return { tarifa, subtotal, tax, iva, total: totalPriceToPay };
}
