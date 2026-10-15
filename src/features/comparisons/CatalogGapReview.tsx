import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { baseCode, sameCodeWithoutPrefix } from "@/lib/codePrefixes";
import { formatPrice } from "@/lib/normalize";
import { scoreProductAgainstItem } from "@/lib/matching";
import { suppliersRepo } from "@/lib/db";
import { applyPrefixMatches } from "@/lib/applyPrefixMatches";
import { confirmMatch } from "@/lib/reviewActions";
import type { ComparisonSession, PriceListItem, Product } from "@/types/database";

type Progress = { activeId: string; deferred: string[]; queries: Record<string, string> };
const emptyProgress: Progress = { activeId: "", deferred: [], queries: {} };
function readProgress(key: string): Progress {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value.activeId !== "string" || !Array.isArray(value.deferred) || !value.queries || typeof value.queries !== "object" || Array.isArray(value.queries)) return emptyProgress;
    return { activeId: value.activeId, deferred: value.deferred.filter((id: unknown) => typeof id === "string"),
      queries: Object.fromEntries(Object.entries(value.queries).filter(([, q]) => typeof q === "string")) as Record<string, string> };
  } catch { return emptyProgress; }
}

export default function CatalogGapReview({ session, products, items, onRefresh, onClose, ignoreEtPrefix = false }: {
  session: ComparisonSession; products: Product[]; items: PriceListItem[];
  ignoreEtPrefix?: boolean;
  onRefresh: () => Promise<void>; onClose: () => void;
}) {
  const storageKey = `pricecore:gap-review:${session.id}`;
  const [progress, setProgress] = useState(() => readProgress(storageKey));
  const [catalogQuery, setCatalogQuery] = useState("");
  const [view, setView] = useState<"pending" | "deferred" | "all">(() => progress.deferred.includes(progress.activeId) ? "deferred" : "pending");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [limit, setLimit] = useState(20);
  const listRef = useRef<HTMLDivElement>(null);
  const candidateRef = useRef<HTMLDivElement>(null);
  const deferred = useMemo(() => new Set(progress.deferred), [progress.deferred]);
  const deferredCount = products.filter(p => deferred.has(p.id)).length;
  const visible = useMemo(() => {
    const q = catalogQuery.trim().toLocaleLowerCase();
    return products.filter(p => (view === "all" || deferred.has(p.id) === (view === "deferred")) &&
      (!q || `${p.code} ${p.description}`.toLocaleLowerCase().includes(q)));
  }, [products, deferred, catalogQuery, view]);
  const active = visible.find(p => p.id === progress.activeId) ?? visible[0];
  const index = active ? visible.findIndex(p => p.id === active.id) : -1;
  const query = active ? progress.queries[active.id] ?? "" : "";

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch { /* Revisión disponible aunque el navegador no permita guardar progreso. */ }
  }, [storageKey, progress]);
  useEffect(() => {
    if (!busy && active && active.id !== progress.activeId) setProgress(p => ({ ...p, activeId: active.id }));
  }, [active?.id, progress.activeId, busy]);
  useEffect(() => {
    setLimit(20);
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row && list) {
      const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
    }
    if (candidateRef.current) candidateRef.current.scrollTop = 0;
  }, [active?.id, query]);

  const candidates = useMemo(() => {
    if (!active) return [];
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(item => !terms.length || terms.every(term => `${item.supplier_code} ${item.supplier_description}`.toLocaleLowerCase().includes(term)) || (ignoreEtPrefix && baseCode(query) && baseCode(item.supplier_code) === baseCode(query)))
      .map(item => ({ item, prefixMatch: ignoreEtPrefix && sameCodeWithoutPrefix(active.code, item.supplier_code), score: scoreProductAgainstItem(active, item) }))
      .filter(result => terms.length || result.prefixMatch || result.score >= 25)
      .sort((a, b) => Number(b.prefixMatch) - Number(a.prefixMatch) || b.score - a.score);
  }, [active, items, query, ignoreEtPrefix]);

  function move(step: number) {
    if (saving.current || !visible[index + step]) return;
    setError("");
    setProgress(p => ({ ...p, activeId: visible[index + step].id }));
  }
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault(); move(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  function deferActive() {
    if (!active || saving.current) return;
    const next = visible[index + 1] ?? visible[index - 1];
    setProgress(p => ({ ...p, activeId: next?.id ?? "", deferred: [...new Set([...p.deferred, active.id])] }));
    setError(""); setNotice("Dejado para después. Podés retomarlo desde el filtro «Para después».");
  }
  async function link(item: PriceListItem) {
    if (!active || saving.current) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    const product = active;
    const nextId = (visible[index + 1] ?? visible[index - 1])?.id ?? "";
    let saved = false;
    try {
      await confirmMatch(session, item, product.id);
      saved = true;
      setProgress(p => ({ ...p, activeId: nextId, deferred: p.deferred.filter(id => id !== product.id) }));
      await onRefresh();
      setNotice(`Vinculado: ${product.description}. El precio queda pendiente de revisión.`);
    } catch (cause) {
      setError(saved ? "La vinculación se guardó, pero no se pudo actualizar la pantalla. Volvé a abrir la comparación antes de seguir." : cause instanceof Error ? cause.message : "No se pudo vincular. Probá nuevamente.");
    } finally { saving.current = false; setBusy(false); }
  }

  async function setPrefixRule(enabled: boolean) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    let saved = false;
    try {
      await suppliersRepo.update(session.supplier_id, { ignore_et_prefix: enabled });
      saved = true;
      await onRefresh();
      setNotice(enabled ? "Regla ET- activada sólo para este proveedor. Usá «Aplicar a esta comparación» para resolver los faltantes actuales." : "Regla ET- desactivada para este proveedor. Las vinculaciones ya guardadas se conservan.");
    } catch (cause) {
      setError(saved ? "La regla se guardó, pero no se pudo actualizar la pantalla. Volvé a abrir la comparación." : cause instanceof Error ? cause.message : "No se pudo guardar la regla.");
    } finally { saving.current = false; setBusy(false); }
  }
  async function applyPrefixRule() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    let saved = false;
    try {
      const result = await applyPrefixMatches(session.id);
      saved = true;
      const linkedIds = new Set(result.linkedProductIds);
      const next = visible.slice(Math.max(0, index)).find(p => !linkedIds.has(p.id)) ?? [...visible.slice(0, index)].reverse().find(p => !linkedIds.has(p.id));
      setProgress(p => ({ ...p, activeId: next?.id ?? "", deferred: p.deferred.filter(id => !linkedIds.has(id)) }));
      await onRefresh();
      setNotice(`${result.linked} artículos vinculados por código con/sin ET-. ${result.review} casos requieren revisión manual. Los precios quedan pendientes de aprobación.`);
    } catch (cause) {
      setError(saved ? "Las vinculaciones se guardaron, pero no se pudo actualizar la pantalla. Volvé a abrir la comparación." : cause instanceof Error ? cause.message : "No se pudo aplicar la regla.");
    } finally { saving.current = false; setBusy(false); }
  }

  return <section className="panel overflow-hidden" aria-label="Revisión continua de tu catálogo">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-steel-100 bg-steel-50 p-4">
      <div><h2 className="text-sm font-semibold text-ink">Encontrar productos de mi catálogo</h2>
        <p className="mt-1 text-xs text-steel-600">Elegí un artículo y vinculalo con su equivalente. Avanzás automáticamente al siguiente.</p>
        <p className="mt-1 text-xs text-steel-600">{products.length - deferredCount} pendientes · {deferredCount} para después · Alt + ← / → para navegar</p>
      </div>
      <button disabled={busy} onClick={onClose} className="text-sm text-teal-600 hover:underline disabled:opacity-50">‹ Volver a los resultados</button>
    </div>
    <div className="flex flex-wrap items-center gap-3 border-b border-steel-100 bg-steel-50 px-4 py-3">
      <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={ignoreEtPrefix} disabled={busy} onChange={e => setPrefixRule(e.target.checked)} /> Reconocer ET- sólo para este proveedor</label>
      <button disabled={busy || !ignoreEtPrefix} onClick={applyPrefixRule} className="rounded bg-teal-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Procesando…" : "Aplicar a esta comparación"}</button>
      <p className="w-full text-xs text-steel-600">{ignoreEtPrefix ? "Regla activada. Podés aplicarla a los faltantes actuales sin volver a importar la lista. Se vinculan sólo códigos base únicos; los casos dudosos quedan para revisión." : "Regla desactivada. Si este proveedor usa ET-CODIGO para tu CODIGO, activala aquí y aplicala a esta comparación."}</p>
    </div>
    <p role="status" className="px-4 py-2 text-xs text-teal-600">{notice || "Tu posición y tus búsquedas se guardan en este navegador."}</p>
    {error && <p role="alert" className="mx-4 mb-3 rounded bg-danger-50 p-3 text-sm text-danger-500">{error}</p>}
    <div className="grid md:h-[65vh] md:min-h-[400px] md:grid-cols-[minmax(240px,2fr)_minmax(0,3fr)]">
      <div className="flex min-h-0 flex-col border-b border-steel-100 md:border-b-0 md:border-r">
        <div className="space-y-2 border-b border-steel-100 p-3">
          <input aria-label="Buscar en mi catálogo pendiente" disabled={busy} value={catalogQuery} onChange={e => setCatalogQuery(e.target.value)} placeholder="Buscar en mi catálogo…" className="field-control w-full" />
          <div className="flex flex-wrap gap-1">{([['pending', 'Pendientes'], ['deferred', 'Para después'], ['all', 'Todos']] as const).map(([key, label]) =>
            <button key={key} disabled={busy} aria-pressed={view === key} onClick={() => setView(key)} className={clsx("rounded px-2 py-1 text-xs", view === key ? "bg-teal-500 text-white" : "bg-steel-50 text-steel-600")}>{label}</button>)}</div>
        </div>
        <div ref={listRef} className="relative max-h-60 min-h-0 flex-1 overflow-y-auto md:max-h-none">
          {visible.map((p, i) => <button key={p.id} disabled={busy} aria-current={p.id === active?.id ? "true" : undefined} onClick={() => { setError(""); setProgress(state => ({ ...state, activeId: p.id })); }} className={clsx("block w-full border-b border-steel-100 px-4 py-3 text-left", p.id === active?.id ? "border-l-4 border-l-teal-500 bg-teal-50" : "hover:bg-steel-50")}>
            <span className="block text-sm font-medium text-ink">{i + 1}. {p.description}</span>
            <span className="mono-num mt-1 block text-xs text-steel-600">{p.code} · {formatPrice(p.current_price, p.currency)}</span>
            {deferred.has(p.id) && <span className="text-xs text-amber-600">Para después</span>}
          </button>)}
          {!visible.length && <p className="p-4 text-sm text-steel-600">{catalogQuery ? "No hay artículos con esa búsqueda." : view === "pending" && deferredCount ? "Terminaste los pendientes. Revisá los que dejaste para después." : "No hay artículos en este filtro."}</p>}
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">
        {active ? <>
          <div className="space-y-3 border-b border-steel-100 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-xs text-steel-600">Artículo {index + 1} de {visible.length}</span>
              <button disabled={busy || index <= 0} onClick={() => move(-1)} className="field-control disabled:opacity-40">← Anterior</button>
              <button disabled={busy || index >= visible.length - 1} onClick={() => move(1)} className="field-control disabled:opacity-40">Siguiente →</button>
            </div>
            <div><h3 className="font-semibold text-ink">{active.description}</h3><p className="mono-num text-xs text-steel-600">{active.code} · {formatPrice(active.current_price, active.currency)}</p></div>
            <div className="flex flex-wrap gap-2">
              {deferred.has(active.id) ? <button disabled={busy} onClick={() => setProgress(p => ({ ...p, deferred: p.deferred.filter(id => id !== active.id) }))} className="field-control">Volver a pendientes</button> : <button disabled={busy} onClick={deferActive} className="field-control">Dejar para después →</button>}
            </div>
            <label className="block text-xs text-steel-600">Buscar en los artículos del proveedor sin vincular
              <input disabled={busy} value={query} onChange={e => { const value = e.target.value; setProgress(p => ({ ...p, queries: { ...p.queries, [active.id]: value } })); }} placeholder="Código o palabras de la descripción…" className="field-control mt-1 w-full" />
            </label>
            <p className="text-xs text-steel-600">{query.trim() ? `${candidates.length} resultados` : `${candidates.length} sugerencias por similitud`}. Verificá producto y presentación antes de vincular.</p>
          </div>
          <div ref={candidateRef} className="max-h-96 min-h-0 flex-1 space-y-2 overflow-y-auto bg-steel-50 p-3 md:max-h-none" aria-busy={busy}>
            {candidates.slice(0, limit).map(({ item, prefixMatch }) => <div key={item.id} className="flex flex-wrap items-center gap-2 rounded border border-steel-200 bg-white p-3">
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">{prefixMatch && <p className="mb-1 text-xs font-semibold text-teal-600">Mismo código con/sin ET- · verificar presentación</p>}<p className="text-sm font-medium text-ink">{item.supplier_description}</p><p className="mono-num mt-1 text-xs text-steel-600">{item.supplier_code} · {item.parsed_price !== null ? formatPrice(item.parsed_price, item.supplier_currency ?? active.currency) : item.raw_price}</p></div>
              <button disabled={busy} onClick={() => link(item)} className="rounded bg-teal-500 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-600 disabled:opacity-50">{busy ? "Guardando…" : "Vincular y seguir"}</button>
            </div>)}
            {!candidates.length && <p className="p-3 text-sm text-steel-600">{!items.length ? "No quedan artículos del proveedor sin vincular." : "Sin coincidencias. Probá otra palabra o código, o dejalo para después."}</p>}
            {candidates.length > limit && <button disabled={busy} onClick={() => setLimit(n => n + 20)} className="field-control w-full">Mostrar más ({limit} de {candidates.length})</button>}
          </div>
        </> : <p className="p-6 text-sm text-steel-600">{products.length ? "Seleccioná otro filtro para continuar la revisión." : "Todo tu catálogo para este proveedor apareció en esta lista."}</p>}
      </div>
    </div>
  </section>;
}
