import { beginUndoAction } from "./undoHistory";
import { getDB } from "./db";
import { buildPrefixCodeIndex, baseCode, sameCodeWithoutPrefix, prefixPresentationConflict } from "./codePrefixes";
import { normalizeCodeForMatch } from "./normalize";
import { priceIssue } from "./pricePolicy";
import { presentationChange } from "./presentationConversions";
import { comparisonStats } from "./comparisonStats";
import type { PriceListItem, Product } from "@/types/database";

/** Resuelve únicamente faltantes por ET- en una comparación ya creada.
 * Una sola transacción, sin reimportar ni reemplazar decisiones anteriores. */
export async function applyPrefixMatches(sessionId: string): Promise<{ linked: number; review: number; linkedProductIds: string[] }> {
  const db = await getDB();
  const tx = db.transaction(["suppliers", "products", "priceListItems", "priceChanges", "equivalences", "discontinuedCodes", "comparisonSessions", "undoHistory"], "readwrite");
  try {
    const session = await tx.objectStore("comparisonSessions").get(sessionId);
    if (!session) throw new Error("La comparación ya no está disponible.");
    const supplier = await tx.objectStore("suppliers").get(session.supplier_id);
    if (supplier?.ignore_et_prefix !== true) throw new Error("Activá la regla ET- para este proveedor antes de aplicarla.");
    const [catalog, items, changes, equivalences, discontinued] = await Promise.all([
      tx.objectStore("products").index("bySupplier").getAll(session.supplier_id),
      tx.objectStore("priceListItems").index("byPriceList").getAll(session.price_list_id),
      tx.objectStore("priceChanges").index("bySession").getAll(session.id),
      tx.objectStore("equivalences").index("bySupplier").getAll(session.supplier_id),
      tx.objectStore("discontinuedCodes").index("bySupplier").getAll(session.supplier_id),
    ]);
    const active = catalog.filter(p => p.active);
    const index = buildPrefixCodeIndex(active);
    const fullCodes = new Set(active.map(p => normalizeCodeForMatch(p.code)));
    const matched = new Set(items.flatMap(i => i.matched_presentations?.map(p => p.product_id) ?? [i.matched_product_id]).filter(Boolean));
    const decidedItems = new Set(changes.map(c => c.price_list_item_id));
    const discontinuedCodes = new Set(discontinued.map(d => d.supplier_code));
    const equivalencesByCode = new Map<string, typeof equivalences>();
    for (const eq of equivalences) {
      const bucket = equivalencesByCode.get(eq.supplier_code);
      if (bucket) bucket.push(eq); else equivalencesByCode.set(eq.supplier_code, [eq]);
    }
    const plans: { item: PriceListItem; product: Product }[] = [];
    let review = 0;
    for (const item of items) {
      if (item.match_state !== "not_found" || item.matched_product_id || item.matched_presentations?.length || decidedItems.has(item.id) || discontinuedCodes.has(item.supplier_code)) continue;
      if (fullCodes.has(normalizeCodeForMatch(item.supplier_code))) continue;
      const eqs = equivalencesByCode.get(item.supplier_code) ?? [];
      const candidates = (index.get(baseCode(item.supplier_code)) ?? []).filter(p => sameCodeWithoutPrefix(p.code, item.supplier_code) && !eqs.some(e => e.product_id === p.id && e.decision === "rejected"));
      if (!candidates.length) continue;
      if (candidates.length !== 1) { review++; continue; }
      const product = candidates[0];
      if (matched.has(product.id) || eqs.some(e => e.decision === "confirmed") || prefixPresentationConflict(product.description, product.unit, item.supplier_description, item.supplier_unit)) { review++; continue; }
      plans.push({ item, product });
    }
    const finishUndo = await beginUndoAction(tx, "Aplicar códigos con/sin ET-", { sessionId: session.id, supplierId: session.supplier_id, itemIds: plans.map(p => p.item.id) });
    const counts = new Map<string, number>();
    for (const { product } of plans) counts.set(product.id, (counts.get(product.id) ?? 0) + 1);
    const updatedItems = new Map(items.map(i => [i.id, i]));
    let linked = 0;
    const linkedProductIds: string[] = [];
    const now = new Date().toISOString();
    for (const { item, product } of plans) {
      // Dos filas del proveedor para el mismo código base requieren elección humana.
      if (counts.get(product.id) !== 1) { review++; continue; }
      const updated: PriceListItem = { ...item, review_reason: "", matched_product_id: product.id, match_level: "code_prefix", match_score: 95, match_state: "safe" };
      await tx.objectStore("priceListItems").put(updated);
      updatedItems.set(item.id, updated);
      if (!priceIssue(updated, product)) {
        const change = presentationChange(product, updated.parsed_price!, { product_id: product.id, supplier_quantity: 1, own_quantity: 1 });
        if (change.diff_absolute !== 0) {
          const record = { ...change, id: crypto.randomUUID(), status: "pending" as const, created_at: now, comparison_session_id: session.id, price_list_item_id: item.id };
          await tx.objectStore("priceChanges").put(record); changes.push(record);
        }
      }
      linked++; linkedProductIds.push(product.id);
    }
    await tx.objectStore("comparisonSessions").put({ ...session, ...comparisonStats([...updatedItems.values()], changes, catalog) });
    await finishUndo();
    await tx.done;
    return { linked, review, linkedProductIds };
  } catch (error) {
    try { tx.abort(); } catch { /* La base puede haber abortado la operación. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
