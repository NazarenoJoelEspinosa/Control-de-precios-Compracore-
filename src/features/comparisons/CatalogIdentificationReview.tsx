import { useEffect, useMemo, useState } from "react";
import { selectCatalogCandidates } from "@/lib/catalogMatching";
import { confirmMatch } from "@/lib/reviewActions";
import { settingsRepo } from "@/lib/db";
import { formatPrice, extractPresentation, normalizeCodeForMatch } from "@/lib/normalize";
import { sameCodeWithoutPrefix } from "@/lib/codePrefixes";
import PresentationConversionEditor from "@/components/PresentationConversionEditor";
import type { ComparisonSession, DiscontinuedCode, Equivalence, PriceListItem, Product } from "@/types/database";

export default function CatalogIdentificationReview({ session, products, items, equivalences, discontinued, ignoreEtPrefix = false, initialProductId, onRefresh, onClose }: {
  session: ComparisonSession; products: Product[]; items: PriceListItem[]; equivalences: Equivalence[];
  discontinued: DiscontinuedCode[]; ignoreEtPrefix?: boolean; initialProductId?: string;
  onRefresh: () => Promise<void>; onClose: () => void;
}) {
  const key = `pricecore:catalog-identification:${session.id}`;
  const [progress, setProgress] = useState<{ activeId: string; deferred: string[] }>(() => {
    try { const p = JSON.parse(localStorage.getItem(key) ?? "null"); return { activeId: initialProductId ?? (typeof p?.activeId === "string" ? p.activeId : ""), deferred: Array.isArray(p?.deferred) ? p.deferred.filter((x: unknown) => typeof x === "string") : [] }; }
    catch { return { activeId: initialProductId ?? "", deferred: [] }; }
  });
  const [query, setQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [showDeferred, setShowDeferred] = useState(() => progress.deferred.includes(progress.activeId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState(session.catalog_candidates ?? {});
  const [loading, setLoading] = useState(false);
  const [teaching, setTeaching] = useState<PriceListItem | null>(null);
  const [limit, setLimit] = useState(20);
  const visible = products.filter(p => progress.deferred.includes(p.id) === showDeferred && `${p.code} ${p.description}`.toLowerCase().includes(catalogQuery.toLowerCase().trim()));
  const active = visible.find(p => p.id === progress.activeId) ?? visible[0];
  const index = visible.findIndex(p => p.id === active?.id);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(progress)); } catch { /* La revisión sigue disponible. */ } }, [key, progress]);
  useEffect(() => { setQuery(""); setLimit(20); setTeaching(null); setError(""); }, [active?.id]);
  useEffect(() => {
    let cancelled = false;
    let worker: Worker | undefined;
    if (!products.length) return;
    setLoading(true);
    settingsRepo.get().then(settings => {
      if (cancelled) return;
      const payload = { mode: "candidates", products, items, equivalences, discontinued: new Set(discontinued.map(d => d.supplier_code)), options: {
        ignorePrefix: ignoreEtPrefix, maxCandidates: settings.max_candidates ?? 250, safeMin: settings.safe_min, reviewMin: settings.review_min,
        enableDescription: settings.enable_description !== false, enableCodeFamily: settings.enable_code_family !== false,
      } };
      if (typeof Worker === "undefined") { setSuggestions(selectCatalogCandidates(products, items, equivalences, payload.discontinued, payload.options).candidatesByProduct); setLoading(false); return; }
      worker = new Worker(new URL("../../lib/matching.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = e => { if (!cancelled) { setSuggestions(e.data.candidatesByProduct); setLoading(false); } worker?.terminate(); };
      worker.onerror = () => { if (!cancelled) { setLoading(false); setError("No se pudieron calcular las sugerencias. Podés buscar manualmente en la lista del proveedor."); } worker?.terminate(); };
      worker.postMessage(payload);
    }).catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; worker?.terminate(); };
  }, [products, items, equivalences, discontinued, ignoreEtPrefix]);
  const candidates = useMemo(() => {
    if (!active) return [];
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const ids = suggestions[active.id] ?? [];
    const rejected = new Set(equivalences.filter(e => e.product_id === active.id && e.decision === "rejected").map(e => e.supplier_code));
    const excluded = new Set(discontinued.map(d => d.supplier_code));
    return items.filter(item => !excluded.has(item.supplier_code) && !rejected.has(item.supplier_code) && (terms.length
      ? terms.every(term => `${item.supplier_code} ${item.supplier_description}`.toLowerCase().includes(term)) || normalizeCodeForMatch(query) === normalizeCodeForMatch(item.supplier_code) || (ignoreEtPrefix && sameCodeWithoutPrefix(query, item.supplier_code))
      : ids.includes(item.id))).sort((a, b) => (ids.indexOf(a.id) < 0 ? Infinity : ids.indexOf(a.id)) - (ids.indexOf(b.id) < 0 ? Infinity : ids.indexOf(b.id)) || a.supplier_description.localeCompare(b.supplier_description));
  }, [active, items, equivalences, discontinued, query, suggestions, ignoreEtPrefix]);
  function move(delta: number) { if (!busy && visible[index + delta]) setProgress(p => ({ ...p, activeId: visible[index + delta].id })); }
  function needsQuantities(item: PriceListItem) {
    if (!active) return false;
    const ids = item.matched_presentations?.map(c => c.product_id) ?? (item.match_state === "safe" && item.matched_product_id ? [item.matched_product_id] : []);
    if (ids.some(id => id !== active.id)) return true;
    const own = extractPresentation(active.description, active.unit), incoming = extractPresentation(item.supplier_description, item.supplier_unit);
    return own.count !== null && incoming.count !== null && own.count !== incoming.count;
  }
  async function linked(item: PriceListItem) {
    if (!active || busy) return;
    if (needsQuantities(item)) { setTeaching(item); return; }
    setBusy(true); setError("");
    try { await confirmMatch(session, item, active.id); setProgress(p => ({ ...p, activeId: (visible[index + 1] ?? visible[index - 1])?.id ?? "" })); await onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo vincular."); }
    finally { setBusy(false); }
  }
  return <section className="panel overflow-hidden" aria-label="Identificar mis artículos">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-steel-50 p-4"><div><h2 className="font-display text-lg font-semibold">Mis artículos → lista del proveedor</h2><p className="mt-1 text-xs text-steel-600">{products.length} {products.length === 1 ? "artículo propio pendiente" : "artículos propios pendientes"}. Elegí el equivalente del proveedor para cada uno; sus artículos que no vendés quedan fuera de esta cola.</p></div><button disabled={busy} className="text-sm text-teal-600" onClick={onClose}>Volver a resultados</button></div>
    {error && <p role="alert" className="p-3 text-sm text-danger-500">{error}</p>}
    <div className="grid md:h-[70vh] md:min-h-[450px] md:grid-cols-[minmax(220px,2fr)_minmax(0,3fr)]">
      <div className="flex min-h-0 flex-col border-r"><div className="space-y-2 border-b p-3"><input aria-label="Buscar en mis artículos" value={catalogQuery} disabled={busy} onChange={e => setCatalogQuery(e.target.value)} placeholder="Buscar en mi catálogo…" className="field-control w-full"/><div className="flex gap-2">{[false, true].map(value => <button key={String(value)} disabled={busy} aria-pressed={showDeferred === value} onClick={() => setShowDeferred(value)} className={`rounded px-2 py-1 text-xs ${showDeferred === value ? "bg-teal-500 text-white" : "bg-steel-50"}`}>{value ? "Para después" : "Pendientes"} · {products.filter(p => progress.deferred.includes(p.id) === value).length}</button>)}</div></div>
        <div className="max-h-60 min-h-0 flex-1 overflow-y-auto md:max-h-none">{visible.map(p => <button key={p.id} disabled={busy} aria-current={active?.id === p.id ? "true" : undefined} onClick={() => setProgress(state => ({ ...state, activeId: p.id }))} className={`block w-full border-b p-3 text-left ${active?.id === p.id ? "border-l-4 border-l-teal-500 bg-teal-50" : "hover:bg-steel-50"}`}><span className="block text-sm font-semibold">{p.description}</span><span className="mono-num text-xs text-steel-600">Mi código: {p.code} · {formatPrice(p.current_price, p.currency)}</span></button>)}{!visible.length && <p className="p-4 text-sm">{products.length ? "Sin artículos en este filtro. Revisá los que dejaste para después." : "Todos tus artículos quedaron identificados."}</p>}</div>
      </div>
      <div className="min-h-0 min-w-0 overflow-y-auto p-4">{active && <>
        <div className="mb-3 flex flex-wrap gap-2"><span className="mr-auto text-xs">Mi artículo {index + 1} de {visible.length}</span><button disabled={busy || index <= 0} onClick={() => move(-1)} className="field-control">Anterior</button><button disabled={busy || index >= visible.length - 1} onClick={() => move(1)} className="field-control">Siguiente</button></div>
        <div className="mb-4 rounded bg-teal-50 p-3"><p className="eyebrow">Mi artículo</p><h3 className="mt-1 font-semibold">{active.description}</h3><p className="mono-num text-xs">{active.code} · {active.unit} · {formatPrice(active.current_price, active.currency)}</p></div>
        {teaching ? <><p className="mb-3 text-sm font-semibold">Equivalente del proveedor: {teaching.supplier_description}</p><PresentationConversionEditor key={`${active.id}:${teaching.id}`} session={session} item={teaching} preferredProductId={active.id} onBusyChange={setBusy} onResolved={async () => { setTeaching(null); setProgress(p => ({ ...p, activeId: (visible[index + 1] ?? visible[index - 1])?.id ?? "" })); await onRefresh(); }}/><button disabled={busy} onClick={() => setTeaching(null)} className="mt-3 text-sm text-teal-600">Elegir otro producto del proveedor</button></> : <>
          <label className="block text-sm font-semibold">Buscar en la lista del proveedor<input aria-label="Buscar en la lista del proveedor" disabled={busy} value={query} onChange={e => { setQuery(e.target.value); setLimit(20); }} placeholder="Código o descripción del proveedor…" className="field-control mt-2 w-full"/></label>
          <p className="my-3 text-xs text-steel-600">{loading ? "Buscando candidatos para tus artículos…" : query.trim() ? `${candidates.length} resultados en la lista del proveedor` : `${candidates.length} candidatos para este artículo tuyo`}</p>
          <div className="space-y-2">{candidates.slice(0, limit).map(item => <div key={item.id} className="rounded border border-steel-200 p-3"><p className="text-sm font-semibold">{item.supplier_description}</p><p className="mono-num my-2 text-xs text-steel-600">Código proveedor: {item.supplier_code} · {item.parsed_price !== null ? formatPrice(item.parsed_price, item.supplier_currency ?? active.currency) : item.raw_price}</p><div className="flex flex-wrap gap-2"><button disabled={busy || loading} onClick={() => void linked(item)} className="rounded bg-teal-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{needsQuantities(item) ? "Confirmar cantidades" : "Vincular y seguir"}</button><button disabled={busy} onClick={() => setTeaching(item)} className="text-xs text-teal-600">Cantidades / varias presentaciones</button></div></div>)}</div>
          {!loading && !candidates.length && <p className="rounded bg-steel-50 p-3 text-sm">No encontramos un equivalente para tu artículo. Probá una búsqueda en la lista del proveedor o dejalo pendiente para después.</p>}
          {candidates.length > limit && <button className="field-control mt-3" onClick={() => setLimit(n => n + 20)}>Mostrar más candidatos</button>}
        </>}
        <button disabled={busy} onClick={() => { const id = active.id; const next = visible[index + 1] ?? visible[index - 1]; setProgress(p => ({ activeId: next?.id ?? "", deferred: showDeferred ? p.deferred.filter(x => x !== id) : [...new Set([...p.deferred, id])] })); }} className="field-control mt-4 w-full">{showDeferred ? "Volver a pendientes" : "No lo encontré / dejar para después"}</button>
      </>}</div>
    </div>
  </section>;
}
