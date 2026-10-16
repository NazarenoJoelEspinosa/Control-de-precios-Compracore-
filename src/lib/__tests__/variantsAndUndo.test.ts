import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB, productsRepo, suppliersRepo, priceListsRepo, priceListItemsRepo, comparisonSessionsRepo, priceChangesRepo, equivalencesRepo } from "../db";
import { runMatchingForPriceList } from "../runMatching";
import { savePresentations } from "../savePresentations";
import { latestUndoAction, undoLastAction } from "../undoHistory";
import { decidePriceChanges, confirmMatch } from "../reviewActions";
import { applyPrefixMatches } from "../applyPrefixMatches";
import { updateComparisonLimits } from "../updateComparisonLimits";
import { editLearnedRelation, forgetLearnedRelation } from "../learnedRelationActions";
import { presentationReviewReason } from "../presentationReview";
import { buildGapReasons } from "../gapReasons";
import { exportBackup, importBackup } from "../backup";

beforeEach(async () => { const db = await getDB(); for (const store of db.objectStoreNames) await db.clear(store); });
async function supplier() { return suppliersRepo.create({ name: "Prueba", code: "P", email: "", phone: "", active: true, price_includes_vat: false, vat_rate: 21, default_currency: "ARS", notes: "", ignore_et_prefix: true }); }
async function fixture(sameCode = true) {
  const s = await supplier();
  const inputs = [100, 10, 1].map(q => ({ code: sameCode ? "TOR001" : `TOR${q}`, description: `Tornillo x${q}`, unit: `x${q}`, brand: "", currency: "ARS" as const, current_price: q * 9, active: true }));
  const { records: products } = await productsRepo.bulkUpsertByCode(s.id, inputs);
  const list = await priceListsRepo.create({ supplier_id: s.id, file_name: "lista", row_count: 1, status: "mapped", column_mapping: null });
  const [item] = await priceListItemsRepo.bulkCreate([{ price_list_id: list.id, supplier_code: "TOR001", supplier_description: "Tornillo x1000", supplier_unit: "x1000", supplier_brand: "", supplier_currency: "ARS", raw_price: "10.000", parsed_price: 10000, parse_error: null, matched_product_id: null, match_level: null, match_score: null, match_state: "not_found", raw_data: {} }]);
  const id = await runMatchingForPriceList(list.id, s.id);
  return { s, products, inputs, item: (await priceListItemsRepo.listByPriceList(list.id))[0], session: (await comparisonSessionsRepo.get(id))!, originalItem: item };
}
function conversions(f: Awaited<ReturnType<typeof fixture>>) { return f.products.map((p, i) => ({ product_id: p.id, supplier_quantity: 1000, own_quantity: [100, 10, 1][i] })); }
async function undo() { const last = await latestUndoAction(); expect(last).not.toBeNull(); await undoLastAction(last!.id); }

