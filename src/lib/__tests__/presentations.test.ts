import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB, productsRepo, priceListsRepo, priceListItemsRepo, comparisonSessionsRepo, priceChangesRepo, equivalencesRepo } from "../db";
import { convertPresentationPrice } from "../presentationConversions";
import { savePresentations } from "../savePresentations";
import { exportBackup, importBackup, readBackupFile } from "../backup";
import { runMatchingForPriceList } from "../runMatching";
import type { PriceListItem, Product } from "@/types/database";

beforeEach(async () => {
  const db = await getDB();
  for (const name of db.objectStoreNames) await db.clear(name);
});
async function fixture() {
  const products: Product[] = [];
  for (const [code, own, price] of [["TOR100", 100, 900], ["TOR10", 10, 90], ["TORU", 1, 9]] as const) {
    products.push(await productsRepo.upsertByCode("s1", { code, description: `Tornillo x${own}`, unit: `x${own}`, brand: "", currency: "ARS", current_price: price, active: true }));
  }
  const list = await newList();
  const id = await runMatchingForPriceList(list.id, "s1");
  return { products, session: (await comparisonSessionsRepo.get(id))!, item: (await priceListItemsRepo.listByPriceList(list.id))[0] };
}
async function newList(price = "10.000,00") {
  const list = await priceListsRepo.create({ supplier_id: "s1", file_name: "tornillos.csv", row_count: 1, status: "mapped", column_mapping: null });
  await priceListItemsRepo.bulkCreate([{ price_list_id: list.id, supplier_code: "CAJA", supplier_description: "Tornillo x1000", supplier_unit: "x1000", supplier_brand: "", raw_price: price, parsed_price: null, parse_error: null, matched_product_id: null, match_level: null, match_score: null, match_state: "not_found", raw_data: {} }]);
  return list;
}

