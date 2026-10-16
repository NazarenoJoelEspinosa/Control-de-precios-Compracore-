import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import PresentationConversionEditor from "@/components/PresentationConversionEditor";
import { presentationReviewReason } from "@/lib/presentationReview";
import { formatPrice } from "@/lib/normalize";
import type { ExportRow } from "@/lib/exportResults";
import type { ComparisonSession } from "@/types/database";

type Progress = { activeId: string; deferred: string[] };
function read(key: string): Progress {
  try { const p = JSON.parse(localStorage.getItem(key) ?? "null"); return p && typeof p.activeId === "string" && Array.isArray(p.deferred) ? { activeId: p.activeId, deferred: p.deferred.filter((id: unknown) => typeof id === "string") } : { activeId: "", deferred: [] }; }
  catch { return { activeId: "", deferred: [] }; }
}
export default function PresentationReview({ session, rows, initialItemId, onRefresh, onClose }: {
  session: ComparisonSession; rows: ExportRow[]; initialItemId?: string; onRefresh: () => Promise<void>; onClose: () => void;
}) {
  const key = `pricecore:presentations:${session.id}`;
  const [progress, setProgress] = useState(() => ({ ...read(key), ...(initialItemId ? { activeId: initialItemId } : {}) }));
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [showDeferred, setShowDeferred] = useState(() => progress.deferred.includes(progress.activeId));
  const listRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const candidates = useMemo(() => {
    const unique = new Map<string, ExportRow>();
    for (const row of rows) if (!completed.has(row.item.id) && (presentationReviewReason(row.item, row.product, row.change) || row.item.id === initialItemId)) unique.set(row.item.id, unique.get(row.item.id) ?? row);
    return [...unique.values()];
  }, [rows, completed, initialItemId]);
  const deferred = new Set(progress.deferred);
  const visible = candidates.filter(r => deferred.has(r.item.id) === showDeferred && `${r.product?.code} ${r.product?.description} ${r.item.supplier_code} ${r.item.supplier_description}`.toLowerCase().includes(query.toLowerCase().trim()));
  const current = visible.find(r => r.item.id === progress.activeId) ?? visible[0];
  const index = visible.findIndex(r => r.item.id === current?.item.id);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(progress)); } catch { /* Navegación disponible sin persistencia. */ } }, [key, progress]);
  useEffect(() => { if (!busy && current && current.item.id !== progress.activeId) setProgress(p => ({ ...p, activeId: current.item.id })); }, [current?.item.id, progress.activeId, busy]);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (list && row) {
      const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
    }
    if (editorRef.current) editorRef.current.scrollTop = 0;
  }, [current?.item.id]);
  function move(step: number) { if (!busy && visible[index + step]) setProgress(p => ({ ...p, activeId: visible[index + step].item.id })); }
  async function saved() {
    if (!current) return;
    const id = current.item.id;
    const next = visible[index + 1] ?? visible[index - 1];
    setProgress(p => ({ activeId: next?.item.id ?? "", deferred: p.deferred.filter(itemId => itemId !== id) }));
    setCompleted(p => new Set([...p, id]));
    setNotice("Relación guardada. Los precios convertidos quedan pendientes de aprobación.");
    try { await onRefresh(); } catch { setError("La relación se guardó, pero no se pudo actualizar la comparación. Volvé a abrirla para ver los precios actuales."); }
  }
  return <section className="panel overflow-hidden" aria-label="Revisar presentaciones">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-steel-50 p-4">
      <div><h2 className="font-display text-lg font-semibold">Revisar presentaciones</h2><p className="mt-1 text-xs text-steel-600">{candidates.filter(r => !deferred.has(r.item.id)).length} pendientes · {candidates.filter(r => deferred.has(r.item.id)).length} para después. La diferencia de precio es un aviso; vos confirmás las cantidades.</p></div>
      <button disabled={busy} onClick={onClose} className="text-sm text-teal-600 disabled:opacity-50">‹ Volver a resultados</button>
    </div>
    {notice && <p role="status" className="px-4 py-2 text-sm text-teal-600">{notice}</p>}
    {error && <p role="alert" className="p-3 text-sm text-danger-500">{error}</p>}
    <div className="grid md:h-[70vh] md:min-h-[450px] md:grid-cols-[minmax(230px,2fr)_minmax(0,3fr)]">
      <div className="flex min-h-0 flex-col border-r border-steel-100">
        <div className="space-y-2 border-b p-3"><input aria-label="Buscar presentación" disabled={busy} value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar artículo o código…" className="field-control w-full" />
          <div className="flex gap-2">{[false, true].map(value => <button key={String(value)} disabled={busy} aria-pressed={showDeferred === value} onClick={() => setShowDeferred(value)} className={clsx("rounded px-3 py-1 text-xs", showDeferred === value ? "bg-teal-500 text-white" : "bg-steel-50 text-steel-600")}>{value ? "Para después" : "Pendientes"}</button>)}</div>
        </div>
        <div ref={listRef} className="max-h-60 min-h-0 flex-1 overflow-y-auto md:max-h-none">{visible.map((row, i) => <button key={row.item.id} disabled={busy} aria-current={row.item.id === current?.item.id ? "true" : undefined} onClick={() => setProgress(p => ({ ...p, activeId: row.item.id }))} className={clsx("block w-full border-b px-3 py-3 text-left", row.item.id === current?.item.id ? "border-l-4 border-l-teal-500 bg-teal-50" : "hover:bg-steel-50")}>
          <span className="block text-sm font-medium">{i + 1}. {row.product?.description ?? row.item.supplier_description}</span><span className="mono-num text-xs text-steel-600">{row.product?.code ?? row.item.supplier_code}</span>
          <span className="mt-1 block text-xs text-amber-600">{row.item.match_state === "presentation_diff" ? "Presentación distinta" : "Verificar caja, pack o unidad"}</span>
        </button>)}{!visible.length && <p className="p-4 text-sm text-steel-600">{query ? "Sin resultados con esa búsqueda." : candidates.length ? "No hay artículos en este filtro. Revisá los que dejaste para después." : "No quedan presentaciones por revisar."}</p>}</div>
      </div>
      <div ref={editorRef} className="min-h-0 min-w-0 overflow-visible p-4 md:overflow-y-auto">
        {current ? <>
          <div className="mb-4 flex flex-wrap gap-2"><span className="mr-auto self-center text-xs text-steel-600">{index + 1} de {visible.length}</span><button disabled={busy || index <= 0} onClick={() => move(-1)} className="field-control disabled:opacity-40">← Anterior</button><button disabled={busy || index >= visible.length - 1} onClick={() => move(1)} className="field-control disabled:opacity-40">Siguiente →</button></div>
          <div className="mb-4 grid gap-3 rounded bg-steel-50 p-3 sm:grid-cols-2">
            <div><p className="eyebrow mb-1">Mi artículo</p><h3 className="text-sm font-semibold">{current.product?.description ?? "Elegí el artículo de tu catálogo"}</h3><p className="mono-num mt-1 text-xs">{current.product?.code}</p><p className="mt-1 text-sm">{current.product ? formatPrice(current.change?.old_price ?? current.product.current_price, current.product.currency) : "Sin producto identificado"}</p></div>
            <div><p className="eyebrow mb-1">Proveedor</p><p className="text-sm font-semibold">{current.item.supplier_description}</p><p className="mono-num mt-1 text-xs">{current.item.supplier_code}</p><p className="mt-1 text-sm">{current.item.parsed_price !== null ? formatPrice(current.item.parsed_price, current.item.supplier_currency ?? current.product?.currency) : current.item.raw_price}</p></div>
          </div>
          {current.item.review_reason && <p className="mb-3 rounded bg-amber-50 p-3 text-xs text-steel-600">{current.item.review_reason}</p>}
          <PresentationConversionEditor key={current.item.id} session={session} item={current.item} onResolved={saved} onBusyChange={setBusy} saveLabel="Guardar y seguir" />
          <button disabled={busy} onClick={() => {
            setProgress(p => ({ activeId: (visible[index + 1] ?? visible[index - 1])?.item.id ?? "", deferred: showDeferred ? p.deferred.filter(id => id !== current.item.id) : [...new Set([...p.deferred, current.item.id])] }));
          }} className="field-control mt-3 w-full disabled:opacity-50">{showDeferred ? "Volver a pendientes" : "Dejar para después →"}</button>
        </> : <p className="p-4 text-sm text-steel-600">Podés volver a resultados o cambiar de filtro para continuar.</p>}
      </div>
    </div>
  </section>;
}
