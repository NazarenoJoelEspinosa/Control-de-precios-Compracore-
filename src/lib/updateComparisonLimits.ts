import { getDB } from "./db";
import { beginUndoAction } from "./undoHistory";
import { supplierPresentationLimits } from "./presentationReview";
import { comparisonStats } from "./comparisonStats";
export async function updateComparisonLimits(sessionId: string): Promise<void> {
  const db = await getDB(); const tx = db.transaction(["suppliers", "priceListItems", "priceChanges", "comparisonSessions", "products", "undoHistory"], "readwrite");
  try {
    const session = await tx.objectStore("comparisonSessions").get(sessionId); if (!session) throw new Error("La comparación ya no está disponible.");
    const supplier = await tx.objectStore("suppliers").get(session.supplier_id);
    const items = await tx.objectStore("priceListItems").index("byPriceList").getAll(session.price_list_id);
    const finish = await beginUndoAction(tx, "Actualizar límites de revisión", { sessionId, supplierId: session.supplier_id, itemIds: items.map(i => i.id) });
    const limits = supplierPresentationLimits(supplier);
    const updated = items.map(item => ({ ...item, presentation_limits: limits }));
    for (const item of updated) await tx.objectStore("priceListItems").put(item);
    const changes = await tx.objectStore("priceChanges").index("bySession").getAll(sessionId);
    const catalog = await tx.objectStore("products").index("bySupplier").getAll(session.supplier_id);
    await tx.objectStore("comparisonSessions").put({ ...session, ...comparisonStats(updated, changes, catalog) });
    await finish(); await tx.done;
  } catch (error) { try { tx.abort(); } catch { /* Ya abortada. */ } await tx.done.catch(() => undefined); throw error; }
}