describe("tres presentaciones con el mismo código", () => {
  it("importa x100/x10/x1 sin pisarlas y conserva IDs al actualizar precios", async () => {
    const f = await fixture(); expect(f.products).toHaveLength(3); expect(new Set(f.products.map(p => p.code)).size).toBe(1);
    const again = await productsRepo.bulkUpsertByCode(f.s.id, f.inputs.map(p => ({ ...p, current_price: p.current_price + 1 })));
    expect(again.duplicatesInFile).toHaveLength(0); expect(again.records.map(p => p.id)).toEqual(f.products.map(p => p.id)); expect(await productsRepo.listBySupplier(f.s.id)).toHaveLength(3);
    expect(await productsRepo.getByCode(f.s.id, "TOR001")).toBeUndefined();
  });
  it("no pisa variantes sin columna de unidad y sólo colapsa filas realmente repetidas", async () => {
    const s = await supplier();
    const inputs = [100,10,1].map(q => ({ code: "X", description: `Tornillo 8 x 1 x${q}`, unit: "", brand: "", currency: "ARS" as const, current_price: q, active: true }));
    const result = await productsRepo.bulkUpsertByCode(s.id, [...inputs, { ...inputs[0], current_price: 999 }]);
    expect(result.records).toHaveLength(3); expect(result.duplicatesInFile).toEqual([{ code: "X", count: 2 }]);
    expect(result.records.find(p => p.description === inputs[0].description)?.current_price).toBe(999);
    const explicit = await productsRepo.bulkUpsertByCode(s.id, [100,10,1].map(q => ({ ...inputs[0], code: "Y", description: "Tornillo 8 x 1", unit: `x${q}` })));
    expect(explicit.records).toHaveLength(3);
  });
  it("pide enseñanza, calcula las tres variantes y las reutiliza en la próxima lista", async () => {
    const f = await fixture(); expect(f.item).toMatchObject({ match_state: "presentation_diff", matched_product_id: null }); expect(f.item.candidate_product_ids).toHaveLength(3);
    await savePresentations(f.session, f.item, conversions(f));
    expect((await priceChangesRepo.listBySession(f.session.id)).map(c => c.new_price).sort((a,b) => a-b)).toEqual([10,100,1000]);
    expect(await equivalencesRepo.listForSupplier(f.s.id)).toHaveLength(3);
    const next = await runMatchingForPriceList(f.item.price_list_id, f.s.id);
    expect((await priceListItemsRepo.listByPriceList(f.item.price_list_id))[0].matched_presentations).toHaveLength(3);
    expect((await priceChangesRepo.listBySession(next)).map(c => c.new_price).sort((a,b) => a-b)).toEqual([10,100,1000]);
  });
  it("el backup conserva las tres variantes del mismo código", async () => {
    const f = await fixture(); await savePresentations(f.session, f.item, conversions(f)); const payload = await exportBackup();
    const db = await getDB(); for (const store of db.objectStoreNames) await db.clear(store);
    await importBackup(payload); expect(await productsRepo.listBySupplier(f.s.id)).toHaveLength(3); expect(await equivalencesRepo.listForSupplier(f.s.id)).toHaveLength(3);
  });
});

describe("deshacer decisiones de revisión", () => {
  it("revierte enseñanza, precios, equivalencias y contadores en conjunto", async () => {
    const f = await fixture(); const before = await comparisonSessionsRepo.get(f.session.id);
    await savePresentations(f.session, f.item, conversions(f)); await undo();
    expect(await priceListItemsRepo.listByPriceList(f.item.price_list_id)).toEqual([f.item]);
    expect(await equivalencesRepo.listForSupplier(f.s.id)).toHaveLength(0); expect(await priceChangesRepo.listBySession(f.session.id)).toHaveLength(0);
    expect(await comparisonSessionsRepo.get(f.session.id)).toEqual(before);
  });
  it("revierte aprobación/rechazo de un lote y luego la enseñanza anterior", async () => {
    const f = await fixture(); await savePresentations(f.session, f.item, conversions(f));
    const changes = await priceChangesRepo.listBySession(f.session.id);
    await decidePriceChanges(changes.map(c => c.id), "approved"); expect((await comparisonSessionsRepo.get(f.session.id))?.approved_changes).toBe(3);
    await undo(); expect((await priceChangesRepo.listBySession(f.session.id)).every(c => c.status === "pending")).toBe(true);
    await decidePriceChanges(changes.map(c => c.id), "rejected"); await undo();
    expect((await priceChangesRepo.listBySession(f.session.id)).every(c => c.status === "pending")).toBe(true);
    await undo(); expect(await priceChangesRepo.listBySession(f.session.id)).toHaveLength(0);
  });
  it("revierte vinculaciones manuales y aplicación ET sin cambiar otros proveedores", async () => {
    const f = await fixture(false); const db = await getDB();
    await priceListItemsRepo.update({ ...f.item, supplier_code: "ET-TOR100", supplier_description: "Tornillo x100", supplier_unit: "x100", match_state: "not_found", matched_product_id: null, matched_presentations: undefined });
    const before = await priceListItemsRepo.listByPriceList(f.item.price_list_id);
    const result = await applyPrefixMatches(f.session.id); expect(result.linked).toBe(1); await undo(); expect(await priceListItemsRepo.listByPriceList(f.item.price_list_id)).toEqual(before);
    await confirmMatch(f.session, before[0], f.products[0].id); await undo(); expect(await equivalencesRepo.listForSupplier(f.s.id)).toHaveLength(0);
    expect(await priceListItemsRepo.listByPriceList(f.item.price_list_id)).toEqual(before);
  });
  it("no sobrescribe modificaciones posteriores y valida que se deshaga la acción esperada", async () => {
    const s = await supplier(); await suppliersRepo.update(s.id, { notes: "uno" }); const first = (await latestUndoAction())!;
    await suppliersRepo.update(s.id, { notes: "dos" }); await expect(undoLastAction(first.id)).rejects.toThrow("última acción");
    const last = (await latestUndoAction())!; const db = await getDB(); await db.put("suppliers", { ...(await suppliersRepo.get(s.id))!, notes: "cambio externo" });
    await expect(undoLastAction(last.id)).rejects.toThrow("cambios posteriores"); expect((await suppliersRepo.get(s.id))?.notes).toBe("cambio externo"); expect((await latestUndoAction())?.id).toBe(last.id);
  });
  it("conserva 20 acciones y no registra operaciones fallidas", async () => {
    const s = await supplier(); for (let i=0;i<25;i++) await suppliersRepo.update(s.id, { notes: String(i) });
    expect(await (await getDB()).getAll("undoHistory")).toHaveLength(20);
    const f = await fixture(); const before = await latestUndoAction();
    await expect(savePresentations(f.session, f.item, [{ product_id: f.products[0].id, supplier_quantity: 0, own_quantity: 1 }])).rejects.toThrow();
    expect(await latestUndoAction()).toEqual(before);
  });
});

