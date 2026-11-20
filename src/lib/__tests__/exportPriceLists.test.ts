import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { exportUpdatePriceList, exportApprovedChangeSummary, exportCustomComparison } from "../exportPriceLists";
import type { ExportRow } from "../exportResults";

function row(): ExportRow {
  return {
    product: { id: "p", supplier_id: "s", code: "000123", description: "Mi artículo x100", unit: "x100", brand: "", currency: "ARS", current_price: 900, active: true, created_at: "", updated_at: "" },
    item: { id: "i", price_list_id: "l", supplier_code: "PROV-CAJA", supplier_description: "Caja x1000 del proveedor", supplier_unit: "x1000", supplier_brand: "", supplier_currency: "ARS", raw_price: "10.000", parsed_price: 10000, parse_error: null, matched_product_id: "p", match_level: "equivalence", match_score: 100, match_state: "safe", matched_presentations: [{ product_id: "p", supplier_quantity: 1000, own_quantity: 100 }], raw_data: {}, created_at: "" },
    change: { id: "c", comparison_session_id: "s", price_list_item_id: "i", product_id: "p", old_price: 900, new_price: 1000, final_new_price: null, old_currency: "ARS", new_currency: "ARS", diff_absolute: 100, diff_percent: 11.11, status: "approved", decided_at: null, created_at: "" },
  };
}

async function captureBook(action: () => Promise<void>) {
  let blob: Blob | undefined;
  vi.stubGlobal("document", { createElement: () => ({ click() {}, href: "", download: "" }) });
  const create = vi.spyOn(URL, "createObjectURL").mockImplementation(value => { blob = value as Blob; return "blob:test"; });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  try {
    await action();
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await blob!.arrayBuffer());
    return book;
  } finally { create.mockRestore(); revoke.mockRestore(); vi.unstubAllGlobals(); }
}
async function capture(action: () => Promise<void>) { return (await captureBook(action)).worksheets[0]; }

describe("listas simples para actualizar precios", () => {
  it("el Excel personalizado reúne la lista de siete columnas y el detalle completo", async () => {
    const pending = row(); pending.change!.status = "pending";
    const book = await captureBook(() => exportCustomComparison([row(), pending], "koln.xlsx", "CompraCore — Machos Koln"));
    expect(book.worksheets.map(s => s.name)).toEqual(["Lista de precios", "Detalle completo"]);
    const sheet = book.worksheets[0];
    expect(sheet.columnCount).toBe(7); expect(sheet.rowCount).toBe(4);
    expect(sheet.getCell("A1").value).toBe("CompraCore — Machos Koln");
    expect(sheet.getRow(3).values).toEqual([undefined, "Código interno", "Código proveedor", "Descripción interna", "Precio anterior", "Precio nuevo", "Diferencia", "Porcentaje"]);
    expect(sheet.getRow(4).values).toEqual([undefined, "000123", "PROV-CAJA", "Mi artículo x100", 900, 1000, 100, 100 / 900]);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 3 });
    expect(sheet.autoFilter).toBe("A3:G4");
    expect(book.worksheets[1].rowCount).toBe(5);
    expect(book.worksheets[1].getCell("J5").value).toBe("Pendiente");
    expect(book.worksheets[1].getCell("J5").fill).toMatchObject({ fgColor: { argb: "FFFFF3CD" } });
  });
  it("colorea subas y bajas y conserva la moneda en las siete columnas", async () => {
    const lower = row(); lower.product = { ...lower.product!, id: "p2", code: "000124", currency: "USD" };
    lower.item = { ...lower.item, supplier_currency: "USD", matched_product_id: "p2", matched_presentations: [{ product_id: "p2", supplier_quantity: 1000, own_quantity: 100 }] };
    lower.change = { ...lower.change!, product_id: "p2", new_price: 850, new_currency: "USD", old_currency: "USD", diff_absolute: -50 };
    const book = await captureBook(() => exportCustomComparison([row(), lower], "test.xlsx"));
    const sheet = book.worksheets[0];
    expect(sheet.getCell("F4").fill).toMatchObject({ fgColor: { argb: "FFFDE9E7" } });
    expect(sheet.getCell("F5").fill).toMatchObject({ fgColor: { argb: "FFE8F4EA" } });
    expect(sheet.getCell("E5").value).toBe(850);
    expect(sheet.getCell("E5").numFmt).toContain("USD");
    expect(sheet.getCell("A4").type).toBe(ExcelJS.ValueType.String);
  });
  it("el detalle usa también el precio editado y su diferencia real", async () => {
    const edited = row(); edited.change!.final_new_price = 950;
    const book = await captureBook(() => exportCustomComparison([edited], "test.xlsx"));
    expect(book.worksheets[0].getCell("E4").value).toBe(950);
    expect(book.worksheets[1].getCell("F4").value).toBe(950);
    expect(book.worksheets[1].getCell("G4").value).toBe(50);
    expect(book.worksheets[1].getCell("H4").value).toBeCloseTo(50 / 900 * 100);
  });
  it("si se consolidan filas iguales, conserva todos los códigos del proveedor", async () => {
    const duplicate = row(); duplicate.item = { ...duplicate.item, supplier_code: "OTRO-CODIGO" };
    const sheet = await capture(() => exportCustomComparison([row(), duplicate], "test.xlsx"));
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getCell("B4").value).toBe("PROV-CAJA / OTRO-CODIGO");
  });
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
