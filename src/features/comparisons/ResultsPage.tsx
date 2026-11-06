import { closeComparison } from "@/lib/comparisonLifecycle";
import { updateComparisonLimits } from "@/lib/updateComparisonLimits";
import { buildGapReasons, type GapReason } from "@/lib/gapReasons";
import { presentationReviewReason } from "@/lib/presentationReview";
import { matchesResultFilters, resultStatus, type ResultView, type ReviewKind, type ExtraFilter } from "@/lib/resultFilters";
import PresentationReview from "./PresentationReview";
import { priceIssue } from "@/lib/pricePolicy";
import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import clsx from "clsx";
import { comparisonSessionsRepo, priceChangesRepo, priceListItemsRepo, productsRepo, suppliersRepo, equivalencesRepo, discontinuedCodesRepo } from "@/lib/db";
import { MatchStateBadge, PriceDeltaBadge, ChangeStatusBadge } from "@/components/ui/StatusBadges";
import PresentationConversionEditor from "@/components/PresentationConversionEditor";
import { convertPresentationPrice } from "@/lib/presentationConversions";
import MatchResolutionPanel from "@/components/MatchResolutionPanel";
import { formatPrice } from "@/lib/normalize";
import CatalogGapReview from "./CatalogGapReview";
import { decidePriceChange, decidePriceChanges } from "@/lib/reviewActions";
import { exportAllResults, exportApprovedOnly, type ExportRow } from "@/lib/exportResults";
import type { ComparisonSession, PriceListItem, Product } from "@/types/database";

const PRIMARY_VIEWS: { key: ResultView; label: string }[] = [
  { key: "review", label: "Por revisar" }, { key: "pending", label: "Listos para aprobar" },
  { key: "approved", label: "Aprobados" }, { key: "unchanged", label: "Sin cambios" }, { key: "all", label: "Lista completa" },
];
const EXTRA_FILTERS: { key: ExtraFilter; label: string }[] = [
  { key: "all", label: "Sin filtro adicional" }, { key: "safe", label: "Productos identificados" },
  { key: "not_found", label: "Sin equivalente en mi catálogo (filas del proveedor)" },
  { key: "presentation_diff", label: "Presentación distinta detectada al identificar" },
  { key: "discontinued", label: "Discontinuados" }, { key: "increased", label: "Subieron" },
  { key: "decreased", label: "Bajaron" }, { key: "price_error", label: "Precio / moneda con error" },
  { key: "rejected_price", label: "Precios rechazados" },
];

type SortKey = "none" | "price_desc" | "price_asc" | "score_desc" | "score_asc" | "percent_desc" | "percent_asc" | "name_asc" | "name_desc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "none", label: "Sin ordenar" },
  { key: "percent_desc", label: "% de cambio: mayor a menor" },
  { key: "percent_asc", label: "% de cambio: menor a mayor" },
  { key: "price_desc", label: "Precio: mayor a menor" },
  { key: "price_asc", label: "Precio: menor a mayor" },
  { key: "score_desc", label: "Match: mayor a menor" },
  { key: "score_asc", label: "Match: menor a mayor" },
  { key: "name_asc", label: "Nombre: A-Z" },
  { key: "name_desc", label: "Nombre: Z-A" },
];

/** Los que no tienen valor (null) siempre quedan al final, sea cual sea la dirección. */
function numericSortValue(v: number | null, ascending: boolean): number {
  if (v === null) return ascending ? Infinity : -Infinity;
  return v;
}

