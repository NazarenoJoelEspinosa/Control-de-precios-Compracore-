import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB, productsRepo, priceListsRepo, priceListItemsRepo, comparisonSessionsRepo, priceChangesRepo, settingsRepo, presentationRulesRepo, suppliersRepo } from "../db";
import { parseDecimal } from "../normalize";
import { prepareCatalogImport } from "../catalogImport";
import { parseCurrency } from "../pricePolicy";
import { confirmMatch, decidePriceChanges } from "../reviewActions";
import { savePresentations } from "../savePresentations";
import { runMatchingForPriceList } from "../runMatching";
import type { Currency } from "@/types/database";

beforeEach(async () => { const db = await getDB(); for (const name of db.objectStoreNames) await db.clear(name); });
async function setup(code = "A", currency: Currency = "ARS") {
  const s = await suppliersRepo.create({ name: "Proveedor", code: "P", email: "", phone: "", active: true, price_includes_vat: false, vat_rate: 21, default_currency: "ARS", notes: "" });
  const product = await productsRepo.upsertByCode(s.id, { code, description: "Tornillo x100", unit: "x100", brand: "", currency, current_price: 1000, active: true });
  const list = await priceListsRepo.create({ supplier_id: s.id, file_name: "lista.csv", row_count: 1, status: "mapped", column_mapping: null });
  const [item] = await priceListItemsRepo.bulkCreate([{ price_list_id: list.id, supplier_code: code, supplier_description: "Tornillo x1000", supplier_unit: "x1000", supplier_brand: "", raw_price: "12.000,00", parsed_price: null, parse_error: null, matched_product_id: null, match_level: null, match_score: null, match_state: "not_found", raw_data: {} }]);
  return { s, product, list, item };
}
describe("Correcciones de claridad y precios", () => {
  it("no rescata números de textos, admite agrupaciones completas y coma decimal precisa", () => {
    expect(parseDecimal("18,455")).toBe(18.46);
    expect(parseDecimal(".50")).toBe(0.5);
    expect(parseDecimal("1.234.567")).toBe(1234567);
    expect(parseDecimal("1,234,567.89")).toBe(1234567.89);
    expect(parseDecimal("18.778,455")).toBe(18778.46);
    expect(parseDecimal("1.500")).toBe(1500);
    for (const invalid of ["Consultar 123", "10.20,30", "1,,2", "10,", "1.2.3", Infinity, NaN]) expect(() => parseDecimal(invalid)).toThrow();
  });
  it("importar catálogo muestra filas inválidas y respeta moneda de columna o proveedor", () => {
    const mapping = { code: "codigo", description: "nombre", price: "precio", currency: "moneda" };
    const result = prepareCatalogImport([
      { codigo: "A", nombre: "Tornillo", precio: "Consultar 123", moneda: "USD" },
      { codigo: "B", nombre: "Disco", precio: "1.234,50", moneda: "USD" },
      { codigo: "C", nombre: "Llave", precio: "12,50", moneda: "" },
    ], mapping, "ARS");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("A");
    expect(result.products.map(p => [p.code, p.current_price, p.currency])).toEqual([["B",1234.5,"USD"],["C",12.5,"ARS"]]);
  });
  it("conserva el código seguro aunque cambie la presentación y se desactive aprobación", async () => {
    const f = await setup(); await settingsRepo.save({ auto_confirm_exact: false, enable_description: false, enable_code_family: false });
    const id = await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceListItemsRepo.listByPriceList(f.list.id))[0].match_state).toBe("safe");
    expect((await priceChangesRepo.listBySession(id))[0].status).toBe("pending");
    expect((await comparisonSessionsRepo.get(id))?.approved_changes).toBe(0);
  });
  it("aprobación automática por defecto sigue funcionando para códigos coincidentes", async () => {
    const f = await setup(); const id = await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceChangesRepo.listBySession(id))[0].status).toBe("approved");
  });
  it("una moneda incompatible identifica el artículo pero no calcula aumentos", async () => {
    const f = await setup("A", "USD");
    const id = await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceListItemsRepo.listByPriceList(f.list.id))[0].supplier_currency).toBe("ARS");
    expect((await priceListItemsRepo.listByPriceList(f.list.id))[0].match_state).toBe("safe");
    expect(await priceChangesRepo.listBySession(id)).toHaveLength(0);
    expect((await comparisonSessionsRepo.get(id))?.price_increases).toBe(0);
    expect(parseCurrency("EUR", "ARS").error).toBeTruthy();
    expect(parseCurrency("U$S", "ARS").currency).toBe("USD");
  });
  it("un precio inválido no cuenta como precio sin cambios ni aprobado", async () => {
    const f = await setup(); await priceListItemsRepo.update({ ...f.item, raw_price: "Consultar 123" });
    const id = await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceListItemsRepo.listByPriceList(f.list.id))[0].parse_error).toBeTruthy();
    expect(await priceChangesRepo.listBySession(id)).toHaveLength(0);
    expect((await comparisonSessionsRepo.get(id))?.price_unchanged).toBe(0);
  });
  it("la moneda mapeada prevalece sobre la predeterminada del proveedor", async () => {
    const f = await setup("A", "USD"); await priceListItemsRepo.update({ ...f.item, supplier_currency: "USD" });
    const id = await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceChangesRepo.listBySession(id))[0].new_currency).toBe("USD");
  });
  it("desactivar búsquedas por descripción y familia evita sugerencias", async () => {
    const f = await setup("TOR8X1X100");
    await priceListItemsRepo.update({ ...f.item, supplier_code: "TOR8X1X1000" });
    await settingsRepo.save({ enable_description: false, enable_code_family: false });
    await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceListItemsRepo.listByPriceList(f.list.id))[0].match_state).toBe("not_found");
    await settingsRepo.save({ enable_code_family: true });
    await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceListItemsRepo.listByPriceList(f.list.id))[0].match_level).toBe("code_family");
  });
  it("el máximo de candidatos configurado limita realmente la búsqueda por descripción", async () => {
    const f = await setup(); const db = await getDB();
    await db.delete("products", f.product.id);
    await db.put("products", { ...f.product, id: "b" });
    await db.put("products", { ...f.product, id: "a", code: "OTRO", description: "Tornillo x200", unit: "x200" });
    await priceListItemsRepo.update({ ...f.item, supplier_code: "ZZ", supplier_description: "Tornillo x100", supplier_unit: "x100" });
    await settingsRepo.save({ max_candidates: 1, enable_code_family: false, enable_description: true });
    await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceListItemsRepo.listByPriceList(f.list.id))[0].matched_product_id).not.toBe("b");
    await settingsRepo.save({ max_candidates: 2 });
    await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceListItemsRepo.listByPriceList(f.list.id))[0].matched_product_id).toBe("b");
  });
  it("las reglas generales aplican el factor y no confunden x1000 con x10000", async () => {
    const f = await setup(); await presentationRulesRepo.create({ supplier_id: f.s.id, supplier_label: "x1000", own_label: "x100", supplier_pattern: "x 1000", factor: 0.1, active: true });
    const id = await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceChangesRepo.listBySession(id))[0].new_price).toBe(1200);
    await priceListItemsRepo.update({ ...f.item, supplier_description: "Tornillo x10000", supplier_unit: "x10000" });
    const id2 = await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceChangesRepo.listBySession(id2))[0].new_price).toBe(12000);
  });
  it("reglas contradictorias bloquean el precio sin inventar una conversión", async () => {
    const f = await setup();
    for (const factor of [0.1, 0.2]) await presentationRulesRepo.create({ supplier_id: f.s.id, supplier_label: "x1000", own_label: "x100", supplier_pattern: "x1000", factor, active: true });
    const id = await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceListItemsRepo.listByPriceList(f.list.id))[0].comparison_error).toMatch(/contradictorias/);
    expect(await priceChangesRepo.listBySession(id)).toHaveLength(0);
    const session = (await comparisonSessionsRepo.get(id))!, item = (await priceListItemsRepo.listByPriceList(f.list.id))[0];
    await savePresentations(session, item, [{ product_id: f.product.id, supplier_quantity: 1000, own_quantity: 100 }]);
    expect((await priceChangesRepo.listBySession(id))[0].new_price).toBe(1200);
    expect((await priceListItemsRepo.listByPriceList(f.list.id))[0].comparison_error).toBeNull();
    const next = await runMatchingForPriceList(f.list.id, f.s.id);
    expect((await priceChangesRepo.listBySession(next))[0].new_price).toBe(1200);
  });
  it("confirmar identidad deja precio pendiente; aprobar/rechazar recalcula estadísticas", async () => {
    const f = await setup(); await settingsRepo.save({ auto_confirm_exact: false });
    const id = await runMatchingForPriceList(f.list.id, f.s.id);
    const session = (await comparisonSessionsRepo.get(id))!, item = (await priceListItemsRepo.listByPriceList(f.list.id))[0];
    await confirmMatch(session, item, f.product.id);
    let changes = await priceChangesRepo.listBySession(id);
    expect(changes[0].status).toBe("pending");
    await decidePriceChanges(changes.map(c => c.id), "approved");
    expect((await comparisonSessionsRepo.get(id))?.approved_changes).toBe(1);
    await decidePriceChanges(changes.map(c => c.id), "rejected");
    expect((await comparisonSessionsRepo.get(id))?.price_increases).toBe(0);
    expect((await comparisonSessionsRepo.get(id))?.approved_changes).toBe(0);
    await expect(decidePriceChanges([changes[0].id, "missing"], "approved")).rejects.toThrow();
    changes = await priceChangesRepo.listBySession(id); expect(changes[0].status).toBe("rejected");
  });
});
