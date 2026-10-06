import { useEffect, useMemo, useState } from "react";
import { discontinuedCodesRepo, equivalencesRepo, presentationRulesRepo, productsRepo, suppliersRepo } from "@/lib/db";
import type { DiscontinuedCode, Equivalence, PresentationRule, Product, Supplier } from "@/types/database";

type LearnedRow = Equivalence & { product?: Product };
export default function EquivalencesPage() {
  const [tab, setTab] = useState<"equiv" | "rules">("equiv");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [rules, setRules] = useState<PresentationRule[]>([]);
  const [rows, setRows] = useState<LearnedRow[]>([]);
  const [discontinued, setDiscontinued] = useState<DiscontinuedCode[]>([]);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<PresentationRule | "new" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    suppliersRepo.list().then(all => {
      const available = all.filter(s => !s.deleted_at);
      setSuppliers(available); setSupplierId(available[0]?.id ?? "");
    }).catch(e => setError(e.message));
  }, []);
  async function load() {
    if (!supplierId) { setRows([]); setRules([]); setDiscontinued([]); return; }
    setLoading(true); setError("");
    try {
      const [rr, ee, dd, pp] = await Promise.all([
        presentationRulesRepo.listForSupplier(supplierId), equivalencesRepo.listForSupplier(supplierId),
        discontinuedCodesRepo.listForSupplier(supplierId), productsRepo.listBySupplier(supplierId),
      ]);
      const byId = new Map(pp.map(p => [p.id, p]));
      setRules(rr); setRows(ee.filter(e => e.decision === "confirmed").map(e => ({ ...e, product: byId.get(e.product_id) }))); setDiscontinued(dd);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar el diccionario."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [supplierId]);
  const filteredRules = useMemo(() => rules.filter(r => `${r.own_label} ${r.supplier_pattern ?? ""} ${r.own_pattern ?? ""}`.toLowerCase().includes(search.toLowerCase())), [rules, search]);
  const filteredRows = useMemo(() => rows.filter(r => `${r.supplier_code} ${r.product?.code ?? ""} ${r.product?.description ?? ""}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);
  async function mutate(action: () => Promise<unknown>) {
    try { await action(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
  }
  return <div className="mx-auto max-w-5xl">
    <p className="eyebrow">Memoria del sistema</p>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-display text-2xl font-semibold">Diccionario</h1><p className="mt-1 text-sm text-steel-600">Relaciones aprendidas por artículo y reglas generales por proveedor.</p></div>
      {tab === "rules" && <button disabled={!supplierId} onClick={() => setEditor("new")} className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">+ Nueva regla general</button>}
    </div>
    <div className="mb-4 flex flex-wrap gap-1 rounded bg-steel-100 p-1 w-fit">
      <button onClick={() => setTab("equiv")} className={`rounded px-3 py-2 text-sm ${tab === "equiv" ? "bg-white font-semibold" : "text-steel-600"}`}>Relaciones por artículo</button>
      <button onClick={() => setTab("rules")} className={`rounded px-3 py-2 text-sm ${tab === "rules" ? "bg-white font-semibold" : "text-steel-600"}`}>Reglas generales de presentación</button>
    </div>
    <p className="mb-4 rounded bg-info-50 p-3 text-sm text-info-500">
      {tab === "equiv" ? "Estas relaciones se enseñan desde Revisar detalle en una comparación. Las cantidades específicas tienen prioridad sobre las reglas generales. Para cambiar cantidades, abrí el detalle y recalculá." : "Estas reglas convierten precios cuando coinciden ambos patrones de presentación. El factor multiplica el precio del proveedor. Dos reglas con factores distintos para la misma presentación bloquean ese precio."}
    </p>
    <div className="mb-4 flex flex-wrap gap-2">
      <select aria-label="Proveedor del diccionario" value={supplierId} onChange={e => setSupplierId(e.target.value)} className="field-control"><option value="">Seleccionar proveedor</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <input aria-label="Buscar en diccionario" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar código, artículo o presentación…" className="field-control w-full max-w-sm" />
    </div>
    {error && <p role="alert" className="mb-3 rounded bg-danger-50 p-3 text-sm text-danger-500">{error}</p>}
    {loading ? <p>Cargando diccionario…</p> : tab === "equiv" ? <div className="panel overflow-x-auto">
      <table className="w-full text-sm"><thead className="bg-steel-50 text-left text-xs text-steel-600"><tr><th className="p-3">Código proveedor</th><th className="p-3">Artículo propio</th><th className="p-3">Conversión aprendida</th><th className="p-3">Acciones</th></tr></thead>
        <tbody className="divide-y">{filteredRows.map(row => <tr key={row.id}><td className="mono-num p-3">{row.supplier_code}</td><td className="p-3">{row.product ? `${row.product.code} — ${row.product.description}` : "Artículo no disponible"}</td><td className="p-3">{row.supplier_quantity && row.own_quantity ? `x${row.supplier_quantity} → x${row.own_quantity}: dividir por ${Number((row.supplier_quantity / row.own_quantity).toPrecision(8))}` : "Misma presentación, sin conversión"}</td><td className="p-3"><button onClick={() => { if (confirm("¿Olvidar esta relación para próximas listas? Los resultados anteriores se conservan.")) mutate(() => equivalencesRepo.remove(row.id)); }} className="text-danger-500">Olvidar relación</button></td></tr>)}</tbody>
      </table>{!filteredRows.length && <p className="p-6 text-center text-sm text-steel-600">No hay relaciones que coincidan con la búsqueda.</p>}
    </div> : <div className="panel overflow-x-auto">
      <table className="w-full text-sm"><thead className="bg-steel-50 text-left text-xs text-steel-600"><tr><th className="p-3">Proveedor presenta</th><th className="p-3">Yo presento</th><th className="p-3">Multiplicar precio por</th><th className="p-3">Estado</th><th className="p-3">Acciones</th></tr></thead>
        <tbody className="divide-y">{filteredRules.map(rule => <tr key={rule.id}><td className="p-3">{rule.supplier_pattern || "Falta patrón: editar"}</td><td className="p-3">{rule.own_pattern || rule.own_label}</td><td className="mono-num p-3">× {rule.factor}</td><td className="p-3"><button onClick={() => mutate(() => presentationRulesRepo.update(rule.id, { active: !rule.active }))}>{rule.active ? "Activa · desactivar" : "Inactiva · activar"}</button></td><td className="p-3"><div className="flex gap-3"><button onClick={() => setEditor(rule)} className="text-teal-600">Editar</button><button onClick={() => { if (confirm("¿Eliminar esta regla general?")) mutate(() => presentationRulesRepo.remove(rule.id)); }} className="text-danger-500">Eliminar</button></div></td></tr>)}</tbody>
      </table>{!filteredRules.length && <p className="p-6 text-center text-sm text-steel-600">No hay reglas que coincidan con la búsqueda.</p>}
    </div>}
    {!!discontinued.length && <section className="panel mt-5 p-4"><h2 className="font-semibold">Códigos discontinuados</h2><p className="mb-3 text-xs text-steel-600">No se buscan en nuevas listas. Podés volver a habilitarlos.</p>{discontinued.map(row => <div key={row.id} className="flex items-center justify-between py-2 text-sm"><span className="mono-num">{row.supplier_code}</span><button onClick={() => mutate(() => discontinuedCodesRepo.unmark(supplierId, row.supplier_code))} className="text-teal-600">Volver a buscar</button></div>)}</section>}
    {editor && <RuleEditor key={editor === "new" ? "new" : editor.id} supplierId={supplierId} rule={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load(); }} />}
  </div>;
}
function RuleEditor({ supplierId, rule, onClose, onSaved }: { supplierId: string; rule: PresentationRule | null; onClose: () => void; onSaved: () => void }) {
  const [supplierPattern, setSupplierPattern] = useState(rule?.supplier_pattern ?? "");
  const [ownPattern, setOwnPattern] = useState(rule?.own_pattern || rule?.own_label || "");
  const [factor, setFactor] = useState(String(rule?.factor ?? ""));
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  async function save() {
    const number = Number(factor.replace(",", "."));
    if (!supplierPattern.trim() || !ownPattern.trim() || !Number.isFinite(number) || number <= 0) { setError("Completá ambos patrones y un factor positivo."); return; }
    setSaving(true); setError("");
    try {
      const fields = { supplier_id: supplierId, supplier_label: supplierPattern.trim(), supplier_pattern: supplierPattern.trim(), own_label: ownPattern.trim(), own_pattern: ownPattern.trim(), factor: number, active: rule?.active ?? true };
      if (rule) await presentationRulesRepo.update(rule.id, fields); else await presentationRulesRepo.create(fields);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4" onClick={() => { if (!saving) onClose(); }}><div role="dialog" aria-modal="true" aria-label="Regla general de presentación" onClick={e => e.stopPropagation()} className="panel max-h-[90vh] w-full max-w-md overflow-y-auto p-6">
    <h2 className="font-display text-xl font-semibold">{rule ? "Editar regla general" : "Nueva regla general"}</h2><p className="mt-2 text-xs text-steel-600">Ejemplo: proveedor x1000, propio x100, factor 0,1. Se aplica sólo a artículos identificados de este proveedor.</p>
    <div className="mt-4 space-y-3"><label className="block text-sm">Patrón del proveedor<input value={supplierPattern} onChange={e => setSupplierPattern(e.target.value)} placeholder="x1000" className="field-control mt-1 w-full" /></label><label className="block text-sm">Patrón propio<input value={ownPattern} onChange={e => setOwnPattern(e.target.value)} placeholder="x100 o xU" className="field-control mt-1 w-full" /></label><label className="block text-sm">Multiplicar el precio por<input inputMode="decimal" value={factor} onChange={e => setFactor(e.target.value)} placeholder="0,1" className="field-control mt-1 w-full" /></label></div>
    <p className="mt-3 text-xs text-steel-600">Las modificaciones se usan en próximas comparaciones. Las relaciones específicas por artículo conservan su prioridad.</p>
    {error && <p role="alert" className="mt-3 text-sm text-danger-500">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button disabled={saving} onClick={onClose} className="rounded px-3 py-2 text-sm">Cancelar</button><button disabled={saving} onClick={save} className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white">{saving ? "Guardando…" : "Guardar regla"}</button></div>
  </div></div>;
}
