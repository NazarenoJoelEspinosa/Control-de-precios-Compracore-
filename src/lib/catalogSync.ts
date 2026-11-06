import { getDB, newId, nowISO } from "./db";
import { productVariantKey } from "./productVariants";
import { extractPresentation, normalizeText } from "./normalize";
import type { Product } from "@/types/database";

export type CatalogInput = Omit<Product, "id" | "created_at" | "updated_at" | "supplier_id">;
export type CatalogMode = "complete" | "partial";
/** Índice de la fila nueva → ID anterior elegido explícitamente por el usuario. */
export type CatalogLinks = Record<number, string>;
export function catalogRevision(products: Product[]): string {
  return JSON.stringify([...products].sort((a, b) => a.id.localeCompare(b.id)));
}
export function samePresentation(a: CatalogInput, b: CatalogInput): boolean {
  const signature = (p: CatalogInput) => {
    const presentation = extractPresentation(p.description, p.unit);
    return JSON.stringify([presentation.count, presentation.kind, presentation.measure, normalizeText(p.unit).toLowerCase()]);
  };
  return signature(a) === signature(b);
}
export function planCatalog(existing: Product[], inputs: CatalogInput[], mode: CatalogMode, links: CatalogLinks = {}) {
  const keys = inputs.map(productVariantKey);
  if (new Set(keys).size !== keys.length) throw new Error("Hay filas repetidas de código y presentación. Corregí el archivo antes de guardar.");
  const byKey = new Map<string, Product[]>();
  for (const p of existing) { const key = productVariantKey(p); byKey.set(key, [...(byKey.get(key) ?? []), p]); }
  const used = new Set<string>();
  const rows = inputs.map((input, index) => {
    if (!input.code.trim() || !input.description.trim() || !Number.isFinite(input.current_price)) throw new Error("Revisá códigos, descripciones y precios antes de guardar.");
    const exact = byKey.get(keys[index]) ?? [];
    if (exact.length > 1) throw new Error(`El catálogo anterior tiene duplicados de ${input.code}. Resolvelos antes de renovar.`);
    let previous = exact[0];
    if (links[index]) {
      if (previous) throw new Error("Este artículo ya tiene una coincidencia exacta.");
      previous = existing.find(p => p.id === links[index])!;
      if (!previous || !samePresentation(previous, input)) throw new Error("La presentación cambió o el artículo anterior no existe. Cargalo como nuevo y enseñá su presentación.");
      if (keys.includes(productVariantKey(previous))) throw new Error("El artículo anterior también está en el archivo. No puede vincularse dos veces.");
    }
    if (previous && used.has(previous.id)) throw new Error("Dos filas intentan reemplazar el mismo artículo.");
    if (previous) used.add(previous.id);
    return { input, previous, index };
  });
  return { rows, added: rows.filter(r => !r.previous).length, updated: rows.filter(r => r.previous).length,
    absent: existing.filter(p => p.active && !used.has(p.id)),
    deactivate: mode === "complete" ? existing.filter(p => p.active && !used.has(p.id)) : [] };
}

/** Guarda catálogo y sus bajas juntos; los IDs conservan códigos y cantidades aprendidas. */
export async function syncCatalog(supplierId: string, inputs: CatalogInput[], mode: CatalogMode, links: CatalogLinks, expectedRevision: string) {
  if (!inputs.length) throw new Error("No se puede renovar con una lista vacía.");
  if (mode !== "complete" && mode !== "partial") throw new Error("Elegí lista completa o sublista.");
  const db = await getDB();
  const tx = db.transaction(["products", "suppliers", "comparisonSessions", "undoHistory"], "readwrite");
  try {
    const supplier = await tx.objectStore("suppliers").get(supplierId);
    if (!supplier?.active || supplier.deleted_at) throw new Error("El proveedor debe estar activo y fuera de la papelera.");
    const sessions = await tx.objectStore("comparisonSessions").getAll();
    if (sessions.some(s => s.supplier_id === supplierId && s.status === "open")) throw new Error("Finalizá las comparaciones abiertas de este proveedor antes de renovar su catálogo. Están en Historial.");
    const existing = await tx.objectStore("products").index("bySupplier").getAll(supplierId);
    if (catalogRevision(existing) !== expectedRevision) throw new Error("El catálogo cambió en otra pantalla. Volvé a cargar el archivo para revisar los cambios.");
    const plan = planCatalog(existing, inputs, mode, links), now = nowISO();
    for (const { input, previous } of plan.rows) {
      const product: Product = { ...previous, ...input, id: previous?.id ?? newId(), supplier_id: supplierId,
        active: true, created_at: previous?.created_at ?? now, updated_at: now,
        normalized_code: input.code.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "") };
      await tx.objectStore("products").put(product);
    }
    for (const p of plan.deactivate) await tx.objectStore("products").put({ ...p, active: false, updated_at: now });
    // Las acciones anteriores se calcularon sobre otra versión del catálogo.
    for (const action of await tx.objectStore("undoHistory").getAll()) if (action.supplier_id === supplierId) await tx.objectStore("undoHistory").delete(action.id);
    await tx.done;
    if (typeof window !== "undefined") window.dispatchEvent(new Event("pricecore:history"));
    return plan;
  } catch (error) { try { tx.abort(); } catch { /* Ya abortada. */ } await tx.done.catch(() => undefined); throw error; }
}
