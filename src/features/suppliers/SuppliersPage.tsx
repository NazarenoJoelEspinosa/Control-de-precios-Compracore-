import React, { useEffect, useMemo, useState, type FormEvent } from "react";
import { productsRepo, suppliersRepo } from "@/lib/db";
import type { Supplier } from "@/types/database";

const emptySupplier = {
  name: "", code: "", email: "", phone: "", active: true,
  price_includes_vat: false, vat_rate: 21, default_currency: "ARS" as const,
  notes: "", categories: [] as string[], conditions: "",
};

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() { setLoading(true); setSuppliers(await suppliersRepo.list()); setLoading(false); }
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => suppliers
    .filter(s => showTrash ? Boolean(s.deleted_at) : !s.deleted_at)
    .filter(s => !search || `${s.name} ${s.code} ${s.email} ${s.phone}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => a.name.localeCompare(b.name)), [suppliers, search, showTrash]);

  async function archive(s: Supplier) {
    if (!window.confirm(`¿Enviar "${s.name}" a la papelera? Su historial y catálogo se conservarán.`)) return;
    await suppliersRepo.archive(s.id); await load();
  }
  async function restore(s: Supplier) { await suppliersRepo.restore(s.id); await load(); }

  return <div className="mx-auto max-w-5xl">
    <div className="mb-6 flex items-center justify-between gap-4">
      <div><p className="eyebrow">Organización</p><h1 className="font-display text-2xl font-semibold text-ink">Proveedores</h1><p className="mt-1 text-sm text-steel-600">Cada proveedor es una carpeta: catálogo, notas, columnas y reglas viven juntos.</p></div>
      <button onClick={() => setCreating(true)} className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600">+ Nuevo proveedor</button>
    </div>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar proveedor..." className="w-full max-w-sm rounded border border-steel-200 bg-white px-3 py-2 text-sm focus:border-teal-500" />
      <button onClick={()=>setShowTrash(v=>!v)} className={`rounded border px-3 py-2 text-sm ${showTrash ? "border-amber-400 bg-amber-50 text-amber-700" : "border-steel-200 text-steel-600 hover:bg-steel-50"}`}>{showTrash ? "← Proveedores activos" : "🗑 Papelera"}</button>
    </div>
    {loading ? <p className="text-sm text-steel-600">Cargando...</p> : visible.length === 0 ? <div className="panel p-8 text-center text-sm text-steel-600">{showTrash ? "La papelera está vacía." : "Todavía no cargaste proveedores."}</div> :
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map(s => <SupplierCard key={s.id} supplier={s} onEdit={()=>setEditing(s)} onArchive={()=>archive(s)} onRestore={()=>restore(s)} />)}
      </div>}
    {(creating || editing) && <SupplierEditor supplier={editing} onClose={()=>{setCreating(false);setEditing(null)}} onSaved={()=>{setCreating(false);setEditing(null);load()}} />}
  </div>;
}

function SupplierCard({ supplier:s, onEdit, onArchive, onRestore }: { supplier:Supplier; onEdit:()=>void; onArchive:()=>void; onRestore:()=>void }) {
  const [count,setCount]=useState<number | null>(null);
  useEffect(()=>{ productsRepo.listBySupplier(s.id).then(p=>setCount(p.length)); },[s.id]);
  return <div className="panel p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><span className="text-xl">📁</span><h2 className="font-display text-base font-semibold text-ink">{s.name}</h2></div><p className="mt-1 text-xs text-steel-500">{count ?? "…"} productos · {s.default_currency}</p></div>
      <span className={`rounded-full px-2 py-1 text-[11px] ${s.deleted_at ? "bg-steel-100 text-steel-500" : s.active ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"}`}>{s.deleted_at ? "Papelera" : s.active ? "Activo" : "Inactivo"}</span>
    </div>
    <div className="mt-3 flex flex-wrap gap-1">{(s.categories ?? []).slice(0,4).map(c=><span key={c} className="rounded bg-steel-50 px-2 py-1 text-[11px] text-steel-600">{c}</span>)}</div>
    <div className="mt-4 flex items-center justify-between border-t border-steel-100 pt-3"><span className="text-xs text-steel-500">{s.email || s.phone ? `${s.email ? "Mail" : "Teléfono"}${s.email && s.phone ? " · Teléfono" : ""}` : "Sin contacto cargado"}</span><div className="flex gap-3"><button onClick={onEdit} className="text-xs font-medium text-teal-600 hover:underline">Editar</button>{s.deleted_at ? <button onClick={onRestore} className="text-xs text-teal-600 hover:underline">Restaurar</button> : <button onClick={onArchive} className="text-xs text-danger-500 hover:underline">Papelera</button>}</div></div>
  </div>;
}

function SupplierEditor({ supplier, onClose, onSaved }: { supplier:Supplier|null; onClose:()=>void; onSaved:()=>void }) {
  const [form,setForm]=useState(supplier ? {...emptySupplier,...supplier,categories:supplier.categories ?? []} : emptySupplier);
  const [categoryText,setCategoryText]=useState((supplier?.categories ?? []).join(", "));
  const [saving,setSaving]=useState(false); const [error,setError]=useState<string|null>(null);
  function set<K extends keyof typeof form>(key:K,value:(typeof form)[K]){setForm(f=>({...f,[key]:value}));}
  async function submit(e:FormEvent){e.preventDefault(); if(!form.name.trim()) return; setSaving(true); setError(null); try { const payload={...form,name:form.name.trim(),categories:categoryText.split(",").map(x=>x.trim()).filter(Boolean)}; if(supplier) await suppliersRepo.update(supplier.id,payload); else await suppliersRepo.create(payload); onSaved(); } catch(e){setError(e instanceof Error?e.message:"No se pudo guardar.")} finally{setSaving(false)} }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4" onClick={onClose}><form onSubmit={submit} onClick={e=>e.stopPropagation()} className="panel max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
    <div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">{supplier ? "Editar proveedor" : "Nuevo proveedor"}</p><h2 className="font-display text-xl font-semibold text-ink">{form.name || "Proveedor"}</h2></div><button type="button" onClick={onClose} className="text-xl text-steel-400">×</button></div>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Nombre"><input required value={form.name} onChange={e=>set("name",e.target.value)} /></Field>
      <Field label="Código interno"><input value={form.code} onChange={e=>set("code",e.target.value)} /></Field>
      <Field label="Teléfono / WhatsApp"><input value={form.phone} onChange={e=>set("phone",e.target.value)} /></Field>
      <Field label="Email"><input type="email" value={form.email} onChange={e=>set("email",e.target.value)} /></Field>
      <Field label="Moneda"><select value={form.default_currency} onChange={e=>set("default_currency",e.target.value as "ARS"|"USD")}><option value="ARS">ARS</option><option value="USD">USD</option></select></Field>
      <Field label="Categorías (separadas por coma)"><input value={categoryText} onChange={e=>setCategoryText(e.target.value)} placeholder="Herramientas, abrasivos..." /></Field>
    </div>
    <div className="mt-4"><Field label="Condiciones / descuentos"><textarea rows={4} value={form.conditions ?? ""} onChange={e=>set("conditions",e.target.value)} placeholder="Descuentos por marca, condiciones de pago, mínimos..." /></Field></div>
    <div className="mt-4"><Field label="Notas"><textarea rows={6} value={form.notes} onChange={e=>set("notes",e.target.value)} placeholder="Contacto, IVA por artículo, teléfonos, observaciones, cualquier cosa que quieras recordar..." /></Field></div>
    <div className="mt-4 flex flex-wrap gap-5 rounded border border-steel-100 bg-steel-50 p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e=>set("active",e.target.checked)} /> Proveedor activo</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.price_includes_vat} onChange={e=>set("price_includes_vat",e.target.checked)} /> Precio incluye IVA</label><label className="flex items-center gap-2 text-sm"><span>Alícuota</span><input type="number" step="0.5" className="w-20" value={form.vat_rate} onChange={e=>set("vat_rate",Number(e.target.value))}/>%</label></div>
    {error && <p className="mt-3 text-sm text-danger-500">{error}</p>}
    <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm text-steel-600 hover:bg-steel-50">Cancelar</button><button disabled={saving} className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Guardando..." : "Guardar cambios"}</button></div>
  </form></div>;
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div><label className="mb-1 block text-xs font-semibold text-steel-700">{label}</label>{React.cloneElement(children as React.ReactElement,{className:"w-full rounded border border-steel-200 bg-white px-3 py-2 text-sm focus:border-teal-500 " + ((children as React.ReactElement).props.className ?? "")})}</div>}
