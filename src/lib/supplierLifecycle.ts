import { getDB } from "./db";

/** Sólo desde papelera: elimina los datos de este proveedor en una transacción. */
export async function deleteSupplierPermanently(supplierId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["suppliers", "supplierColumnConfig", "products", "equivalences", "discontinuedCodes", "priceLists", "priceListItems", "comparisonSessions", "priceChanges", "presentationRules", "undoHistory"], "readwrite");
  try {
    const supplier = await tx.objectStore("suppliers").get(supplierId);
    if (!supplier?.deleted_at) throw new Error("Primero enviá el proveedor a la papelera.");
    const lists = (await tx.objectStore("priceLists").getAll()).filter(l => l.supplier_id === supplierId);
    const sessions = (await tx.objectStore("comparisonSessions").getAll()).filter(s => s.supplier_id === supplierId);
    const listIds = new Set(lists.map(l => l.id)), sessionIds = new Set(sessions.map(s => s.id));
    const productIds = new Set((await tx.objectStore("products").index("bySupplier").getAll(supplierId)).map(p => p.id));
    for (const store of ["supplierColumnConfig", "products", "equivalences", "discontinuedCodes", "presentationRules"] as const) {
      for (const row of await tx.objectStore(store).index("bySupplier").getAll(supplierId)) await tx.objectStore(store).delete(row.id);
    }
    const itemIds = new Set<string>();
    for (const item of await tx.objectStore("priceListItems").getAll()) if (listIds.has(item.price_list_id)) { itemIds.add(item.id); await tx.objectStore("priceListItems").delete(item.id); }
    const changeIds = new Set<string>();
    for (const change of await tx.objectStore("priceChanges").getAll()) if (sessionIds.has(change.comparison_session_id)) { changeIds.add(change.id); await tx.objectStore("priceChanges").delete(change.id); }
    for (const session of sessions) await tx.objectStore("comparisonSessions").delete(session.id);
    for (const list of lists) await tx.objectStore("priceLists").delete(list.id);
    // Elimina también acciones antiguas que podrían resucitar datos borrados.
    for (const action of await tx.objectStore("undoHistory").getAll()) {
      if (action.supplier_id === supplierId || (action.session_id && sessionIds.has(action.session_id)) || action.patches.some(p =>
        (p.store === "suppliers" && p.id === supplierId) || (p.store === "comparisonSessions" && sessionIds.has(p.id)) ||
        (p.store === "priceListItems" && itemIds.has(p.id)) || (p.store === "priceChanges" && changeIds.has(p.id)) ||
        [p.before, p.after].some(v => v && typeof v === "object" && ((v as { supplier_id?: string }).supplier_id === supplierId || productIds.has((v as { product_id?: string }).product_id ?? ""))))) await tx.objectStore("undoHistory").delete(action.id);
    }
    await tx.objectStore("suppliers").delete(supplierId);
    await tx.done;
    if (typeof window !== "undefined") { window.dispatchEvent(new Event("pricecore:history")); window.dispatchEvent(new Event("pricecore:restored")); }
  } catch (e) { try { tx.abort(); } catch { /* Ya abortada. */ } await tx.done.catch(() => undefined); throw e; }
}
