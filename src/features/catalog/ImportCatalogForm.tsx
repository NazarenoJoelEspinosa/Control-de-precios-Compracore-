import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { comparisonSessionsRepo, productsRepo, suppliersRepo } from "@/lib/db";
import { prepareCatalogImport } from "@/lib/catalogImport";
import { catalogRevision, planCatalog, samePresentation, syncCatalog, type CatalogLinks, type CatalogMode } from "@/lib/catalogSync";
import { productVariantKey } from "@/lib/productVariants";
import { parseSpreadsheetFile, type ParsedFile } from "@/lib/fileParsing";
import { suggestColumnMapping, type ColumnMapping } from "@/lib/columnMapping";
import type { Product } from "@/types/database";

export default function ImportCatalogForm({ supplierId, onDone }: { supplierId: string; onDone: () => void }) {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [existing, setExisting] = useState<Product[]>([]);
  const [revision, setRevision] = useState<string | null>(null);
  const [mode, setMode] = useState<CatalogMode | "">("");
  const [links, setLinks] = useState<CatalogLinks>({});
  const [currency, setCurrency] = useState<"ARS" | "USD">("ARS");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openSessions, setOpenSessions] = useState<string[]>([]);
  useEffect(() => {
    Promise.all([suppliersRepo.get(supplierId), comparisonSessionsRepo.list()]).then(([s, sessions]) => {
      setCurrency(s?.default_currency ?? "ARS");
      setOpenSessions(sessions.filter(s => s.supplier_id === supplierId && s.status === "open").map(s => s.id));
    }).catch(e => setError(e.message));
  }, [supplierId]);

  const prepared = useMemo(() => prepareCatalogImport(parsed?.rows ?? [], mapping, currency), [parsed, mapping, currency]);
  const preview = useMemo(() => {
    if (!mode || !prepared.products.length) return null;
    try { return { plan: planCatalog(existing, prepared.products, mode, links), error: "" }; }
    catch (e) { return { plan: null, error: e instanceof Error ? e.message : "Revisá el archivo." }; }
  }, [existing, prepared.products, mode, links]);
  const inputKeys = new Set(prepared.products.map(productVariantKey));
  const possiblePrevious = existing.filter(p => !inputKeys.has(productVariantKey(p)));

  async function read(file: File) {
    setBusy(true); setError(""); setParsed(null); setRevision(null); setLinks({});
    try {
      const [data, products] = await Promise.all([parseSpreadsheetFile(file), productsRepo.listBySupplier(supplierId)]);
      setExisting(products); setRevision(catalogRevision(products)); setParsed(data); setMapping(suggestColumnMapping(data.headers));
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo leer el archivo."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!mode || !preview?.plan || !revision || prepared.errors.length) return;
    const plan = preview.plan;
    if (!window.confirm(`¿Guardar ${prepared.products.length} artículos? ${plan.added} nuevos, ${plan.updated} actualizados y ${plan.deactivate.length} ausentes que dejarán de participar. Se conservan las equivalencias y las cantidades de los artículos reconocidos o vinculados.`)) return;
    setBusy(true); setError("");
    try { await syncCatalog(supplierId, prepared.products, mode, links, revision); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo renovar el catálogo."); }
    finally { setBusy(false); }
  }
  if (openSessions.length) return <div className="panel space-y-3 p-5"><p>Finalizá las comparaciones abiertas de este proveedor antes de cargar otra exportación de OneSoft.</p>{openSessions.map(id => <Link className="block text-teal-600 underline" key={id} to={`/comparisons/${id}`}>Abrir comparación pendiente</Link>)}</div>;
  return <div className="panel space-y-4 p-5">
    <p className="text-sm text-steel-600">Cargá tu exportación actual de OneSoft. Revisá los cambios antes de guardar; lo aprendido se conserva por proveedor.</p>
    {error && <p role="alert" className="text-sm text-danger-500">{error}</p>}
    <fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm font-semibold">Archivo de OneSoft<input className="mt-2 block w-full text-sm" type="file" accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) void read(f); }}/></label>
      <fieldset className="space-y-2 text-sm"><legend className="mb-2 font-semibold">¿Qué contiene esta exportación?</legend>
        <label className="block"><input type="radio" name={`catalog-mode-${supplierId}`} checked={mode === "complete"} onChange={() => setMode("complete")}/> Lista completa del proveedor: los ausentes dejan de participar.</label>
        <label className="block"><input type="radio" name={`catalog-mode-${supplierId}`} checked={mode === "partial"} onChange={() => setMode("partial")}/> Sublista: se actualizan estos artículos y se mantienen los demás.</label>
      </fieldset>
      {parsed && <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{(["code", "description", "price", "unit", "currency"] as const).map(field => <label key={field} className="text-xs">{{ code: "Código *", description: "Descripción *", price: "Precio *", unit: "Unidad", currency: "Moneda" }[field]}<select className="field-control mt-1 w-full" value={mapping[field] ?? ""} onChange={e => { setMapping({ ...mapping, [field]: e.target.value || undefined }); setLinks({}); }}><option value="">— Elegir columna —</option>{parsed.headers.map(h => <option key={h} value={h}>{h}</option>)}</select></label>)}</div>
        <p className="text-sm">{prepared.products.length} artículos válidos · {prepared.skipped} filas sin código omitidas · {prepared.errors.length} errores</p>
        {prepared.errors.length > 0 && <div role="alert" className="max-h-40 overflow-auto text-xs text-danger-500">{prepared.errors.map((e, i) => <p key={i}>{e}</p>)}</div>}
        {preview?.error && <p role="alert" className="text-sm text-danger-500">{preview.error}</p>}
        {preview?.plan && <>
          <p className="rounded bg-steel-50 p-3 text-sm">{preview.plan.added} nuevos · {preview.plan.updated} actualizados · {preview.plan.absent.length} anteriores ausentes{mode === "partial" ? " (se mantienen activos)" : " (se conservan fuera de las comparaciones nuevas)"}</p>
          {possiblePrevious.length > 0 && preview.plan.rows.some(r => !r.previous || links[r.index]) && <div className="space-y-3"><p className="text-sm font-semibold">Artículos nuevos y posibles cambios de código</p><p className="text-xs text-steel-600">Si es el mismo artículo con otro código o descripción, elegí el anterior para conservar lo aprendido. No se vinculan automáticamente ni se mezclan presentaciones distintas.</p>
            <div className="max-h-80 space-y-3 overflow-auto">{preview.plan.rows.filter(r => !r.previous || links[r.index]).map(r => <label key={r.index} className="block rounded border border-steel-100 p-3 text-sm"><span className="block font-semibold">{r.input.code} · {r.input.description} · {r.input.unit}</span><select aria-label={`Artículo anterior para ${r.input.code}, fila ${r.index + 1}`} className="field-control mt-2 w-full" value={links[r.index] ?? ""} onChange={e => { const next = { ...links }; if (e.target.value) next[r.index] = e.target.value; else delete next[r.index]; setLinks(next); }}><option value="">Es un artículo nuevo; no trasladar memoria</option>{possiblePrevious.filter(p => samePresentation(p, r.input) && (!Object.entries(links).some(([i, id]) => Number(i) !== r.index && id === p.id))).map(p => <option key={p.id} value={p.id}>{p.code} · {p.description} · {p.unit}{p.active ? "" : " (anterior inactivo)"}</option>)}</select></label>)}</div>
          </div>}
          {preview.plan.absent.length > 0 && <details className="text-sm"><summary>Ver artículos anteriores ausentes</summary><div className="mt-2 max-h-40 overflow-auto">{preview.plan.absent.map(p => <p key={p.id}>{p.code} · {p.description} · {p.unit}</p>)}</div></details>}
        </>}
      </>}
      <button className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={!preview?.plan || prepared.errors.length > 0 || revision === null} onClick={() => void save()}>{busy ? "Procesando…" : "Guardar catálogo actual"}</button>
    </fieldset>
  </div>;
}