describe("límites por proveedor y memoria editable", () => {
  it("aplica los nuevos límites a la comparación existente y permite deshacerlos", async () => {
    const f = await fixture(false); const db = await getDB();
    await priceListItemsRepo.update({ ...f.item, matched_product_id: f.products[0].id, match_state: "safe", parsed_price: 1350, presentation_limits: { increase: 100, decrease: 50 } });
    await suppliersRepo.update(f.s.id, { presentation_increase_percent: 40, presentation_decrease_percent: 20 });
    await updateComparisonLimits(f.session.id); const [item] = await priceListItemsRepo.listByPriceList(f.item.price_list_id);
    expect(item.presentation_limits).toEqual({ increase: 40, decrease: 20 }); expect(presentationReviewReason(item, f.products[0])).toBeTruthy();
    await undo(); expect((await db.get("priceListItems", item.id))?.presentation_limits).toEqual({ increase: 100, decrease: 50 });
  });
  it("edita y olvida una relación para futuras listas sin alterar resultados anteriores", async () => {
    const f = await fixture(); await savePresentations(f.session, f.item, conversions(f));
    const before = await priceChangesRepo.listBySession(f.session.id); const [eq] = await equivalencesRepo.listForSupplier(f.s.id);
    await editLearnedRelation(eq.id, 500, 100); expect((await (await getDB()).get("equivalences", eq.id))?.supplier_quantity).toBe(500);
    expect(await priceChangesRepo.listBySession(f.session.id)).toEqual(before); await undo(); expect(await (await getDB()).get("equivalences", eq.id)).toEqual(eq);
    await forgetLearnedRelation(eq.id); expect(await (await getDB()).get("equivalences", eq.id)).toBeUndefined(); await undo(); expect(await (await getDB()).get("equivalences", eq.id)).toEqual(eq);
  });
  it("explica una fila ya vinculada que tiene otras presentaciones propias pendientes", async () => {
    const f = await fixture(); const source = { ...f.item, matched_product_id: f.products[0].id, match_state: "safe" as const };
    const reasons = buildGapReasons(f.products.slice(1), [source], false, [], []);
    expect(reasons[f.products[1].id]).toMatchObject({ kind: "linked", itemId: f.item.id });
    expect(reasons[f.products[1].id].message).toContain("presentaciones");
    expect(buildGapReasons(f.products, [{ ...f.item, supplier_code: "ET-TOR001" }], false, [], [])[f.products[0].id].kind).toBe("prefix_disabled");
  });
});
