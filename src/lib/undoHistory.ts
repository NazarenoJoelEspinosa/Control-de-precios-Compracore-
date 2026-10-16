import type { IDBPTransaction, StoreNames } from "idb";
import { getDB, type PriceCoreDB } from "./db";
import type { UndoAction, UndoPatch, UndoStore } from "@/types/database";

type Tx = IDBPTransaction<PriceCoreDB, StoreNames<PriceCoreDB>[], "readwrite">;
type Scope = { sessionId?: string; supplierId?: string; itemIds?: string[]; supplierCodes?: string[]; relationIds?: string[]; ruleIds?: string[]; includeSupplier?: boolean };
const stores: UndoStore[] = ["suppliers", "priceListItems", "priceChanges", "equivalences", "discontinuedCodes", "comparisonSessions", "presentationRules"];
type Snapshot = Map<string, { store: UndoStore; id: string; value: unknown }>;
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
}
function signal(name: string) { if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(name)); }
async function snapshot(tx: Tx, scope: Scope): Promise<Snapshot> {
  const result: Snapshot = new Map();
  const add = (store: UndoStore, rows: { id: string }[]) => { for (const row of rows) result.set(`${store}:${row.id}`, { store, id: row.id, value: row }); };
  const items = new Set(scope.itemIds ?? []), codes = new Set(scope.supplierCodes ?? []);
  if (scope.sessionId) {
    const session = await tx.objectStore("comparisonSessions").get(scope.sessionId); if (session) add("comparisonSessions", [session]);
    const changes = await tx.objectStore("priceChanges").index("bySession").getAll(scope.sessionId);
    add("priceChanges", changes.filter(c => items.has(c.price_list_item_id)));
  }
  if (items.size) add("priceListItems", (await Promise.all([...items].map(id => tx.objectStore("priceListItems").get(id)))).filter(Boolean) as { id: string }[]);
  if (codes.size && scope.supplierId) {
    add("equivalences", (await tx.objectStore("equivalences").index("bySupplier").getAll(scope.supplierId)).filter(e => codes.has(e.supplier_code)));
    add("discontinuedCodes", (await tx.objectStore("discontinuedCodes").index("bySupplier").getAll(scope.supplierId)).filter(d => codes.has(d.supplier_code)));
  }
  if (scope.relationIds?.length) add("equivalences", (await Promise.all(scope.relationIds.map(id => tx.objectStore("equivalences").get(id)))).filter(Boolean) as { id: string }[]);
  if (scope.ruleIds?.length) add("presentationRules", (await Promise.all(scope.ruleIds.map(id => tx.objectStore("presentationRules").get(id)))).filter(Boolean) as { id: string }[]);
  if (scope.includeSupplier && scope.supplierId) {
    const supplier = await tx.objectStore("suppliers").get(scope.supplierId); if (supplier) add("suppliers", [supplier]);
  }
  return result;
}

/** Captura sólo registros afectados; historial y operación se confirman juntos. */
export async function beginUndoAction(tx: Tx, label: string, scope: Scope): Promise<() => Promise<void>> {
  const before = await snapshot(tx, scope);
  return async () => {
    const after = await snapshot(tx, scope), patches: UndoPatch[] = [];
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(key), b = after.get(key);
      if (canonical(a?.value ?? null) !== canonical(b?.value ?? null)) patches.push({ store: (a ?? b)!.store, id: (a ?? b)!.id, before: a?.value ?? null, after: b?.value ?? null });
    }
    if (!patches.length) return;
    const history = await tx.objectStore("undoHistory").getAll();
    const record: UndoAction = { id: crypto.randomUUID(), sequence: Math.max(0, ...history.map(h => h.sequence)) + 1, label, session_id: scope.sessionId, supplier_id: scope.supplierId, created_at: new Date().toISOString(), patches };
    await tx.objectStore("undoHistory").put(record);
    for (const old of history.sort((a, b) => b.sequence - a.sequence).slice(19)) await tx.objectStore("undoHistory").delete(old.id);
    void tx.done.then(() => signal("pricecore:history")).catch(() => undefined);
  };
}
export async function latestUndoAction(): Promise<UndoAction | null> {
  const rows = await (await getDB()).getAll("undoHistory");
  return rows.sort((a, b) => b.sequence - a.sequence)[0] ?? null;
}
export async function undoLastAction(expectedId: string): Promise<string> {
  const db = await getDB();
  const tx = db.transaction([...stores, "undoHistory"], "readwrite");
  try {
    const latest = (await tx.objectStore("undoHistory").getAll()).sort((a, b) => b.sequence - a.sequence)[0];
    if (!latest || latest.id !== expectedId) throw new Error("Cambió la última acción. Actualizá la pantalla y revisá cuál querés deshacer.");
    for (const patch of latest.patches) {
      const current = await tx.objectStore(patch.store).get(patch.id);
      if (canonical(current ?? null) !== canonical(patch.after)) throw new Error("Hay cambios posteriores en los datos afectados. No se puede deshacer esta acción sin sobrescribirlos.");
    }
    for (const patch of latest.patches) {
      if (patch.before === null) await tx.objectStore(patch.store).delete(patch.id);
      else await tx.objectStore(patch.store).put(patch.before as never);
    }
    await tx.objectStore("undoHistory").delete(latest.id);
    await tx.done;
    signal("pricecore:history"); signal("pricecore:restored");
    return latest.label;
  } catch (error) {
    try { tx.abort(); } catch { /* Ya abortada. */ }
    await tx.done.catch(() => undefined); throw error;
  }
}
