import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { exportUpdatePriceList, exportApprovedChangeSummary } from "../exportPriceLists";
import type { ExportRow } from "../exportResults";

function row(): ExportRow {
  return {
    product: { id: "p", supplier_id: "s", code: "000123", description: "Mi artículo x100", unit: "x100", brand: "", currency: "ARS", current_price: 900, active: true, created_at: "", updated_at: "" },
    item: { id: "i", price_list_id: "l", supplier_code: "PROV-CAJA", supplier_description: "Caja x1000 del proveedor", supplier_unit: "x1000", supplier_brand: "", supplier_currency: "ARS", raw_price: "10.000", parsed_price: 10000, parse_error: null, matched_product_id: "p", match_level: "equivalence", match_score: 100, match_state: "safe", matched_presentations: [{ product_id: "p", supplier_quantity: 1000, own_quantity: 100 }], raw_data: {}, created_at: "" },
    change: { id: "c", comparison_session_id: "s", price_list_item_id: "i", product_id: "p", old_price: 900, new_price: 1000, final_new_price: null, old_currency: "ARS", new_currency: "ARS", diff_absolute: 100, diff_percent: 11.11, status: "approved", decided_at: null, created_at: "" },
  };
}

async function capture(action: () => Promise<void>) {
  let blob: Blob | undefined;
  vi.stubGlobal("document", { createElement: () => ({ click() {}, href: "", download: "" }) });
  const create = vi.spyOn(URL, "createObjectURL").mockImplementation(value => { blob = value as Blob; return "blob:test"; });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  try {
    await action();
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await blob!.arrayBuffer());
    return book.worksheets[0];
  } finally { create.mockRestore(); revoke.mockRestore(); vi.unstubAllGlobals(); }
}

describe("listas simples para actualizar precios", () => {
  it("sólo tiene cuatro columnas, encabezados en la fila 1 y datos propios desde la fila 2", async () => {
    const sheet = await capture(() => exportUpdatePriceList([row()], "precios.xlsx"));
    expect(sheet.columnCount).toBe(4); expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(1).values).toEqual([undefined, "Código", "Descripción", "Precio", "Moneda"]);
    expect(sheet.getRow(2).values).toEqual([undefined, "000123", "Mi artículo x100", 1000, "ARS"]);
    expect(sheet.getCell("A2").type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell("A2").numFmt).toBe("@");
    expect(sheet.getCell("C2").type).toBe(ExcelJS.ValueType.Number);
    expect(sheet.model.merges).toEqual([]);
  });
  it("conserva filtros, encabezado fijo, anchos legibles y formato numérico", async () => {
    const sheet = await capture(() => exportUpdatePriceList([row()], "precios.xlsx"));
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1, showGridLines: false });
    expect(sheet.autoFilter).toBe("A1:D2");
    expect(sheet.getColumn(2).width).toBeGreaterThanOrEqual(60);
    expect(sheet.getCell("A1").font).toMatchObject({ bold: true, size: 11 });
    expect(sheet.getCell("C2").numFmt).toBe("#,##0.00");
    expect(sheet.pageSetup.printTitlesRow).toBe("1:1");
  });
  it("excluye pendientes, rechazados, errores, identidades por revisar y precios sin cambios", async () => {
    const pending = row(); pending.change!.status = "pending";
    const rejected = row(); rejected.change!.status = "rejected";
    const invalid = row(); invalid.item.parse_error = "Precio inválido";
    const review = row(); review.item.match_state = "review";
    const unchanged = row(); unchanged.change!.diff_absolute = 0;
    const sheet = await capture(() => exportUpdatePriceList([row(), pending, rejected, invalid, review, unchanged], "precios.xlsx"));
    expect(sheet.rowCount).toBe(2);
  });
  it("usa el precio final editado y la moneda del artículo, sin convertir dólares en pesos", async () => {
    const usd = row(); usd.product!.currency = "USD"; usd.item.supplier_currency = "USD";
    usd.change = { ...usd.change!, final_new_price: 950.25, old_currency: "USD", new_currency: "USD" };
    const sheet = await capture(() => exportUpdatePriceList([usd], "precios.xlsx"));
    expect(sheet.getCell("C2").value).toBe(950.25); expect(sheet.getCell("D2").value).toBe("USD");
  });
  it("quita repeticiones del mismo artículo y precio, pero conserva presentaciones distintas", async () => {
    const duplicate = row(); duplicate.item = { ...duplicate.item, id: "i2", supplier_code: "OTRO" };
    const variant = row(); variant.product = { ...variant.product!, id: "p2", description: "Mi artículo x10" };
    variant.item = { ...variant.item, id: "i3", matched_product_id: "p2", matched_presentations: [{ product_id: "p2", supplier_quantity: 1000, own_quantity: 10 }] };
    variant.change = { ...variant.change!, product_id: "p2", old_price: 90, new_price: 100 };
    const sheet = await capture(() => exportUpdatePriceList([row(), duplicate, variant], "precios.xlsx"));
    expect(sheet.rowCount).toBe(3);
    expect([sheet.getCell("B2").value, sheet.getCell("B3").value].sort()).toEqual(["Mi artículo x10", "Mi artículo x100"]);
  });
  it("bloquea precios contradictorios para el mismo artículo en lugar de elegir uno", async () => {
    const conflict = row(); conflict.change = { ...conflict.change!, new_price: 1100 };
    await expect(capture(() => exportUpdatePriceList([row(), conflict], "precios.xlsx"))).rejects.toThrow("precios aprobados distintos");
  });
  it("no genera archivos vacíos ni exporta precios cero aprobados por datos antiguos", async () => {
    await expect(capture(() => exportUpdatePriceList([], "precios.xlsx"))).rejects.toThrow("No hay cambios");
    const invalid = row(); invalid.change!.final_new_price = 0;
    await expect(capture(() => exportUpdatePriceList([invalid], "precios.xlsx"))).rejects.toThrow("Revisá el precio");
    const unchanged = row(); unchanged.change!.final_new_price = unchanged.change!.old_price;
    await expect(capture(() => exportUpdatePriceList([unchanged], "precios.xlsx"))).rejects.toThrow("No hay cambios");
  });
  it("el resumen muestra diferencias y porcentajes recalculados sobre el precio final", async () => {
    const edited = row(); edited.change = { ...edited.change!, old_price: 1000, final_new_price: 1050 };
    const sheet = await capture(() => exportApprovedChangeSummary([edited], "cambios.xlsx"));
    expect(sheet.columnCount).toBe(7); expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell("C2").value).toBe(1000); expect(sheet.getCell("D2").value).toBe(1050);
    expect(sheet.getCell("E2").value).toBe(50); expect(sheet.getCell("F2").value).toBe(0.05);
    expect(sheet.getCell("F2").numFmt).toContain("%");
  });
});
