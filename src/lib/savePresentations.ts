import { comparisonStats } from "./comparisonStats";
import { priceIssue } from "./pricePolicy";
import { getDB } from "./db";
import { validateQuantities, presentationChange } from "./presentationConversions";
import type { ComparisonSession, PriceListItem, PresentationConversion } from "@/types/database";

/** Guardar memoria y resultados juntos: ante un error no dejar cambios parciales. */
export async function savePresentations(session: ComparisonSession, item: PriceListItem, conversions: PresentationConversion[]): Promise<void> {
  if (!item.supplier_code.trim() || !conversions.length) throw new Error("Elegí al menos un artículo y un código proveedor válido.");
  const ids = new Set(conversions.map(c => c.product_id));
  if (ids.size !== conversions.length) throw new Error("No repitas un artículo en la misma relación.");
  for (const c of conversions) validateQuantities(c.supplier_quantity, c.own_quantity);
  const db = await getDB();
  const tx = db.transaction(["products", "equivalences", "priceListItems", "priceChanges", "comparisonSessions", "discontinuedCodes"], "readwrite");
  try {
    const currentSession = await tx.objectStore("comparisonSessions").get(session.id);
    const currentItem = await tx.objectStore("priceListItems").get(item.id);
    if (!currentSession || !currentItem || currentSession.price_list_id !== currentItem.price_list_id || currentSession.supplier_id !== session.supplier_id) throw new Error("La comparación ya no está disponible.");
    // Una relación específica enseñada por el usuario resuelve un conflicto de reglas generales.
    const resolvedItem = { ...currentItem, comparison_error: null };
    const products = await Promise.all(conversions.map(c => tx.objectStore("products").get(c.product_id)));
    if (products.some(p => !p || !p.active || p.supplier_id !== session.supplier_id)) throw new Error("Todos los artículos deben estar activos y pertenecer a este proveedor.");
    const changes = products.flatMap((p, index) => priceIssue(resolvedItem, p!) ? [] : [{
      ...presentationChange(p!, currentItem.parsed_price!, conversions[index]),
      status: "pending" as const,
      id: crypto.randomUUID(), created_at: new Date().toISOString(), comparison_session_id: session.id, price_list_item_id: item.id,
    }]);
    const equivalences = await tx.objectStore("equivalences").index("bySupplierCode").getAll([session.supplier_id, currentItem.supplier_code]);
    for (const old of equivalences) {
      if (old.supplier_quantity !== undefined && !ids.has(old.product_id)) await tx.objectStore("equivalences").delete(old.id);
    }
    for (const c of conversions) {
      const old = equivalences.find(e => e.product_id === c.product_id);
      const now = new Date().toISOString();
      await tx.objectStore("equivalences").put({ ...old, ...c, id: old?.id ?? crypto.randomUUID(),
        supplier_id: session.supplier_id, supplier_code: currentItem.supplier_code,
        decision: "confirmed", origin: "manual", confidence: 100, created_at: old?.created_at ?? now, updated_at: now });
    }
    // Una presentación enseñada vuelve a habilitar este código si estaba discontinuado.
    const discontinued = await tx.objectStore("discontinuedCodes").index("bySupplierCode").getAll([session.supplier_id, currentItem.supplier_code]);
    for (const row of discontinued) await tx.objectStore("discontinuedCodes").delete(row.id);
    const oldChanges = await tx.objectStore("priceChanges").index("bySession").getAll(session.id);
    const oldForItem = oldChanges.filter(c => c.price_list_item_id === item.id);
    for (const old of oldForItem) await tx.objectStore("priceChanges").delete(old.id);
    for (const change of changes) await tx.objectStore("priceChanges").put(change);
    await tx.objectStore("priceListItems").put({ ...resolvedItem, matched_presentations: conversions,
      matched_product_id: conversions[0].product_id, match_level: "equivalence", match_score: 100, match_state: "safe" });
    const items = await tx.objectStore("priceListItems").index("byPriceList").getAll(currentItem.price_list_id);
    const allChanges = [...oldChanges.filter(c => c.price_list_item_id !== item.id), ...changes];
    const catalog = await tx.objectStore("products").index("bySupplier").getAll(session.supplier_id);
    await tx.objectStore("comparisonSessions").put({ ...currentSession, ...comparisonStats(items, allChanges, catalog) });
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* La transacción puede haber abortado automáticamente. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