export default function ResultsPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<ComparisonSession | null>(null);
  const isClosed = session?.status === "closed";
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [catalogGaps, setCatalogGaps] = useState<Product[]>([]);
  const [ignoreEtPrefix, setIgnoreEtPrefix] = useState(false);
  const [gapReasons, setGapReasons] = useState<Record<string, GapReason>>({});
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [showCatalogGaps, setShowCatalogGaps] = useState(false);
  const [view, setView] = useState<ResultView>("review");
  const [reviewKind, setReviewKind] = useState<ReviewKind>("all");
  const [filter, setFilter] = useState<ExtraFilter>("all");
  const [presentationReview, setPresentationReview] = useState<{ initialItemId?: string } | null>(null);
  const [sort, setSort] = useState<SortKey>("none");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ExportRow | null>(null);
  const [exporting, setExporting] = useState<"all" | "approved" | null>(null);
  const [actionError, setActionError] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [restoreEpoch, setRestoreEpoch] = useState(0);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(300);
  const initialViewSession = useRef("");

  useEffect(() => {
    if (sessionId) load();
  }, [sessionId]);

  useEffect(() => {
    const restored = () => { setRestoreEpoch(v => v + 1); setSelected(null); void load(true).catch(e => setActionError(e.message)); };
    window.addEventListener("pricecore:restored", restored);
    return () => window.removeEventListener("pricecore:restored", restored);
  }, [sessionId]);

  async function load(background = false) {
    if (!sessionId) return;
    if (!background) setLoading(true);
    const sessionData = await comparisonSessionsRepo.get(sessionId);
    setSession(sessionData ?? null);
    if (!sessionData) {
      setLoading(false);
      return;
    }

    const supplier = await suppliersRepo.get(sessionData.supplier_id);
    setIgnoreEtPrefix(supplier?.ignore_et_prefix === true);
    const items = await priceListItemsRepo.listByPriceList(sessionData.price_list_id);
    const changes = await priceChangesRepo.listBySession(sessionId);
    const productIds = [...new Set(items.flatMap((i) => i.matched_presentations?.map(c => c.product_id) ?? [i.matched_product_id]).filter(Boolean))] as string[];
    const products = sessionData.status === "closed" && sessionData.catalog_snapshot ? sessionData.catalog_snapshot : await productsRepo.getMany(productIds);

    const productsById = new Map(products.map((p) => [p.id, p]));
    const changesByPair = new Map(changes.map((c) => [`${c.price_list_item_id}::${c.product_id}`, c]));

    const merged: ExportRow[] = items.flatMap((item) => {
      const ids = item.matched_presentations?.map(c => c.product_id) ?? [item.matched_product_id];
      return ids.map(id => ({ item, product: id ? productsById.get(id) ?? null : null,
        change: changesByPair.get(`${item.id}::${id}`) ?? null }));
    });

    setRows(merged);
    if (initialViewSession.current !== sessionData.id) {
      initialViewSession.current = sessionData.id;
      setView((["review", "pending", "approved", "unchanged"] as ResultView[]).find(v => merged.some(row => matchesResultFilters(row, v, "all", "all"))) ?? "all");
    }

    // Sentido inverso al de "no encontrados": de TU catálogo para este
    // proveedor, cuáles no aparecieron en absoluto en esta lista. Se deriva
    // en vivo de lo ya cargado — cualquier producto con al menos un ítem que
    // le haya quedado asociado (sea cual sea su match_state) cuenta como
    // "sí apareció".
    const catalogProducts = (sessionData.status === "closed" && sessionData.catalog_snapshot ? sessionData.catalog_snapshot : await productsRepo.listBySupplier(sessionData.supplier_id)).filter((p) => p.active);
    const matchedProductIds = new Set(items.flatMap((i) => i.matched_presentations?.map(c => c.product_id) ?? [i.matched_product_id]).filter(Boolean) as string[]);
    const gaps = catalogProducts.filter((p) => !matchedProductIds.has(p.id));
    setCatalogGaps(gaps);
    const [equivalences, discontinued] = await Promise.all([equivalencesRepo.listForSupplier(sessionData.supplier_id), discontinuedCodesRepo.listForSupplier(sessionData.supplier_id)]);
    setGapReasons(buildGapReasons(gaps, items, supplier?.ignore_et_prefix === true, equivalences, discontinued));
    setCatalogTotal(catalogProducts.length);

    setLoading(false);
  }

  const notFoundItems = useMemo(() => rows.filter((r) => r.item.match_state === "not_found").map((r) => r.item), [rows]);

  const filtered = useMemo(() => {
    let result = rows.filter((row) => {
      if (!matchesResultFilters(row, view, reviewKind, filter)) return false;
      if (search) {
        const q = search.toLowerCase();
        const haystack = `${row.item.supplier_code} ${row.item.supplier_description} ${row.product?.code ?? ""} ${row.product?.description ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    if (sort !== "none") {
      result = [...result].sort((a, b) => {
        switch (sort) {
          case "price_desc":
            return numericSortValue(priceOf(b), false) - numericSortValue(priceOf(a), false);
          case "price_asc":
            return numericSortValue(priceOf(a), true) - numericSortValue(priceOf(b), true);
          case "score_desc":
            return numericSortValue(b.item.match_score, false) - numericSortValue(a.item.match_score, false);
          case "score_asc":
            return numericSortValue(a.item.match_score, true) - numericSortValue(b.item.match_score, true);
          case "percent_desc":
            return numericSortValue(b.change?.diff_percent ?? null, false) - numericSortValue(a.change?.diff_percent ?? null, false);
          case "percent_asc":
            return numericSortValue(a.change?.diff_percent ?? null, true) - numericSortValue(b.change?.diff_percent ?? null, true);
          case "name_asc":
            return nameOf(a).localeCompare(nameOf(b));
          case "name_desc":
            return nameOf(b).localeCompare(nameOf(a));
          default:
            return 0;
        }
      });
    }

    return result;
  }, [rows, view, reviewKind, filter, search, sort]);

  useEffect(() => { setVisibleCount(300); }, [view, reviewKind, filter, search, sort]);
  const visibleRows = filtered.slice(0, visibleCount);

  // Igual que en la cola: "not_found" no cuenta como pendiente de revisión
  // porque no hay nada que decidir ahí — el proveedor tiene un artículo que
  // vos nunca cargaste a tu sistema. Esos se ven en la tarjeta/filtro "No
  // encontrados", no acá.
  const pendingReviewCount = new Set(rows.filter((r) => resultStatus(r) === "identification").map(r => r.item.id)).size;

  const identifiedOwnCount = new Set(rows.filter(r => r.item.match_state === "safe" && r.product?.active).map(r => r.product!.id)).size;
  const presentationReviewCount = new Set(rows.filter(r => resultStatus(r) === "presentations").map(r => r.item.id)).size;

  const pendingPrices = filtered.filter(r => resultStatus(r) === "pending");
  const exportableCount = rows.filter(r => resultStatus(r) === "approved").length;
  async function decide(row: ExportRow, status: "approved" | "rejected") {
    if (!row.change) return;
    setActionError(""); setDeciding(true);
    try { await decidePriceChange(row.change.id, status); await load(true); return true; }
    catch (error) { setActionError(error instanceof Error ? error.message : "No se pudo decidir el precio"); }
    finally { setDeciding(false); }
  }
  async function approveFiltered() {
    if (!pendingPrices.length || !window.confirm(`¿Aprobar los ${pendingPrices.length} precios pendientes del filtro actual?`)) return;
    setActionError(""); setDeciding(true);
    try { await decidePriceChanges(pendingPrices.map(r => r.change!.id), "approved"); await load(true); }
    catch (error) { setActionError(error instanceof Error ? error.message : "No se pudieron aprobar los precios"); }
    finally { setDeciding(false); }
  }

  async function downloadResults(kind: "all" | "approved") {
    if (!session) return;
    setExporting(kind); setActionError("");
    try {
      if (kind === "approved") await exportApprovedOnly(rows, `pricecore-aprobados-${session.id.slice(0, 8)}.xlsx`);
      else await exportAllResults(rows, `pricecore-resultados-${session.id.slice(0, 8)}.xlsx`);
    } catch (e) { setActionError(e instanceof Error ? e.message : "No se pudo exportar."); }
    finally { setExporting(null); }
  }

  async function refreshLimits() {
    if (!session || deciding) return;
    setDeciding(true); setActionError("");
    try { await updateComparisonLimits(session.id); await load(true); }
    catch (e) { setActionError(e instanceof Error ? e.message : "No se pudieron actualizar los límites."); }
    finally { setDeciding(false); }
  }
  async function finalize() {
    if (!session || deciding || !window.confirm("¿Finalizar esta comparación? Conservaremos resultados y aprendizaje. Los pendientes quedan sin aprobar. Verificá que exportaste lo necesario para OneSoft. La siguiente actualización pedirá archivos nuevos.")) return;
    setDeciding(true); setActionError("");
    try { await closeComparison(session.id); navigate("/history"); }
    catch (e) { setActionError(e instanceof Error ? e.message : "No se pudo finalizar."); }
    finally { setDeciding(false); }
  }

  async function handleDeleteSession() {
    if (!session) return;
    if (!window.confirm("¿Eliminar esta comparación? Se borra de forma permanente, junto con todos sus resultados.")) return;
    await comparisonSessionsRepo.remove(session.id);
    navigate("/history", { replace: true });
  }

  if (loading) return <p className="text-sm text-steel-600">Cargando...</p>;
  if (!session) return <p className="text-sm text-danger-500">No se encontró la sesión.</p>;

  return (
    <div>
      {actionError && <p role="alert" className="mb-3 rounded bg-danger-50 p-3 text-sm text-danger-500">{actionError}</p>}
      {session.status === "closed" && <p className="mb-4 rounded bg-teal-50 p-3 text-sm">Comparación finalizada. Los resultados se conservan para consultar y exportar. <Link className="font-semibold underline" to="/comparisons/new">Iniciar nueva actualización</Link></p>}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Comparación</p>
          <h1 className="font-display text-2xl font-semibold text-ink">
            {new Date(session.created_at).toLocaleDateString("es-AR")}
          </h1>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <button onClick={() => void downloadResults("approved")} disabled={exporting !== null || exportableCount === 0} className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{exporting === "approved" ? "Generando…" : `Exportar ${exportableCount} precios aprobados`}</button>
          <details className="relative text-sm"><summary className="cursor-pointer rounded border border-steel-200 bg-white px-3 py-2">Más acciones</summary>
            <div className="absolute right-0 z-20 mt-2 w-64 space-y-2 rounded border border-steel-200 bg-white p-3 shadow-lg">
              <button onClick={() => void downloadResults("all")} disabled={exporting !== null} className="block w-full rounded px-2 py-2 text-left text-steel-700 hover:bg-steel-50">{exporting === "all" ? "Generando…" : "Exportar lista completa"}</button>
              {!isClosed && <button disabled={deciding} onClick={() => void finalize()} className="block w-full rounded px-2 py-2 text-left text-teal-600 hover:bg-teal-50">Finalizar comparación</button>}
              <button onClick={handleDeleteSession} className="block w-full border-t border-steel-100 px-2 py-2 text-left text-danger-500">Eliminar comparación</button>
            </div>
          </details>
        </div>
      </div>

      <section aria-label="Avance de identificación" className="panel mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold">Tu catálogo: <span className="mono-num">{identifiedOwnCount} de {catalogTotal}</span> artículos identificados</h2><p className="mt-1 text-xs text-steel-600">{Math.max(0, catalogTotal - identifiedOwnCount - catalogGaps.length)} con vínculo por confirmar · {catalogGaps.length} sin vínculo. Aprobar precios es otro paso.</p></div>
          {catalogGaps.length > 0 && <button disabled={isClosed} onClick={() => { setPresentationReview(null); setShowCatalogGaps(true); }} className="rounded border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-500 disabled:opacity-50">Buscar {catalogGaps.length} artículos sin vínculo</button>}
        </div>
        <progress aria-label="Artículos propios identificados" max={Math.max(1, catalogTotal)} value={identifiedOwnCount} className="mt-3 h-2 w-full accent-teal-500" />
        <details className="mt-2 text-xs text-steel-600"><summary className="cursor-pointer">¿Por qué identificados y aprobados son distintos?</summary><p className="mt-2">Los identificados cuentan artículos propios únicos. Abajo se cuentan resultados de precios: algunos necesitan revisar cantidades, otros esperan aprobación y otros no cambiaron. Un artículo puede tener varias filas o presentaciones en la lista del proveedor. Los artículos sin vínculo se revisan aparte.</p></details>
      </section>

      {!isClosed && presentationReview ? (
        <PresentationReview key={`${session.id}:${restoreEpoch}`} session={session} rows={rows} initialItemId={presentationReview.initialItemId} onRefresh={() => load(true)} onClose={() => setPresentationReview(null)} />
      ) : !isClosed && showCatalogGaps ? (
        <CatalogGapReview
          key={`${session.id}:${restoreEpoch}`}
          session={session}
          products={catalogGaps}
          reasons={gapReasons}
          onTeachPresentations={itemId => setPresentationReview({ initialItemId: itemId })}
          ignoreEtPrefix={ignoreEtPrefix}
          items={notFoundItems}
          onRefresh={() => load(true)}
          onClose={() => setShowCatalogGaps(false)}
        />
      ) : (
        <>
      <div className="panel mb-4 space-y-3 p-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Vista de resultados">
          {PRIMARY_VIEWS.map(f => <button key={f.key} aria-pressed={view === f.key} onClick={() => { setView(f.key); setFilter("all"); setReviewKind("all"); }} className={clsx("rounded px-3 py-2 text-sm font-medium", view === f.key ? "bg-teal-500 text-white" : "bg-steel-50 text-steel-600 hover:bg-steel-100")}>{f.label} <span className="mono-num ml-1 text-xs">{rows.filter(row => matchesResultFilters(row, f.key, "all", "all")).length}</span></button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {view === "review" && <div className="flex flex-wrap gap-1" role="group" aria-label="Motivo de revisión">{([{ key: "all", label: "Todo" }, { key: "identification", label: "Identificar" }, { key: "presentations", label: "Presentación" }, { key: "price", label: "Precio / moneda" }] as { key: ReviewKind; label: string }[]).map(k => <button key={k.key} aria-pressed={reviewKind === k.key} onClick={() => setReviewKind(k.key)} className={clsx("rounded px-2 py-1 text-xs", reviewKind === k.key ? "bg-amber-50 font-semibold text-amber-600" : "text-steel-600 hover:bg-steel-50")}>{k.label} · {rows.filter(row => matchesResultFilters(row, "review", k.key, "all")).length}</button>)}</div>}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="ml-auto rounded border border-steel-200 px-2 py-1.5 text-xs text-steel-600 focus:border-teal-500"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          placeholder="Buscar código o descripción..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded border border-steel-200 px-3 py-1.5 text-sm focus:border-teal-500"
        />
        </div>
        <details className="text-xs text-steel-600"><summary className="cursor-pointer">Filtros adicionales{filter !== "all" ? " · 1 activo" : ""}</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2"><select aria-label="Filtro adicional" value={filter} onChange={e => setFilter(e.target.value as ExtraFilter)} className="field-control max-w-full">{EXTRA_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select>{filter !== "all" && <button onClick={() => setFilter("all")} className="text-teal-600">Quitar filtro adicional</button>}<span>Se combina con la pestaña y la búsqueda actuales.</span></div>
        </details>
        {view === "review" && reviewKind === "presentations" && presentationReviewCount > 0 && <button disabled={isClosed} onClick={() => setPresentationReview({})} className="rounded bg-amber-600 px-3 py-2 text-xs font-semibold text-white">Revisar presentaciones una por una</button>}
        {view === "review" && reviewKind === "identification" && pendingReviewCount > 0 && !isClosed && <Link to={`/comparisons/${session.id}/review`} className="inline-block rounded bg-amber-600 px-3 py-2 text-xs font-semibold text-white">Identificar uno por uno</Link>}
        <details className="text-xs text-steel-600"><summary className="cursor-pointer">Datos del proveedor y configuración</summary><p className="mt-2">Lista original: {session.total_items.toLocaleString("es-AR")} filas. «Lista completa» incluye artículos que no vendés. Un resultado puede representar una presentación propia de esa fila.</p><p className="mt-2">Avisos desde +{rows[0]?.item.presentation_limits?.increase ?? 100}% / −{rows[0]?.item.presentation_limits?.decrease ?? 50}%, sin cantidades confirmadas.</p><button disabled={deciding || isClosed} onClick={refreshLimits} className="mt-2 rounded border border-steel-200 px-3 py-2 text-teal-600 disabled:opacity-50">Actualizar límites del proveedor</button></details>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-steel-600">Los contadores de estas pestañas cuentan resultados de precios, no artículos propios únicos. «Sin cambios» no necesita aprobación.</p>
        {session.status === "open" && pendingPrices.length > 0 && <button disabled={deciding || isClosed} onClick={approveFiltered} className="rounded bg-success-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Aprobar {pendingPrices.length} precios filtrados</button>}
      </div>
      {(filter === "increased" || filter === "decreased") && (
        <p className="mb-3 text-xs text-steel-600">
          Mostrando precios de productos identificados. Incluye precios pendientes; excluye rechazados y errores de moneda o precio.
        </p>
      )}

      <div className="panel max-h-[70vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-steel-100 bg-steel-50 text-left text-xs font-medium text-steel-600">
            <tr>
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Precio anterior</th>
              <th className="px-3 py-2">Precio nuevo</th>
              <th className="px-3 py-2">Cambio</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-100">
            {visibleRows.map((row) => (
              <tr key={`${row.item.id}::${row.product?.id ?? "none"}`} className="hover:bg-steel-50">
                <td className="px-3 py-2"></td>
                <td className="max-w-xs truncate px-3 py-2 text-ink">
                  {row.product?.description ?? row.item.supplier_description}
                </td>
                <td className="mono-num px-3 py-2 text-steel-600">{row.product?.code ?? row.item.supplier_code}</td>
                <td className="mono-num px-3 py-2 text-steel-600">
                  {row.product ? formatPrice(row.change?.old_price ?? row.product.current_price, row.product.currency) : "—"}
                </td>
                <td className="mono-num px-3 py-2 text-ink">
                  {priceIssue(row.item, row.product) ? "Revisar precio" : priceOf(row) !== null ? formatPrice(priceOf(row)!, row.product?.currency ?? row.item.supplier_currency ?? "ARS") : "—"}
                </td>
                <td className="px-3 py-2">
                  <PriceDeltaBadge percent={row.change?.diff_percent ?? null} />
                </td>
                <td className="px-3 py-2"><ResultStatusBadge row={row} /></td>
                <td className="px-3 py-2 text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    {!isClosed && resultStatus(row) === "pending" && <button disabled={deciding} onClick={() => decide(row, "approved")} className="rounded bg-success-500 px-2 py-1 text-xs font-semibold text-white">Aprobar precio</button>}
                    {!isClosed && resultStatus(row) === "presentations" ? <button onClick={() => setPresentationReview({ initialItemId: row.item.id })} className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-600">Revisar cantidades</button> : <button onClick={() => setSelected(row)} className="rounded px-2 py-1 text-xs font-medium text-teal-600 hover:bg-steel-50">{!isClosed && resultStatus(row) === "identification" ? "Identificar" : "Ver detalle"}</button>}
                  </div>

                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-steel-600">No hay productos que coincidan con este filtro.</p>
        )}
        {visibleRows.length < filtered.length && (
          <div className="border-t border-steel-100 p-3 text-center">
            <button onClick={() => setVisibleCount(v => v + 300)} className="rounded border border-steel-200 px-4 py-2 text-xs font-semibold text-steel-700 hover:bg-steel-50">
              Mostrar 300 más · {visibleRows.length.toLocaleString("es-AR")} de {filtered.length.toLocaleString("es-AR")}
            </button>
          </div>
        )}
      </div>
        </>
      )}

      {selected && (
        <ProductDrawer
          session={session}
          row={selected}
          onClose={() => setSelected(null)}
          onPriceDecision={status => { void decide(selected, status).then(ok => { if (ok) setSelected(null); }); }}
          deciding={deciding}
          onResolved={() => {
            setSelected(null);
            load(true);
          }}
        />
      )}
    </div>
  );
}

function ResultStatusBadge({ row }: { row: ExportRow }) {
  const status = resultStatus(row);
  const labels = { identification: "Identidad pendiente", presentations: "Cantidades pendientes", price: "Precio / moneda con error", pending: "Listo para aprobar", approved: "Precio aprobado", unchanged: "Sin cambio de precio", rejected: "Precio rechazado", outside: row.item.match_state === "discontinued" ? "Discontinuado" : "Sin vínculo confirmado" };
  const tone = status === "approved" ? "bg-success-50 text-success-500" : ["identification", "presentations", "price"].includes(status) ? "bg-amber-50 text-amber-600" : status === "pending" ? "bg-teal-50 text-teal-600" : "bg-steel-50 text-steel-600";
  return <span className={clsx("inline-block rounded px-2 py-1 text-xs font-medium", tone)}>{labels[status]}</span>;
}

function priceOf(row: ExportRow): number | null {
  if (row.change) return row.change.final_new_price ?? row.change.new_price;
  const conversion = row.item.matched_presentations?.find(c => c.product_id === row.product?.id);
  return conversion && row.item.parsed_price !== null ? convertPresentationPrice(row.item.parsed_price, conversion.supplier_quantity, conversion.own_quantity) : row.item.parsed_price;
}
function nameOf(row: ExportRow): string {
  return row.product?.description ?? row.item.supplier_description;
}

function ProductDrawer({
  session,
  row,
  onClose,
  onResolved,
  onPriceDecision,
  deciding,
}: {
  session: ComparisonSession;
  row: ExportRow;
  onClose: () => void;
  onResolved: () => void;
  onPriceDecision: (status: "approved" | "rejected") => void;
  deciding: boolean;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("keydown", close); previous?.focus(); };
  }, [onClose]);
  const needsResolution = row.item.match_state !== "safe";
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/20" onClick={onClose}>
      <div ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Detalle de producto y precio" className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">
            {row.product?.description ?? row.item.supplier_description}
          </h2>
          <button aria-label="Cerrar detalle" onClick={onClose} className="text-steel-600 hover:text-ink">
            ✕
          </button>
        </div>

        <Section title="Producto interno">
          <Field label="Código" value={row.product?.code ?? "—"} />
          <Field label="Descripción" value={row.product?.description ?? "—"} />
          <Field label="Precio actual" value={row.product ? formatPrice(row.product.current_price) : "—"} />
        </Section>

        <Section title="Proveedor">
          <Field label="Código" value={row.item.supplier_code} />
          <Field label="Descripción" value={row.item.supplier_description} />
          <Field label="Precio original" value={row.item.parsed_price !== null ? formatPrice(row.item.parsed_price, row.item.supplier_currency ?? row.product?.currency ?? "ARS") : row.item.raw_price} />
          <Field label="Moneda proveedor" value={row.item.supplier_currency ?? "Según catálogo (lista anterior)"} />
          {priceIssue(row.item, row.product) && <p role="alert" className="rounded bg-danger-50 p-2 text-xs text-danger-500">{priceIssue(row.item, row.product)}</p>}
        </Section>

        {row.item.matched_presentations?.find(c => c.product_id === row.product?.id) && <Section title="Conversión aplicada">
          {(() => { const c = row.item.matched_presentations!.find(c => c.product_id === row.product?.id)!; return <p className="text-sm">Proveedor x{c.supplier_quantity} → propio x{c.own_quantity}: dividir por {Number((c.supplier_quantity / c.own_quantity).toPrecision(8))}</p>; })()}
        </Section>}
        <Section title="Identificación del producto">
          <Field label="Score" value={row.item.match_score !== null ? `${row.item.match_score.toFixed(0)}%` : "—"} />
          <Field label="Método" value={matchLevelLabel(row.item.match_level)} />
          <div className="space-y-1">
                    <MatchStateBadge state={row.item.match_state} />
                    {row.item.review_reason && ["review", "presentation_diff", "not_found"].includes(row.item.match_state) && <p className="max-w-xs text-xs text-steel-600">{row.item.review_reason}</p>}
                    {presentationReviewReason(row.item, row.product, row.change) && <p className="max-w-xs text-xs font-semibold text-amber-600">Revisar presentación</p>}
                    {priceIssue(row.item, row.product) ? <p className="max-w-xs text-xs font-medium text-danger-500">{priceIssue(row.item, row.product)}</p> : presentationReviewReason(row.item, row.product, row.change) ? <span className="block text-xs text-steel-600">Precio sin confirmar</span> : row.change?.diff_absolute === 0 ? <span className="block text-xs text-steel-600">Sin cambio de precio</span> : row.change ? <ChangeStatusBadge status={row.change.status} /> : row.product && row.item.match_state === "safe" ? <span className="block text-xs text-steel-600">Sin cambio de precio</span> : null}
                  </div>
        </Section>

        {row.change && (
          <Section title="Cambio">
            <Field label="Anterior" value={formatPrice(row.change.old_price)} />
            <Field label="Nuevo" value={formatPrice(row.change.final_new_price ?? row.change.new_price)} />
            <PriceDeltaBadge percent={row.change.diff_percent} />
            <ChangeStatusBadge status={row.change.status} />
          </Section>
        )}

        {session.status === "open" && row.change && <div className="mb-4 flex gap-2">{resultStatus(row) === "pending" && <button disabled={deciding} onClick={() => onPriceDecision("approved")} className="rounded bg-success-500 px-3 py-2 text-xs text-white">Aprobar precio</button>}{row.change.status !== "rejected" && <button disabled={deciding} onClick={() => onPriceDecision("rejected")} className="rounded bg-danger-50 px-3 py-2 text-xs text-danger-500">Rechazar precio</button>}{row.change.status === "rejected" && !priceIssue(row.item, row.product) && !presentationReviewReason(row.item, row.product, row.change) && <button disabled={deciding} onClick={() => onPriceDecision("approved")} className="rounded bg-success-500 px-3 py-2 text-xs text-white">Volver a aprobar</button>}</div>}
        {session.status === "open" && !needsResolution && <PresentationConversionEditor session={session} item={row.item} onResolved={onResolved} />}

        {session.status === "open" && needsResolution && (
          <MatchResolutionPanel session={session} item={row.item} suggestedProduct={row.product} onResolved={onResolved} />
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 border-b border-steel-100 pb-4">
      <p className="eyebrow mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-steel-600">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

function matchLevelLabel(level: PriceListItem["match_level"]): string {
  switch (level) {
    case "exact_code":
      return "Código exacto";
    case "normalized_code":
      return "Código normalizado";
    case "equivalence":
      return "Equivalencia histórica";
    case "code_prefix":
      return "Mismo código con/sin prefijo ET-";
    case "code_family":
      return "Familia de código (otra presentación)";
    case "description":
      return "Descripción (fuzzy)";
    default:
      return "Sin match";
  }
}