describe("Presentaciones por artículo", () => {
  it("convierte x1000 a x100, x10 y xU, incluida cantidad decimal y cero", () => {
    expect([100, 10, 1].map(q => convertPresentationPrice(10000, 1000, q))).toEqual([1000, 100, 10]);
    expect(convertPresentationPrice(18778.455, 1000, 100)).toBe(1877.85);
    expect(convertPresentationPrice(0, 1000, 1)).toBe(0);
    expect(convertPresentationPrice(100, 1, 0.5)).toBe(50);
    for (const q of [0, -1, NaN, Infinity]) expect(() => convertPresentationPrice(100, q, 1)).toThrow();
  });
  it("guarda tres artículos, reutiliza aprendizaje y no duplica al volver a guardar", async () => {
    const { products, session, item } = await fixture();
    const conversions = products.map((p, i) => ({ product_id: p.id, supplier_quantity: 1000, own_quantity: [100, 10, 1][i] }));
    await savePresentations(session, item, conversions);
    // Se pasa a propósito la sesión vieja: la acción debe leer el estado actual.
    await savePresentations(session, item, conversions);
    expect((await priceChangesRepo.listBySession(session.id)).map(c => c.new_price).sort((a,b) => a-b)).toEqual([10,100,1000]);
    expect(await equivalencesRepo.listForSupplier("s1")).toHaveLength(3);
    expect((await comparisonSessionsRepo.get(session.id))?.safe_matches).toBe(1);
    expect((await comparisonSessionsRepo.get(session.id))?.price_increases).toBe(3);
    const next = await newList("20.000,00");
    const nextSession = await runMatchingForPriceList(next.id, "s1");
    expect((await priceChangesRepo.listBySession(nextSession)).map(c => c.new_price).sort((a,b) => a-b)).toEqual([20,200,2000]);
    expect((await priceListItemsRepo.listByPriceList(next.id))[0].matched_presentations).toHaveLength(3);
  });
  it("reemplaza cantidades y quita una relación sin dejar precios anteriores", async () => {
    const { products, session, item } = await fixture();
    await savePresentations(session, item, products.map(p => ({ product_id: p.id, supplier_quantity: 1000, own_quantity: 1 })));
    await savePresentations(session, item, [{ product_id: products[0].id, supplier_quantity: 500, own_quantity: 100 }]);
    expect(await equivalencesRepo.listForSupplier("s1")).toHaveLength(1);
    expect((await priceChangesRepo.listBySession(session.id)).map(c => c.new_price)).toEqual([2000]);
    expect((await comparisonSessionsRepo.get(session.id))?.price_increases).toBe(1);
  });
  it("rechaza duplicados, cantidades inválidas y productos ajenos sin escrituras parciales", async () => {
    const { products, session, item } = await fixture();
    const foreign = await productsRepo.upsertByCode("s2", { code: "AJENO", description: "Otro producto", unit: "u", brand: "", currency: "ARS", current_price: 1, active: true });
    const valid = { product_id: products[0].id, supplier_quantity: 1000, own_quantity: 100 };
    const before = await priceListItemsRepo.listByPriceList(session.price_list_id);
    for (const rows of [[valid, valid], [{ ...valid, own_quantity: 0 }], [valid, { ...valid, product_id: foreign.id }]]) {
      await expect(savePresentations(session, item, rows)).rejects.toThrow();
    }
    expect(await equivalencesRepo.listForSupplier("s1")).toHaveLength(0);
    expect(await priceListItemsRepo.listByPriceList(session.price_list_id)).toEqual(before);
  });
  it("no inventa conversiones para equivalencias viejas ni para otro proveedor", async () => {
    const { products, session, item } = await fixture();
    await equivalencesRepo.confirm("s1", "CAJA", products[0].id);
    const next = await newList();
    const id = await runMatchingForPriceList(next.id, "s1");
    expect((await priceListItemsRepo.listByPriceList(next.id))[0].matched_presentations).toBeUndefined();
    await savePresentations(session, item, [{ product_id: products[0].id, supplier_quantity: 1000, own_quantity: 100 }]);
    const s2 = await productsRepo.upsertByCode("s2", { code: "CAJA", description: "Tornillo x1000", unit: "x1000", brand: "", currency: "ARS", current_price: 900, active: true });
    const db = await getDB();
    await db.put("priceLists", { ...(await priceListsRepo.get(next.id))!, supplier_id: "s2" });
    const other = await runMatchingForPriceList(next.id, "s2");
    expect((await priceChangesRepo.listBySession(other))[0].product_id).toBe(s2.id);
    expect((await priceChangesRepo.listBySession(other))[0].new_price).toBe(10000);
    expect(await priceChangesRepo.listBySession(id)).not.toHaveLength(0);
  });
  it("restaura el aprendizaje y resultados desde un backup v2", async () => {
    const { products, session, item } = await fixture();
    await savePresentations(session, item, [{ product_id: products[0].id, supplier_quantity: 1000, own_quantity: 100 }]);
    const backup = await exportBackup();
    const parsed = await readBackupFile(new File([JSON.stringify(backup)], "backup.json"));
    const db = await getDB();
    for (const name of db.objectStoreNames) await db.clear(name);
    await importBackup(parsed);
    expect((await equivalencesRepo.listForSupplier("s1"))[0].own_quantity).toBe(100);
    expect((await priceListItemsRepo.listByPriceList(session.price_list_id))[0].matched_presentations).toHaveLength(1);
    const next = await newList();
    const id = await runMatchingForPriceList(next.id, "s1");
    expect((await priceChangesRepo.listBySession(id))[0].new_price).toBe(1000);
  });
  it("conserva conversiones sin cambio y permite enseñar aunque el precio sea inválido", async () => {
    const { products, session, item } = await fixture();
    const db = await getDB();
    await db.put("products", { ...products[0], current_price: 1000 });
    await savePresentations(session, item, [{ product_id: products[0].id, supplier_quantity: 1000, own_quantity: 100 }]);
    expect((await priceChangesRepo.listBySession(session.id))[0].diff_absolute).toBe(0);
    expect((await comparisonSessionsRepo.get(session.id))?.price_unchanged).toBe(1);
    const next = await newList("N/A");
    const id = await runMatchingForPriceList(next.id, "s1");
    expect(await priceChangesRepo.listBySession(id)).toHaveLength(0);
    const invalid: PriceListItem = (await priceListItemsRepo.listByPriceList(next.id))[0];
    expect(invalid.parse_error).toBeTruthy();
    expect(invalid.matched_presentations).toHaveLength(1);
  });
});
