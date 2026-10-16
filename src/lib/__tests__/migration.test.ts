import "fake-indexeddb/auto";
import { openDB } from "idb";
import { expect, it } from "vitest";
import { getDB, productsRepo } from "../db";
it("migra desde v5 sin borrar artículos y permite nuevas presentaciones del mismo código", async () => {
  const old = await openDB("pricecore", 5, { upgrade(db) { const store = db.createObjectStore("products", { keyPath: "id" }); store.createIndex("bySupplier", "supplier_id"); store.createIndex("bySupplierCode", ["supplier_id", "code"], { unique: true }); } });
  const product = { id: "old-id", supplier_id: "s", code: "TOR", description: "Tornillo x100", unit: "x100", brand: "", current_price: 900, currency: "ARS" as const, active: true, created_at: "", updated_at: "" };
  await old.put("products", product); old.close();
  const current = await getDB(); expect(current.version).toBe(6); expect(await current.get("products", "old-id")).toEqual(product);
  await productsRepo.upsertByCode("s", { ...product, description: "Tornillo x10", unit: "x10", current_price: 90 });
  expect(await productsRepo.listBySupplier("s")).toHaveLength(2); expect(current.objectStoreNames.contains("undoHistory")).toBe(true);
});
