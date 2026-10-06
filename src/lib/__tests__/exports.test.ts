import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { exportAllResults, exportApprovedOnly, type ExportRow } from "../exportResults";
import type { PriceListItem, Product, PriceChange } from "@/types/database";

function row(status: PriceChange["status"] = "approved", error: string | null = null): ExportRow {
  const product: Product = { id: "p", supplier_id: "s", code: "TOR100", description: "Tornillo x100", unit: "x100", brand: "", currency: "ARS", current_price: 900, active: true, created_at: "", updated_at: "" };
  const item: PriceListItem = { id: "i", price_list_id: "l", supplier_code: "CAJA", supplier_description: "Tornillo x1000", supplier_unit: "x1000", supplier_brand: "", supplier_currency: "ARS", raw_price: "10.000", parsed_price: 10000, parse_error: error, matched_product_id: "p", match_level: "equivalence", match_score: 100, match_state: "safe", matched_presentations: [{ product_id: "p", supplier_quantity: 1000, own_quantity: 100 }], raw_data: {}, created_at: "" };
  const change: PriceChange = { id: "c", comparison_session_id: "session", price_list_item_id: "i", product_id: "p", old_price: 900, new_price: 1000, final_new_price: null, old_currency: "ARS", new_currency: "ARS", diff_absolute: 100, diff_percent: 11.11, status, decided_at: null, created_at: "" };
  return { item, product, change };
}
async function capture(action: () => Promise<void>) {
  let blob: Blob | null = null;
  vi.stubGlobal("document", { createElement: () => ({ click() {}, href: "", download: "" }) });
  const create = vi.spyOn(URL, "createObjectURL").mockImplementation(value => { blob = value as Blob; return "blob:test"; });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  try {
    await action();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob!.arrayBuffer());
    return workbook.worksheets[0];
  } finally { create.mockRestore(); revoke.mockRestore(); vi.unstubAllGlobals(); }
}
describe("Excel de resultados", () => {
  it("conserva precio original, convertido, monedas y divisor", async () => {
    const sheet = await capture(() => exportAllResults([row()], "test.xlsx"));
    expect(sheet.getRow(4).getCell(6).value).toBe(1000);
    expect(sheet.getRow(4).getCell(11).value).toBe("ARS");
    expect(sheet.getRow(4).getCell(14).value).toContain("dividir por 10");
    expect(sheet.getRow(4).getCell(15).value).toBe(10000);
  });
  it("solo exporta aprobados válidos y excluye pendientes, rechazados y errores", async () => {
    const sheet = await capture(() => exportApprovedOnly([row(), row("pending"), row("rejected"), row("approved", "Precio inválido")], "test.xlsx"));
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getRow(4).getCell(10).value).toBe("Aprobado");
  });
});
