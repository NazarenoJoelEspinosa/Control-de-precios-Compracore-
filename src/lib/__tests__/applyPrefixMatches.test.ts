import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB, productsRepo, suppliersRepo, priceListsRepo, priceListItemsRepo, comparisonSessionsRepo, priceChangesRepo } from "../db";
import { applyPrefixMatches } from "../applyPrefixMatches";

beforeEach(async () => { const db = await getDB(); for (const name of db.objectStoreNames) await db.clear(name); });
async function fixture() {
  const supplier = await suppliersRepo.create({ name: "Proveedor con ET", code: "ET", email: "", phone: "", active: true, price_includes_vat: false, vat_rate: 21, default_currency: "ARS", notes: "", ignore_et_prefix: true });
  const product = await productsRepo.upsertByCode(supplier.id, { code: "EWCB21005", description: "CEPILLO COPA EMTOP TRENZ.100MM*", unit: "U", brand: "EMTOP", currency: "ARS", current_price: 6877, active: true });
  const list = await priceListsRepo.create({ supplier_id: supplier.id, file_name: "lista.csv", row_count: 1, status: "processed", column_mapping: null });
  const [item] = await priceListItemsRepo.bulkCreate([{ price_list_id: list.id, supplier_code: "ET-EWCB21005", supplier_description: "Cepillo 100mm RETORCIDO tca.M14x2 EMTOP EWCB21005", supplier_unit: "U", supplier_brand: "EMTOP", supplier_currency: "ARS", raw_price: "6.876,96", parsed_price: 6876.96, parse_error: null, matched_product_id: null, match_level: "none", match_score: null, match_state: "not_found", raw_data: {} }]);
  const session = await comparisonSessionsRepo.create({ supplier_id: supplier.id, price_list_id: list.id, total_items: 1, safe_matches: 0, review_items: 0, not_found_items: 1, new_products: 0, presentation_diff_items: 0, discontinued_items: 0, price_increases: 0, price_decreases: 0, price_unchanged: 0, approved_changes: 0, status: "open" });
  return { supplier, product, item, session };
}
describe("aplicar ET- sobre una comparación existente", () => {
  it("resuelve el ejemplo de la captura sin reimportar ni crear otra sesión; precio pendiente", async () => {
    const f = await fixture();
    expect(await applyPrefixMatches(f.session.id)).toEqual({ linked: 1, review: 0, linkedProductIds: [f.product.id] });
    const [item] = await priceListItemsRepo.listByPriceList(f.session.price_list_id);
    expect(item).toMatchObject({ matched_product_id: f.product.id, match_level: "code_prefix", match_state: "safe", supplier_code: "ET-EWCB21005" });
    expect((await priceChangesRepo.listBySession(f.session.id))[0]).toMatchObject({ status: "pending", new_price: 6876.96, old_price: 6877 });
    expect(await comparisonSessionsRepo.get(f.session.id)).toMatchObject({ safe_matches: 1, not_found_items: 0, approved_changes: 0 });
    expect(await (await getDB()).getAll("comparisonSessions")).toHaveLength(1);
    expect((await applyPrefixMatches(f.session.id)).linked).toBe(0);
    expect(await priceChangesRepo.listBySession(f.session.id)).toHaveLength(1);
  });
  it("no aplica si la opción está desactivada ni cambia otros proveedores", async () => {
    const f = await fixture(); await suppliersRepo.update(f.supplier.id, { ignore_et_prefix: false });
    await expect(applyPrefixMatches(f.session.id)).rejects.toThrow("Activá la regla");
    expect((await priceListItemsRepo.listByPriceList(f.session.price_list_id))[0].matched_product_id).toBeNull();
    expect(await priceChangesRepo.listBySession(f.session.id)).toHaveLength(0);
  });
  it("evita elegir entre dos códigos de catálogo con la misma base", async () => {
    const f = await fixture();
    await productsRepo.upsertByCode(f.supplier.id, { ...f.product, code: "EWCB-21005", description: "Otro producto" });
    expect(await applyPrefixMatches(f.session.id)).toMatchObject({ linked: 0, review: 1 });
  });
  it("deja para revisión cantidades diferentes y filas duplicadas del proveedor", async () => {
    const f = await fixture(); await priceListItemsRepo.update({ ...f.item, supplier_unit: "x100", supplier_description: "Cepillo x100 100mm" });
    expect(await applyPrefixMatches(f.session.id)).toMatchObject({ linked: 0, review: 1 });
    await priceListItemsRepo.update(f.item);
    await (await getDB()).put("priceListItems", { ...f.item, id: "duplicate" });
    expect(await applyPrefixMatches(f.session.id)).toMatchObject({ linked: 0, review: 2 });
    expect(await priceChangesRepo.listBySession(f.session.id)).toHaveLength(0);
  });
  it("respeta rechazos, discontinuados y vinculaciones previas", async () => {
    const f = await fixture(); const db = await getDB();
    await db.put("equivalences", { id: "rejected", supplier_id: f.supplier.id, supplier_code: f.item.supplier_code, product_id: f.product.id, decision: "rejected", origin: "manual", confidence: null, created_at: "", updated_at: "" });
    expect((await applyPrefixMatches(f.session.id)).linked).toBe(0);
    await db.clear("equivalences");
    await db.put("discontinuedCodes", { id: "disc", supplier_id: f.supplier.id, supplier_code: f.item.supplier_code, created_at: "" });
    expect((await applyPrefixMatches(f.session.id)).linked).toBe(0);
    await db.clear("discontinuedCodes");
    await priceListItemsRepo.update({ ...f.item, matched_product_id: f.product.id, match_state: "review" });
    expect((await applyPrefixMatches(f.session.id)).linked).toBe(0);
    expect((await priceListItemsRepo.listByPriceList(f.session.price_list_id))[0].match_state).toBe("review");
  });
  it("no sustituye precios ya decididos ni usa artículos de otro proveedor", async () => {
    const f = await fixture(); const db = await getDB();
    const change = { id: "old", comparison_session_id: f.session.id, price_list_item_id: f.item.id, product_id: f.product.id, old_price: 6877, new_price: 6876.96, final_new_price: null, old_currency: "ARS" as const, new_currency: "ARS" as const, diff_absolute: -0.04, diff_percent: 0, status: "rejected" as const, decided_at: null, created_at: "" };
    await db.put("priceChanges", change);
    expect((await applyPrefixMatches(f.session.id)).linked).toBe(0);
    expect(await db.get("priceChanges", "old")).toEqual(change);
    await db.clear("priceChanges");
    await productsRepo.upsertByCode("OTHER", { ...f.product, code: "EWCB21005" });
    await db.delete("products", f.product.id);
    expect((await applyPrefixMatches(f.session.id)).linked).toBe(0);
  });
});
