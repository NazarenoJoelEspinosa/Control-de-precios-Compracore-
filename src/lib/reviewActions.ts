import { getDB } from "./db";
import { comparisonStats } from "./comparisonStats";
import { priceIssue } from "./pricePolicy";
import { presentationChange } from "./presentationConversions";
import type { ComparisonSession, PriceListItem } from "@/types/database";

/** Confirmar identidad no aprueba el precio: éste queda pendiente de revisión. */
export async function confirmMatch(session: ComparisonSession, item: PriceListItem, productId: string): Promise<void> {
  await resolve(session, item, "confirm", productId);
}
export async function rejectSuggestion(session: ComparisonSession, item: PriceListItem): Promise<void> {
  await resolve(session, item, "reject");
}
export async function markDiscontinued(session: ComparisonSession, item: PriceListItem): Promise<void> {
  await resolve(session, item, "discontinue");
}

async function resolve(session: ComparisonSession, item: PriceListItem, action: "confirm" | "reject" | "discontinue", productId?: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["products", "priceListItems", "priceChanges", "equivalences", "discontinuedCodes", "comparisonSessions"], "readwrite");
  try {
    const currentSession = await tx.objectStore("comparisonSessions").get(session.id);
    const current = await tx.objectStore("priceListItems").get(item.id);
    if (!currentSession || !current || currentSession.price_list_id !== current.price_list_id) throw new Error("La comparación ya no está disponible.");
    const catalog = await tx.objectStore("products").index("bySupplier").getAll(currentSession.supplier_id);
    const product = productId ? catalog.find(p => p.id === productId && p.active) : null;
    if (action === "confirm" && !product) throw new Error("El artículo debe estar activo y pertenecer a este proveedor.");
    const now = new Date().toISOString();
    const equivalences = await tx.objectStore("equivalences").index("bySupplierCode").getAll([currentSession.supplier_id, current.supplier_code]);
    const targetId = productId ?? current.matched_product_id;
    if (targetId && action !== "discontinue") {
      const old = equivalences.find(e => e.product_id === targetId);
      await tx.objectStore("equivalences").put({ ...old, supplier_quantity: undefined, own_quantity: undefined,
        id: old?.id ?? crypto.randomUUID(), supplier_id: currentSession.supplier_id, supplier_code: current.supplier_code,
        product_id: targetId, decision: action === "confirm" ? "confirmed" : "rejected", origin: "manual",
        confidence: action === "confirm" ? 100 : null, created_at: old?.created_at ?? now, updated_at: now });
    }
    if (action === "discontinue") {
      const old = await tx.objectStore("discontinuedCodes").index("bySupplierCode").getAll([currentSession.supplier_id, current.supplier_code]);
      if (!old.length) await tx.objectStore("discontinuedCodes").put({ id: crypto.randomUUID(), supplier_id: currentSession.supplier_id, supplier_code: current.supplier_code, created_at: now });
    }
    const updated: PriceListItem = { ...current, matched_presentations: action === "confirm" && current.matched_product_id === productId ? current.matched_presentations : undefined,
      matched_product_id: product?.id ?? null, match_state: action === "confirm" ? "safe" : action === "reject" ? "not_found" : "discontinued",
      match_level: action === "confirm" ? "equivalence" : "none", match_score: action === "confirm" ? 100 : null };
    await tx.objectStore("priceListItems").put(updated);
    const allChanges = await tx.objectStore("priceChanges").index("bySession").getAll(session.id);
    const kept = allChanges.filter(c => c.price_list_item_id !== item.id);
    for (const change of allChanges) if (change.price_list_item_id === item.id) await tx.objectStore("priceChanges").delete(change.id);
    if (product && !priceIssue(updated, product)) {
      const change = presentationChange(product, current.parsed_price!, updated.matched_presentations?.find(c => c.product_id === product.id) ?? { product_id: product.id, supplier_quantity: 1, own_quantity: 1 });
      if (change.diff_absolute !== 0) {
        const record = { ...change, status: "pending" as const, id: crypto.randomUUID(), created_at: now,
          comparison_session_id: session.id, price_list_item_id: item.id };
        await tx.objectStore("priceChanges").put(record); kept.push(record);
      }
    }
    const items = await tx.objectStore("priceListItems").index("byPriceList").getAll(current.price_list_id);
    await tx.objectStore("comparisonSessions").put({ ...currentSession, ...comparisonStats(items, kept, catalog) });
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* Ya abortada por IndexedDB. */ }
    await tx.done.catch(() => undefined); throw error;
  }
}

/** Decidir un lote en una transacción evita recorridos completos por cada fila. */
export async function decidePriceChange(changeId: string, status: "approved" | "rejected"): Promise<void> {
  await decidePriceChanges([changeId], status);
}
export async function decidePriceChanges(changeIds: string[], status: "approved" | "rejected"): Promise<void> {
  if (!changeIds.length) return;
  const db = await getDB();
  const tx = db.transaction(["products", "priceListItems", "priceChanges", "comparisonSessions"], "readwrite");
  try {
    const selected = await Promise.all([...new Set(changeIds)].map(id => tx.objectStore("priceChanges").get(id)));
    if (selected.some(c => !c)) throw new Error("Algún cambio ya no existe.");
    const sessionIds = new Set(selected.map(c => c!.comparison_session_id));
    if (sessionIds.size !== 1) throw new Error("Elegí cambios de una sola comparación.");
    const session = await tx.objectStore("comparisonSessions").get(selected[0]!.comparison_session_id);
    if (!session) throw new Error("La comparación ya no existe.");
    const [items, products] = await Promise.all([
      tx.objectStore("priceListItems").index("byPriceList").getAll(session.price_list_id),
      tx.objectStore("products").index("bySupplier").getAll(session.supplier_id),
    ]);
    const byId = new Map(items.map(i => [i.id, i]));
    const productsById = new Map(products.map(p => [p.id, p]));
    for (const record of selected) {
      const change = record!;
      const item = byId.get(change.price_list_item_id), product = productsById.get(change.product_id);
      if (!item || !product) throw new Error("No se pudo recuperar el artículo.");
      if (status === "approved" && (priceIssue(item, product) || change.old_currency !== change.new_currency || !Number.isFinite(change.final_new_price ?? change.new_price))) {
        throw new Error("Corregí el precio o la moneda antes de aprobar.");
      }
      await tx.objectStore("priceChanges").put({ ...change, status, decided_at: new Date().toISOString() });
    }
    const changes = await tx.objectStore("priceChanges").index("bySession").getAll(session.id);
    await tx.objectStore("comparisonSessions").put({ ...session, ...comparisonStats(items, changes, products) });
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* Ya abortada. */ }
    await tx.done.catch(() => undefined); throw error;
  }
}
