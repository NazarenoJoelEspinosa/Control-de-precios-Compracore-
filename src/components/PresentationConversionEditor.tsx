import { useEffect, useState } from "react";
import { equivalencesRepo, productsRepo } from "@/lib/db";
import { learnedPresentations, convertPresentationPrice } from "@/lib/presentationConversions";
import { savePresentations } from "@/lib/savePresentations";
import { formatPrice } from "@/lib/normalize";
import type { ComparisonSession, PriceListItem, Product } from "@/types/database";

type Entry = { productId: string; supplierQuantity: string; ownQuantity: string };
export default function PresentationConversionEditor({ session, item, onResolved }: {
  session: ComparisonSession; item: PriceListItem; onResolved: () => void;
}) {
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([productsRepo.listBySupplier(session.supplier_id), equivalencesRepo.listForSupplier(session.supplier_id)])
      .then(([products, equivalences]) => {
        if (cancelled) return;
        const active = products.filter(p => p.active);
        const conversions = item.matched_presentations ?? learnedPresentations(equivalences, new Set(active.map(p => p.id))).get(item.supplier_code) ?? [];
        setCatalog(active);
        setEntries(conversions.map(c => ({ productId: c.product_id, supplierQuantity: String(c.supplier_quantity), ownQuantity: String(c.own_quantity) })));
        setLoading(false);
      }).catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [session.supplier_id, item.id]);
  function update(index: number, field: "supplierQuantity" | "ownQuantity", value: string) {
    setEntries(rows => rows.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }
  async function save() {
    setSaving(true); setError("");
    try {
      await savePresentations(session, item, entries.map(e => ({ product_id: e.productId,
        supplier_quantity: Number(e.supplierQuantity), own_quantity: Number(e.ownQuantity) })));
      onResolved();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  }
  const search = query.trim().toLowerCase();
  const candidates = catalog.filter(p => !entries.some(e => e.productId === p.id) &&
    (search ? `${p.code} ${p.description}`.toLowerCase().includes(search) : p.id === item.matched_product_id)).slice(0, 20);
  return <div className="space-y-3 rounded border border-teal-500 bg-teal-50 p-3">
    <p className="text-sm font-semibold text-ink">Enseñar mis presentaciones</p>
    <p className="text-xs text-steel-600">Agregá cada artículo propio que corresponde a este código del proveedor. Ejemplo: caja x1000 → x100, x10 y xU (1).</p>
    <p className="text-xs text-steel-600">Precio proveedor × cantidad propia ÷ cantidad proveedor. Guardar recuerda la relación y recalcula esta comparación. Los precios quedan pendientes de aprobación.</p>
    {loading ? <p className="text-xs">Cargando catálogo…</p> : <>
      {entries.map((entry, index) => {
        const product = catalog.find(p => p.id === entry.productId);
        let preview: number | null = null;
        try { if (item.parsed_price !== null) preview = convertPresentationPrice(item.parsed_price, Number(entry.supplierQuantity), Number(entry.ownQuantity)); } catch { /* Mostrar hasta completar cantidades válidas. */ }
        return <div key={entry.productId} className="space-y-2 rounded bg-white p-2">
          <p className="text-xs font-semibold">{product ? `${product.code} — ${product.description}` : "Artículo ya no disponible: quitá esta relación"}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">Cantidad proveedor<input aria-label={`Cantidad proveedor ${product?.code ?? index}`} disabled={saving} type="number" min="0" step="any" value={entry.supplierQuantity} onChange={e => update(index, "supplierQuantity", e.target.value)} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="text-xs">Cantidad en mi sistema<input aria-label={`Cantidad propia ${product?.code ?? index}`} disabled={saving} type="number" min="0" step="any" value={entry.ownQuantity} onChange={e => update(index, "ownQuantity", e.target.value)} className="mt-1 w-full rounded border px-2 py-1" /></label>
          </div>
          <p className="text-xs">Precio para mi presentación: <strong>{preview === null ? "Completá cantidades y un precio válido" : formatPrice(preview, product?.currency)}</strong></p>
          <button disabled={saving} onClick={() => setEntries(rows => rows.filter((_, i) => i !== index))} className="text-xs text-danger-500">Quitar presentación</button>
        </div>;
      })}
      <input disabled={saving} value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar mi artículo por código o descripción…" className="w-full rounded border px-2 py-1 text-sm" />
      <div className="max-h-40 overflow-y-auto space-y-1">{candidates.map(p => <button key={p.id} disabled={saving} onClick={() => setEntries(rows => [...rows, { productId: p.id, supplierQuantity: rows[0]?.supplierQuantity ?? "", ownQuantity: "" }])} className="block w-full rounded bg-white p-2 text-left text-xs">+ {p.code} — {p.description} {p.unit && `(${p.unit})`}</button>)}</div>
      {search && candidates.length === 0 && <p className="text-xs">No hay más artículos con ese texto.</p>}
      <button disabled={saving || !entries.length || !item.supplier_code.trim()} onClick={save} className="w-full rounded bg-teal-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar relación y dejar precios pendientes"}</button>
    </>}
    {error && <p role="alert" className="text-xs text-danger-500">{error}</p>}
  </div>;
}
