import { getDB } from "./db";

/** Finalizar conserva resultados y memoria, sin aplicar precios al catálogo de OneSoft. */
export async function closeComparison(sessionId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["comparisonSessions", "products", "undoHistory"], "readwrite");
  try {
    const session = await tx.objectStore("comparisonSessions").get(sessionId);
    if (!session) throw new Error("La comparación ya no existe.");
    if (session.status === "closed") { await tx.done; return; }
    const catalog = session.catalog_snapshot ?? await tx.objectStore("products").index("bySupplier").getAll(session.supplier_id);
    await tx.objectStore("comparisonSessions").put({ ...session, status: "closed", closed_at: new Date().toISOString(), catalog_snapshot: catalog });
    for (const action of await tx.objectStore("undoHistory").getAll()) if (action.session_id === sessionId) await tx.objectStore("undoHistory").delete(action.id);
    await tx.done;
    if (typeof window !== "undefined") window.dispatchEvent(new Event("pricecore:history"));
  } catch (e) { try { tx.abort(); } catch { /* Ya abortada. */ } await tx.done.catch(() => undefined); throw e; }
}
