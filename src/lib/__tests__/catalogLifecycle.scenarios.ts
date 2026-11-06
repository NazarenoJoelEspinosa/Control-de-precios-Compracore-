import { getDB, productsRepo, suppliersRepo, priceListsRepo, priceListItemsRepo, comparisonSessionsRepo, priceChangesRepo, equivalencesRepo, settingsRepo } from "../db";
import { planCatalog, catalogRevision, syncCatalog, samePresentation, type CatalogInput } from "../catalogSync";
import { closeComparison } from "../comparisonLifecycle";
import { deleteSupplierPermanently } from "../supplierLifecycle";
import { runMatchingForPriceList } from "../runMatching";
import { savePresentations } from "../savePresentations";
import { decidePriceChanges, confirmMatch } from "../reviewActions";
import { exportBackup, importBackup } from "../backup";

/** Se ejecuta con fake-indexeddb en Vitest o con IndexedDB nativo en navegador. */
export async function runCatalogLifecycleScenarios() {
  const results: string[] = [];
  function check(value: unknown, message: string) { if (!value) throw new Error(message); results.push(message); }
  async function rejects(fn: () => unknown | Promise<unknown>, message: string) { let failed = false; try { await fn(); } catch { failed = true; } check(failed, message); }
  const db = await getDB();
  for (const store of db.objectStoreNames) await db.clear(store);
  const supplier = await suppliersRepo.create({ name: "Protec", code: "P", email: "", phone: "", active: true, price_includes_vat: false, vat_rate: 21, default_currency: "ARS", notes: "" });
  const other = await suppliersRepo.create({ ...supplier, name: "Otro", code: "O" });
  const input = (code: string, q = 1): CatalogInput => ({ code, description: `Tornillo ${code} x${q}`, unit: `x${q}`, brand: "", currency: "ARS", current_price: q * 10, active: true });
  const initial = [input("VIEJO"), input("AUSENTE"), input("PACK", 100)];
  await productsRepo.bulkUpsertByCode(other.id, [input("OTRO")]);
  await syncCatalog(supplier.id, initial, "complete", {}, catalogRevision([]));
  const existing = await productsRepo.listBySupplier(supplier.id);
  const old = existing.find(p => p.code === "VIEJO")!, absent = existing.find(p => p.code === "AUSENTE")!;
  await equivalencesRepo.confirm(supplier.id, "PROV", old.id);
  const eq = (await equivalencesRepo.listForSupplier(supplier.id))[0];
  await db.put("equivalences", { ...eq, supplier_quantity: 100, own_quantity: 1 });
  const next = [{ ...input("NUEVO"), description: "Tornillo corregido x1", current_price: 12 }, input("PACK", 100)];
  check(!planCatalog(existing, next, "complete").rows[0].previous, "Un código distinto nunca traslada memoria automáticamente");
  check(!samePresentation(input("A", 1), input("B", 2)), "x1 y x2 son presentaciones diferentes");
  await rejects(() => planCatalog(existing, [input("A", 2)], "complete", { 0: old.id }), "No permite vincular cantidades distintas");
  await rejects(() => syncCatalog(supplier.id, [next[0], next[0]], "complete", {}, catalogRevision(existing)), "Bloquea filas repetidas antes de escribir");
  check((await productsRepo.listBySupplier(supplier.id)).length === 3, "Un error no modifica el catálogo");
  await syncCatalog(supplier.id, next, "complete", { 0: old.id }, catalogRevision(existing));
  const updated = await productsRepo.get(old.id);
  check(updated?.code === "NUEVO" && updated.current_price === 12, "El cambio de código confirmado conserva el ID y actualiza el precio");
  check((await equivalencesRepo.listForSupplier(supplier.id))[0].supplier_quantity === 100, "Conserva códigos y cantidades aprendidas");
  check(!(await productsRepo.get(absent.id))?.active, "La lista completa desactiva ausentes sin borrarlos");
  check((await productsRepo.listBySupplier(other.id))[0].active, "Renovar no afecta otro proveedor");
  await rejects(() => syncCatalog(supplier.id, next, "complete", {}, catalogRevision(existing)), "Detecta una vista previa desactualizada");
  const revision = () => productsRepo.listBySupplier(supplier.id).then(catalogRevision);
  await syncCatalog(supplier.id, [input("PARCIAL")], "partial", {}, await revision());
  check((await productsRepo.get(old.id))?.active, "La sublista conserva artículos no incluidos");
  const beforeReactivate = await productsRepo.listBySupplier(supplier.id);
  await syncCatalog(supplier.id, [input("AUSENTE")], "partial", {}, catalogRevision(beforeReactivate));
  check((await productsRepo.get(absent.id))?.active, "Recupera el mismo ID cuando reaparece un artículo");
  await settingsRepo.save({ auto_confirm_exact: false });
  async function compare() {
    const list = await priceListsRepo.create({ supplier_id: supplier.id, file_name: "proveedor.xlsx", row_count: 1, status: "mapped", column_mapping: null });
    await priceListItemsRepo.bulkCreate([{ price_list_id: list.id, supplier_code: "PROV", supplier_description: "Tornillo x100", supplier_unit: "x100", supplier_brand: "", supplier_currency: "ARS", raw_price: "1500", parsed_price: null, parse_error: null, matched_product_id: null, match_level: null, match_score: null, match_state: "not_found", raw_data: {} }]);
    const id = await runMatchingForPriceList(list.id, supplier.id);
    return (await comparisonSessionsRepo.get(id))!;
  }
  const session = await compare();
  const changes = await priceChangesRepo.listBySession(session.id);
  check(changes.length === 1 && changes[0].new_price === 15, "La próxima comparación reutiliza la conversión aprendida");
  await rejects(async () => syncCatalog(supplier.id, next, "complete", {}, await revision()), "No renueva el catálogo con comparaciones abiertas");
  await decidePriceChanges(changes.map(c => c.id), "approved");
  await closeComparison(session.id);
  const closed = (await comparisonSessionsRepo.get(session.id))!;
  check(closed.status === "closed" && Boolean(closed.closed_at), "Finalizar conserva la comparación cerrada en historial");
  check((await equivalencesRepo.listForSupplier(supplier.id)).length === 1, "Finalizar conserva el aprendizaje");
  const item = (await priceListItemsRepo.listByPriceList(session.price_list_id))[0];
  await rejects(() => decidePriceChanges(changes.map(c => c.id), "rejected"), "No altera precios de comparaciones cerradas");
  await rejects(() => confirmMatch(session, item, old.id), "Una pestaña antigua tampoco puede cambiar una comparación cerrada");
  await rejects(() => savePresentations(session, item, [{ product_id: old.id, own_quantity: 1, supplier_quantity: 100 }]), "No cambia presentaciones de comparaciones cerradas");
  await syncCatalog(supplier.id, [{ ...next[0], description: "Descripción nueva x1", current_price: 20 }], "complete", {}, await revision());
  check((await comparisonSessionsRepo.get(session.id))?.catalog_snapshot?.find(p => p.id === old.id)?.current_price === 12, "El historial conserva el precio anterior a renovar");
  check((await comparisonSessionsRepo.get(session.id))?.catalog_snapshot?.find(p => p.id === old.id)?.description === "Tornillo corregido x1", "El historial conserva la descripción de la comparación");
  const second = await compare();
  check((await priceChangesRepo.listBySession(second.id)).every(c => c.status === "pending"), "La comparación nueva no hereda aprobaciones");
  await closeComparison(second.id);
  const backup = await exportBackup();
  for (const store of db.objectStoreNames) await db.clear(store);
  await importBackup(backup);
  check((await comparisonSessionsRepo.get(session.id))?.catalog_snapshot?.length === closed.catalog_snapshot?.length, "El backup conserva el historial con su catálogo");
  await rejects(() => deleteSupplierPermanently(other.id), "La eliminación definitiva exige que esté en papelera");
  await suppliersRepo.archive(supplier.id);
  await rejects(async () => syncCatalog(supplier.id, next, "complete", {}, await revision()), "Un proveedor en papelera no admite importaciones");
  await deleteSupplierPermanently(supplier.id);
  check(!(await suppliersRepo.get(supplier.id)), "Elimina definitivamente el proveedor seleccionado");
  check((await productsRepo.listBySupplier(supplier.id)).length === 0 && (await equivalencesRepo.listForSupplier(supplier.id)).length === 0, "Elimina catálogo y memoria del proveedor");
  check(!(await comparisonSessionsRepo.get(session.id)) && (await priceChangesRepo.listBySession(session.id)).length === 0 && (await priceListItemsRepo.listByPriceList(session.price_list_id)).length === 0, "Elimina comparaciones, precios y filas sin dejar referencias");
  check(Boolean(await suppliersRepo.get(other.id)) && (await productsRepo.listBySupplier(other.id)).length === 1, "La eliminación definitiva no afecta a otros proveedores");
  return results;
}
