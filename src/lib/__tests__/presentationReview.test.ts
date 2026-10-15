import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { presentationReviewReason } from "../presentationReview";
import { matchesResultFilters } from "../resultFilters";
import { getDB, suppliersRepo, productsRepo, priceListsRepo, priceListItemsRepo, comparisonSessionsRepo, priceChangesRepo } from "../db";
import { runMatchingForPriceList } from "../runMatching";
import { decidePriceChanges } from "../reviewActions";
import { savePresentations } from "../savePresentations";
import type { ExportRow } from "../exportResults";
import type { Product, PriceListItem, PriceChange } from "@/types/database";
export function example(): ExportRow {
  const product = { id: "p", supplier_id: "s", code: "EMHU2E02", description: "ABRAZADERA EMTOP 10-16 C/MARIPOSA", unit: "U", brand: "EMTOP", currency: "ARS", current_price: 212.58, active: true } as Product;
  const item = { id: "i", price_list_id: "l", supplier_code: "EMHU2E02", supplier_description: "Abrazadera americana con mariposa fleje 8mm 10-16mm TV x 50uni EMTOP EMHU2E02", supplier_unit: "U", supplier_brand: "EMTOP", supplier_currency: "ARS", parsed_price: 10629.45, raw_price: "10.629,45", parse_error: null, matched_product_id: "p", match_state: "safe", match_level: "exact_code", match_score: 100 } as PriceListItem;
  const change = { id: "c", comparison_session_id: "session", price_list_item_id: "i", product_id: "p", old_price: 212.58, new_price: 10629.45, final_new_price: null, old_currency: "ARS", new_currency: "ARS", diff_absolute: 10416.87, diff_percent: 4900.21, status: "approved" } as PriceChange;
  return { product, item, change };
}
describe("avisos de presentación y filtros combinables", () => {
  it("detecta el caso de la captura aunque tenga código exacto y aprobación antigua", () => {
    const r = example(); expect(presentationReviewReason(r.item, r.product, r.change)).toBeTruthy();
    expect(matchesResultFilters(r, "review", "presentations", "all")).toBe(true);
    expect(matchesResultFilters(r, "approved", "all", "all")).toBe(false);
    expect(matchesResultFilters(r, "pending", "all", "all")).toBe(false);
  });
  it("detecta duplicación y reducción a la mitad; no confunde cero, moneda ni aumento normal", () => {
    const r = example();
    for (const price of [425.16, 106.29]) expect(presentationReviewReason(r.item, r.product, { ...r.change!, new_price: price })).toBeTruthy();
    for (const price of [230, 212.58, 0]) expect(presentationReviewReason(r.item, r.product, { ...r.change!, new_price: price })).toBeNull();
    expect(presentationReviewReason(r.item, { ...r.product!, current_price: 0 }, null)).toBeNull();
    expect(presentationReviewReason({ ...r.item, supplier_currency: "USD" }, r.product, r.change)).toBeNull();
  });
  it("una conversión confirmada, incluida 1:1, resuelve el aviso", () => {
    const r = example(); const item = { ...r.item, matched_presentations: [{ product_id: "p", supplier_quantity: 1, own_quantity: 1 }] };
    expect(presentationReviewReason(item, r.product, r.change)).toBeNull();
    expect(matchesResultFilters({ ...r, item }, "approved", "all", "all")).toBe(true);
  });
  it("conserva filtros avanzados y separa identificación, precio y presentaciones", () => {
    const r = example(); const normal = { ...r, change: { ...r.change!, status: "pending" as const, new_price: 230, diff_absolute: 17.42 } };
    expect(matchesResultFilters(normal, "pending", "all", "increased")).toBe(true);
    expect(matchesResultFilters(normal, "pending", "all", "decreased")).toBe(false);
    expect(matchesResultFilters({ ...r, item: { ...r.item, parse_error: "Inválido" } }, "review", "price", "all")).toBe(true);
    expect(matchesResultFilters({ ...r, item: { ...r.item, match_state: "review" } }, "review", "identification", "all")).toBe(true);
    const unmatched = { item: { ...r.item, match_state: "not_found" as const, matched_product_id: null }, product: null, change: null };
    expect(matchesResultFilters(unmatched, "review", "all", "all")).toBe(false);
    expect(matchesResultFilters(unmatched, "all", "all", "not_found")).toBe(true);
    expect(matchesResultFilters({ ...normal, change: { ...normal.change!, status: "rejected" } }, "all", "all", "rejected_price")).toBe(true);
  });
});

beforeEach(async () => { const db = await getDB(); for (const name of db.objectStoreNames) await db.clear(name); });
describe("flujo de aprobación protegido", () => {
  it("mantiene el código identificado, bloquea aprobar el precio de caja y permite aprobarlo después de enseñar x50 a x1", async () => {
    const r = example(); const db = await getDB();
    await db.put("products", r.product!);
    await suppliersRepo.create({ name: "Test", code: "", email: "", phone: "", active: true, price_includes_vat: false, vat_rate: 21, default_currency: "ARS", notes: "" });
    const list = await priceListsRepo.create({ supplier_id: "s", file_name: "lista", row_count: 1, status: "mapped", column_mapping: null });
    await db.put("priceListItems", { ...r.item, price_list_id: list.id });
    const sessionId = await runMatchingForPriceList(list.id, "s");
    const session = (await comparisonSessionsRepo.get(sessionId))!;
    const [item] = await priceListItemsRepo.listByPriceList(list.id);
    const [change] = await priceChangesRepo.listBySession(sessionId);
    expect(item.match_state).toBe("safe"); expect(change.status).toBe("pending");
    await expect(decidePriceChanges([change.id], "approved")).rejects.toThrow("presentación");
    await savePresentations(session, item, [{ product_id: "p", supplier_quantity: 50, own_quantity: 1 }]);
    const [converted] = await priceChangesRepo.listBySession(sessionId);
    expect(converted).toMatchObject({ new_price: 212.59, diff_absolute: 0.01, status: "pending" });
    await decidePriceChanges([converted.id], "approved");
    expect((await comparisonSessionsRepo.get(sessionId))?.approved_changes).toBe(1);
    const next = await runMatchingForPriceList(list.id, "s");
    expect((await priceChangesRepo.listBySession(next))[0]).toMatchObject({ new_price: 212.59, status: "pending" });
  });
  it("bloquea la aprobación de un lote completo si incluye una presentación pendiente", async () => {
    const r = example(); const db = await getDB();
    await db.put("products", r.product!); await db.put("priceListItems", r.item);
    await db.put("comparisonSessions", { id: "session", supplier_id: "s", price_list_id: "l" } as never);
    await db.put("priceChanges", { ...r.change!, status: "pending" });
    await db.put("priceChanges", { ...r.change!, id: "other", new_price: 230, status: "pending" });
    await expect(decidePriceChanges(["other", "c"], "approved")).rejects.toThrow("presentación");
    expect((await db.get("priceChanges", "other"))?.status).toBe("pending");
  });
});
