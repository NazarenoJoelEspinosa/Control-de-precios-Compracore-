import { useEffect, useState } from "react";
import { equivalencesRepo, productsRepo } from "@/lib/db";
import { learnedPresentations, convertPresentationPrice } from "@/lib/presentationConversions";
import { savePresentations } from "@/lib/savePresentations";
import { formatPrice, extractPresentation } from "@/lib/normalize";
import type { ComparisonSession, PriceListItem, Product } from "@/types/database";

type Entry = { productId: string; supplierQuantity: string; ownQuantity: string };
export default function PresentationConversionEditor({ session, item, onResolved, saveLabel = "Guardar relación y dejar precios pendientes", onBusyChange }: {
  session: ComparisonSession; item: PriceListItem; onResolved: () => void | Promise<void>;
  saveLabel?: string; onBusyChange?: (busy: boolean) => void;
}) {
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function quantity(description: string, unit: string) {
    const explicitUnit = extractPresentation("", unit).count;
    const packs = [...description.matchAll(/\bx\s*(\d{1,5})\b/gi)];
    const lastPack = packs.length ? Number(packs[packs.length - 1][1]) : null;
    return String(explicitUnit ?? lastPack ?? extractPresentation(description, unit).count ?? (/^(?:x\s*)?(?:u|un|unidad|unidades)$/i.test(unit.trim()) ? 1 : ""));
  }
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([productsRepo.listBySupplier(session.supplier_id), equivalencesRepo.listForSupplier(session.supplier_id)])
      .then(([products, equivalences]) => {
        if (cancelled) return;
        const active = products.filter(p => p.active);
        const conversions = item.matched_presentations ?? learnedPresentations(equivalences, new Set(active.map(p => p.id))).get(item.supplier_code) ?? [];
        setCatalog(active);
        const matched = active.find(p => p.id === item.matched_product_id);
        const suggested = matched ? active.filter(p => p.code === matched.code)
          : item.match_state === "presentation_diff" ? active.filter(p => item.candidate_product_ids?.includes(p.id)) : [];
        setEntries(conversions.length ? conversions.map(c => ({ productId: c.product_id, supplierQuantity: String(c.supplier_quantity), ownQuantity: String(c.own_quantity) })) : suggested.map(p => ({ productId: p.id, supplierQuantity: quantity(item.supplier_description, item.supplier_unit), ownQuantity: quantity(p.description, p.unit) })));
        setLoading(false);
      }).catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [session.supplier_id, item.id]);
  function update(index: number, field: "supplierQuantity" | "ownQuantity", value: string) {
    setEntries(rows => rows.map((r, i) => field === "supplierQuantity" || i === index ? { ...r, [field]: value } : r));
  }
  function quantityLabel(product: Product | undefined, index: number) {
    if (!product) return String(index);
    return catalog.filter(p => p.code === product.code).length > 1 ? `${product.code} ${product.unit || product.description} (${index + 1})` : product.code;
  }
  async function save() {
    if (saving) return;
    setSaving(true); onBusyChange?.(true); setError("");
    try {
      await savePresentations(session, item, entries.map(e => ({ product_id: e.productId,
        supplier_quantity: Number(e.supplierQuantity), own_quantity: Number(e.ownQuantity) })));
      await onResolved();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setSaving(false); onBusyChange?.(false); }
  }
  const search = query.trim().toLowerCase();
  const candidates = catalog.filter(p => !entries.some(e => e.productId === p.id) &&
    (search ? `${p.code} ${p.description}`.toLowerCase().includes(search) : (p.id === item.matched_product_id || item.candidate_product_ids?.includes(p.id) || p.code === catalog.find(c => c.id === item.matched_product_id)?.code))).slice(0, 20);
  return <div className="space-y-3 rounded border border-teal-500 bg-teal-50 p-3">
    <p className="text-sm font-semibold text-ink">Enseñar mis presentaciones</p>
    <p className="text-xs text-steel-600">Revisá las cantidades de cada presentación. Una fila del proveedor puede corresponder a varios artículos propios. Si la presentación es la misma y el aumento es real, confirmá 1 → 1.</p>
    <p className="text-xs text-steel-600">La cantidad del proveedor es común: cambiarla en una fila actualiza las demás. Cada artículo propio conserva su cantidad.</p>
    <details className="text-xs text-steel-600"><summary className="cursor-pointer">Cómo se calcula y se recuerda</summary><p className="mt-2">Precio proveedor × cantidad propia ÷ cantidad proveedor. Las cantidades detectadas en el texto son un punto de partida. Guardar recuerda la relación para este proveedor y recalcula esta comparación. Los precios quedan pendientes de aprobación. Podés agregar otras presentaciones del mismo artículo.</p></details>
    {loading ? <p className="text-xs">Cargando catálogo…</p> : <>
      {entries.map((entry, index) => {
        const product = catalog.find(p => p.id === entry.productId);
        let preview: number | null = null;
        try { if (item.parsed_price !== null) preview = convertPresentationPrice(item.parsed_price, Number(entry.supplierQuantity), Number(entry.ownQuantity)); } catch { /* Mostrar hasta completar cantidades válidas. */ }
        return <div key={entry.productId} className="space-y-2 rounded bg-white p-2">
          <p className="text-xs font-semibold">{product ? `${product.code} — ${product.description} (${product.unit || "sin unidad"})` : "Artículo ya no disponible: quitá esta relación"}</p>
          <p className="text-xs text-steel-600">Precio original del proveedor: {item.parsed_price !== null ? formatPrice(item.parsed_price, item.supplier_currency ?? product?.currency) : item.raw_price}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs">El precio del proveedor corresponde a<input aria-label={`Cantidad proveedor ${quantityLabel(product, index)}`} disabled={saving} type="number" min="0" step="any" value={entry.supplierQuantity} onChange={e => update(index, "supplierQuantity", e.target.value)} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="text-xs">Mi artículo corresponde a<input aria-label={`Cantidad propia ${quantityLabel(product, index)}`} disabled={saving} type="number" min="0" step="any" value={entry.ownQuantity} onChange={e => update(index, "ownQuantity", e.target.value)} className="mt-1 w-full rounded border px-2 py-1" /></label>
          </div>
          <p className="text-xs text-steel-600">Ingresá cantidades en la misma unidad base. Ejemplo: proveedor 1000 tornillos, mi artículo 100 tornillos.</p>
          <p className="text-sm">Precio para mi presentación: <strong>{preview === null ? "Completá cantidades y un precio válido" : formatPrice(preview, product?.currency)}</strong></p>
          {preview !== null && product && <div className="rounded bg-teal-50 p-2 text-xs">
            <p>Precio anterior de mi artículo: {formatPrice(product.current_price, product.currency)}</p>
            <p className="mt-1 font-semibold">Cambio real: {formatPrice(Math.round((preview - product.current_price) * 100) / 100, product.currency)}{product.current_price > 0 ? ` (${((preview / product.current_price - 1) * 100).toFixed(2)}%)` : ""}</p>
          </div>}
          <button disabled={saving} onClick={() => setEntries(rows => rows.filter((_, i) => i !== index))} className="text-xs text-danger-500">Quitar presentación</button>
        </div>;
      })}
      {catalog.some(p => !entries.some(e => e.productId === p.id) && p.code === catalog.find(c => c.id === item.matched_product_id)?.code) && <button disabled={saving} onClick={() => setEntries(current => {
        const code = catalog.find(p => p.id === item.matched_product_id)?.code;
        return [...current, ...catalog.filter(p => p.code === code && !current.some(e => e.productId === p.id)).map(p => ({ productId: p.id, supplierQuantity: current[0]?.supplierQuantity ?? quantity(item.supplier_description, item.supplier_unit), ownQuantity: quantity(p.description, p.unit) }))];
      })} className="w-full rounded border border-teal-500 px-3 py-2 text-xs font-semibold text-teal-600">Agregar las otras presentaciones de este código</button>}
      <input disabled={saving} value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar mi artículo por código o descripción…" className="w-full rounded border px-2 py-1 text-sm" />
      <div className="max-h-40 overflow-y-auto space-y-1">{candidates.map(p => <button key={p.id} disabled={saving} onClick={() => setEntries(rows => [...rows, { productId: p.id, supplierQuantity: rows[0]?.supplierQuantity ?? quantity(item.supplier_description, item.supplier_unit), ownQuantity: quantity(p.description, p.unit) }])} className="block w-full rounded bg-white p-2 text-left text-xs">+ {p.code} — {p.description} {p.unit && `(${p.unit})`}</button>)}</div>
      {search && candidates.length === 0 && <p className="text-xs">No hay más artículos con ese texto.</p>}
      <div className="sticky bottom-0 bg-teal-50 pt-2"><button disabled={saving || !entries.length || !item.supplier_code.trim()} onClick={save} className="w-full rounded bg-teal-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Guardando…" : saveLabel}</button></div>
    </>}
    {error && <p role="alert" className="text-xs text-danger-500">{error}</p>}
  </div>;
}
