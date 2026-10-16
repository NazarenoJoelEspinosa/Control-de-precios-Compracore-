import { getDB } from "./db";
import { beginUndoAction } from "./undoHistory";
import { validateQuantities } from "./presentationConversions";

/** El diccionario cambia próximas listas; las comparaciones guardan su propia relación. */
export async function editLearnedRelation(id: string, supplierQuantity: number, ownQuantity: number): Promise<void> {
  validateQuantities(supplierQuantity, ownQuantity);
  const db = await getDB();
  const tx = db.transaction(["equivalences", "products", "undoHistory"], "readwrite");
  try {
    const row = await tx.objectStore("equivalences").get(id);
    if (!row || row.decision !== "confirmed") throw new Error("La relación ya no está disponible.");
    const product = await tx.objectStore("products").get(row.product_id);
    if (!product || !product.active || product.supplier_id !== row.supplier_id) throw new Error("El artículo debe estar activo y pertenecer a este proveedor.");
    const finish = await beginUndoAction(tx, `Editar relación ${row.supplier_code}`, { supplierId: row.supplier_id, relationIds: [id] });
    await tx.objectStore("equivalences").put({ ...row, supplier_quantity: supplierQuantity, own_quantity: ownQuantity, updated_at: new Date().toISOString() });
    await finish(); await tx.done;
  } catch (error) { try { tx.abort(); } catch { /* Ya abortada. */ } await tx.done.catch(() => undefined); throw error; }
}
export async function forgetLearnedRelation(id: string): Promise<void> {
  const db = await getDB(); const tx = db.transaction(["equivalences", "undoHistory"], "readwrite");
  try {
    const row = await tx.objectStore("equivalences").get(id); if (!row) throw new Error("La relación ya no existe.");
    const finish = await beginUndoAction(tx, `Olvidar relación ${row.supplier_code}`, { supplierId: row.supplier_id, relationIds: [id] });
    await tx.objectStore("equivalences").delete(id); await finish(); await tx.done;
  } catch (error) { try { tx.abort(); } catch { /* Ya abortada. */ } await tx.done.catch(() => undefined); throw error; }
}
