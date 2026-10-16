import { updateComparisonLimits } from "@/lib/updateComparisonLimits";
import { buildGapReasons, type GapReason } from "@/lib/gapReasons";
import { presentationReviewReason } from "@/lib/presentationReview";
import { matchesResultFilters, type ResultView, type ReviewKind, type ExtraFilter } from "@/lib/resultFilters";
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
  { key: "review", label: "Por revisar" }, { key: "pending", label: "Precios pendientes" },
  { key: "approved", label: "Aprobados" }, { key: "all", label: "Todos" },
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
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [catalogGaps, setCatalogGaps] = useState<Product[]>([]);
  const [ignoreEtPrefix, setIgnoreEtPrefix] = useState(false);
  const [gapReasons, setGapReasons] = useState<Record<string, GapReason>>({});
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [showCatalogGaps, setShowCatalogGaps] = useState(false);
  const [view, setView] = useState<ResultView>("all");
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
    const products = await productsRepo.getMany(productIds);

    const productsById = new Map(products.map((p) => [p.id, p]));
    const changesByPair = new Map(changes.map((c) => [`${c.price_list_item_id}::${c.product_id}`, c]));

    const merged: ExportRow[] = items.flatMap((item) => {
      const ids = item.matched_presentations?.map(c => c.product_id) ?? [item.matched_product_id];
      return ids.map(id => ({ item, product: id ? productsById.get(id) ?? null : null,
        change: changesByPair.get(`${item.id}::${id}`) ?? null }));
    });

    setRows(merged);

    // Sentido inverso al de "no encontrados": de TU catálogo para este
    // proveedor, cuáles no aparecieron en absoluto en esta lista. Se deriva
    // en vivo de lo ya cargado — cualquier producto con al menos un ítem que
    // le haya quedado asociado (sea cual sea su match_state) cuenta como
    // "sí apareció".
    const catalogProducts = (await productsRepo.listBySupplier(sessionData.supplier_id)).filter((p) => p.active);
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
  const pendingReviewCount = new Set(rows.filter((r) => ["review", "presentation_diff"].includes(r.item.match_state)).map(r => r.item.id)).size;

  const identifiedOwnCount = new Set(rows.filter(r => r.item.match_state === "safe" && r.product?.active).map(r => r.product!.id)).size;
  const presentationReviewCount = new Set(rows.filter(r => presentationReviewReason(r.item, r.product, r.change)).map(r => r.item.id)).size;
  const allReviewCount = new Set(rows.filter(r => matchesResultFilters(r, "review", "all", "all")).map(r => r.item.id)).size;

  const pendingPrices = filtered.filter(r => r.change && r.change.diff_absolute !== 0 && ["pending", "edited"].includes(r.change.status) && !priceIssue(r.item, r.product) && !presentationReviewReason(r.item, r.product, r.change));
  async function decide(row: ExportRow, status: "approved" | "rejected") {
    if (!row.change) return;
    setActionError(""); setDeciding(true);
    try { await decidePriceChange(row.change.id, status); await load(true); }
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

  async function refreshLimits() {
    if (!session || deciding) return;
    setDeciding(true); setActionError("");
    try { await updateComparisonLimits(session.id); await load(true); }
    catch (e) { setActionError(e instanceof Error ? e.message : "No se pudieron actualizar los límites."); }
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Comparación</p>
          <h1 className="font-display text-2xl font-semibold text-ink">
            {new Date(session.created_at).toLocaleDateString("es-AR")}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {presentationReviewCount > 0 && <button onClick={() => setPresentationReview({})} className="rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white">Revisar presentaciones ({presentationReviewCount})</button>}
          {catalogGaps.length > 0 && (
            <button
              onClick={() => setShowCatalogGaps(true)}
              className="rounded bg-violet-500 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-500/90"
            >
              Encontrar los {catalogGaps.length} de mi catálogo
            </button>
          )}
          {pendingReviewCount > 0 && (
            <Link
              to={`/comparisons/${session.id}/review`}
              className="rounded border border-steel-200 px-3 py-2 text-sm font-medium text-steel-600 hover:bg-steel-50"
            >
              Revisar identificación ({pendingReviewCount})
            </Link>
          )}
          <button
            onClick={async () => {
              setExporting("all");
              await exportAllResults(rows, `pricecore-resultados-${session.id.slice(0, 8)}.xlsx`);
              setExporting(null);
            }}
            disabled={exporting !== null}
            className="rounded border border-steel-200 px-3 py-2 text-sm font-medium text-steel-600 hover:bg-steel-50 disabled:opacity-60"
          >
            {exporting === "all" ? "Generando..." : "Exportar todo"}
          </button>
          <button
            onClick={async () => {
              setExporting("approved");
              await exportApprovedOnly(rows, `pricecore-aprobados-${session.id.slice(0, 8)}.xlsx`);
              setExporting(null);
            }}
            disabled={exporting !== null}
            className="rounded bg-teal-500 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-60"
          >
            {exporting === "approved" ? "Generando..." : "Exportar solo aprobados"}
          </button>
          <button
            onClick={handleDeleteSession}
            className="rounded border border-danger-500 px-3 py-2 text-sm font-medium text-danger-500 hover:bg-danger-50"
          >
            Eliminar
          </button>
        </div>
      </div>

      <details className="mb-4 text-xs text-steel-600"><summary className="cursor-pointer">Datos de la lista del proveedor · {session.total_items.toLocaleString("es-AR")} filas</summary><div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-7">
        <MiniStat label="Filas del proveedor" value={session.total_items} hint="ítems de la lista del proveedor" />
        <MiniStat label="Productos identificados" value={session.safe_matches} tone="text-success-500" />
        <MiniStat label="Por revisar" value={allReviewCount} tone="text-amber-600" />
        <button onClick={() => setPresentationReview({})} className="text-left"><MiniStat
          label="Presentaciones a revisar" value={presentationReviewCount} tone="text-amber-600"
          hint="incluye diferencias grandes de precio: suba desde 100% o baja desde 50%, sin relación confirmada" clickable
        /></button>
        <MiniStat
          label="No encontrados"
          value={session.not_found_items}
          tone="text-danger-500"
          hint="de SU lista, sin equivalente en tu catálogo"
        />
        <MiniStat label="Discontinuados" value={session.discontinued_items} tone="text-steel-600" />
        <button onClick={() => setShowCatalogGaps((v) => !v)} className="text-left">
          <MiniStat
            label="De tu catálogo, no en su lista"
            value={catalogGaps.length}
            tone="text-violet-500"
            hint={`de ${catalogTotal.toLocaleString("es-AR")} productos tuyos`}
            clickable
          />
        </button>
      </div></details>

      <section aria-label="Avance de la comparación" className="panel mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold">Tu avance</h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <button onClick={() => { setPresentationReview(null); setShowCatalogGaps(false); setView("all"); setFilter("safe"); setSearch(""); setReviewKind("all"); }} className="rounded bg-steel-50 p-3 text-left text-xs"><strong className="mono-num block text-xl">{identifiedOwnCount}</strong>artículos propios identificados</button>
          <button onClick={() => setPresentationReview({})} className="rounded bg-amber-50 p-3 text-left text-xs"><strong className="mono-num block text-xl">{presentationReviewCount}</strong>presentaciones por revisar</button>
          <button onClick={() => { setPresentationReview(null); setShowCatalogGaps(true); }} className="rounded bg-violet-50 p-3 text-left text-xs"><strong className="mono-num block text-xl">{catalogGaps.length}</strong>faltantes de mi catálogo</button>
          <button onClick={() => { setPresentationReview(null); setShowCatalogGaps(false); setView("pending"); setFilter("all"); setSearch(""); }} className="rounded bg-teal-50 p-3 text-left text-xs"><strong className="mono-num block text-xl">{rows.filter(r => matchesResultFilters(r, "pending", "all", "all")).length}</strong>precios listos para aprobar</button>
          <button onClick={() => { setPresentationReview(null); setShowCatalogGaps(false); setView("approved"); setFilter("all"); setSearch(""); }} className="rounded bg-steel-50 p-3 text-left text-xs"><strong className="mono-num block text-xl">{rows.filter(r => matchesResultFilters(r, "approved", "all", "all")).length}</strong>precios aprobados</button>
        </div>
        <div className="mt-3"><label htmlFor="catalog-progress" className="mb-1 block text-xs text-steel-600">Catálogo identificado: {catalogTotal ? Math.round(identifiedOwnCount / catalogTotal * 100) : 0}% · {identifiedOwnCount} de {catalogTotal} artículos propios. Una fila del proveedor puede identificar varias presentaciones.</label><progress id="catalog-progress" max={Math.max(1, catalogTotal)} value={identifiedOwnCount} className="h-2 w-full accent-teal-500" /></div>
        <details className="mt-2 text-xs text-steel-600"><summary className="cursor-pointer">Límites de los avisos de precio</summary><p className="mt-2">Esta comparación avisa desde +{rows[0]?.item.presentation_limits?.increase ?? 100}% / −{rows[0]?.item.presentation_limits?.decrease ?? 50}%. Podés editar los límites en la ficha del proveedor y aplicarlos aquí.</p><button disabled={deciding} onClick={refreshLimits} className="mt-2 rounded border border-steel-200 px-3 py-2 text-teal-600 disabled:opacity-50">Actualizar límites del proveedor</button></details>
      </section>

      {presentationReview ? (
        <PresentationReview key={`${session.id}:${restoreEpoch}`} session={session} rows={rows} initialItemId={presentationReview.initialItemId} onRefresh={() => load(true)} onClose={() => setPresentationReview(null)} />
      ) : showCatalogGaps ? (
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
        {view === "review" && <label className="text-xs text-steel-600">Tipo de revisión <select aria-label="Tipo de revisión" value={reviewKind} onChange={e => setReviewKind(e.target.value as ReviewKind)} className="field-control ml-1"><option value="all">Todos los motivos</option><option value="presentations">Presentaciones</option><option value="identification">Identificación del producto</option><option value="price">Errores de precio / moneda</option></select></label>}
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
        <details className="text-xs text-steel-600"><summary className="cursor-pointer">Más filtros{filter !== "all" ? " · 1 activo" : ""}</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2"><select aria-label="Filtro adicional" value={filter} onChange={e => setFilter(e.target.value as ExtraFilter)} className="field-control max-w-full">{EXTRA_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select>{filter !== "all" && <button onClick={() => setFilter("all")} className="text-teal-600">Quitar filtro adicional</button>}<span>Se combina con la pestaña y la búsqueda actuales.</span></div>
        </details>
        {view === "review" && reviewKind === "presentations" && <button onClick={() => setPresentationReview({})} className="rounded bg-amber-600 px-3 py-2 text-xs font-semibold text-white">Abrir revisión continua de presentaciones</button>}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-steel-600">Las coincidencias cuentan filas del proveedor. Los precios cuentan tus artículos, incluidas sus presentaciones.</p>
        {pendingPrices.length > 0 && <button disabled={deciding} onClick={approveFiltered} className="rounded bg-success-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Aprobar {pendingPrices.length} precios filtrados</button>}
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
              <th className="px-3 py-2">Match</th>
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
                <td className="mono-num px-3 py-2 text-steel-600">
                  {row.item.match_score !== null ? `${row.item.match_score.toFixed(0)}%` : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="space-y-1">
                    <MatchStateBadge state={row.item.match_state} />
                    {row.item.review_reason && ["review", "presentation_diff", "not_found"].includes(row.item.match_state) && <p className="max-w-xs text-xs text-steel-600">{row.item.review_reason}</p>}
                    {presentationReviewReason(row.item, row.product, row.change) && <p className="max-w-xs text-xs font-semibold text-amber-600">Revisar presentación</p>}
                    {priceIssue(row.item, row.product) ? <p className="max-w-xs text-xs font-medium text-danger-500">{priceIssue(row.item, row.product)}</p> : presentationReviewReason(row.item, row.product, row.change) ? <span className="block text-xs text-steel-600">Precio sin confirmar</span> : row.change?.diff_absolute === 0 ? <span className="block text-xs text-steel-600">Sin cambio de precio</span> : row.change ? <ChangeStatusBadge status={row.change.status} /> : row.product && row.item.match_state === "safe" ? <span className="block text-xs text-steel-600">Sin cambio de precio</span> : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    {row.change && row.change.status !== "rejected" && (
                      <button
                        disabled={deciding}
                        onClick={() => decide(row, "rejected")}
                        className="rounded bg-danger-50 px-2 py-1 text-xs font-medium text-danger-500 hover:bg-danger-500 hover:text-white"
                      >
                        Rechazar
                      </button>
                    )}
                    {row.change && row.change.diff_absolute !== 0 && ["pending", "edited"].includes(row.change.status) && !priceIssue(row.item, row.product) && !presentationReviewReason(row.item, row.product, row.change) && <button disabled={deciding} onClick={() => decide(row, "approved")} className="rounded bg-success-500 px-2 py-1 text-xs font-medium text-white">Aprobar precio</button>}
                    {row.change && row.change.status === "rejected" && !priceIssue(row.item, row.product) && !presentationReviewReason(row.item, row.product, row.change) && (
                      <button
                        onClick={() => decide(row, "approved")}
                        className="rounded bg-steel-100 px-2 py-1 text-xs font-medium text-steel-600 hover:bg-steel-200"
                      >
                        Aprobar precio
                      </button>
                    )}
                    {(row.product || row.item.match_state === "presentation_diff") && <button onClick={() => setPresentationReview({ initialItemId: row.item.id })} className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-600">{presentationReviewReason(row.item, row.product, row.change) ? "Revisar presentación" : "Enseñar presentación"}</button>}
                    <button
                      onClick={() => setSelected(row)}
                      className="rounded px-2 py-1 text-xs font-medium text-steel-600 hover:bg-steel-100"
                    >
                      Revisar detalle
                    </button>
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
          onResolved={() => {
            setSelected(null);
            load(true);
          }}
        />
      )}
    </div>
  );
}

function priceOf(row: ExportRow): number | null {
  if (row.change) return row.change.final_new_price ?? row.change.new_price;
  const conversion = row.item.matched_presentations?.find(c => c.product_id === row.product?.id);
  return conversion && row.item.parsed_price !== null ? convertPresentationPrice(row.item.parsed_price, conversion.supplier_quantity, conversion.own_quantity) : row.item.parsed_price;
}
function nameOf(row: ExportRow): string {
  return row.product?.description ?? row.item.supplier_description;
}

function MiniStat({
  label,
  value,
  tone,
  hint,
  clickable,
}: {
  label: string;
  value: number;
  tone?: string;
  hint?: string;
  clickable?: boolean;
}) {
  return (
    <div className={clsx("panel p-3", clickable && "cursor-pointer transition hover:border-teal-500")} title={hint}>
      <p className="text-xs text-steel-600">
        {label}
        {hint && <span className="ml-1 text-steel-600">ⓘ</span>}
      </p>
      <p className={clsx("mono-num text-xl font-semibold", tone ?? "text-ink")}>{value.toLocaleString("es-AR")}</p>
    </div>
  );
}

function ProductDrawer({
  session,
  row,
  onClose,
  onResolved,
}: {
  session: ComparisonSession;
  row: ExportRow;
  onClose: () => void;
  onResolved: () => void;
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

        {!needsResolution && <PresentationConversionEditor session={session} item={row.item} onResolved={onResolved} />}

        {needsResolution && (
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

