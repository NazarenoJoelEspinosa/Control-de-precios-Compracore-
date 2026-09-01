import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import clsx from "clsx";
import { comparisonSessionsRepo, priceChangesRepo, priceListItemsRepo, productsRepo } from "@/lib/db";
import { MatchStateBadge, PriceDeltaBadge } from "@/components/ui/StatusBadges";
import MatchResolutionPanel from "@/components/MatchResolutionPanel";
import { formatPrice } from "@/lib/normalize";
import { exportAllResults, exportApprovedOnly, type ExportRow } from "@/lib/exportResults";
import type { ComparisonSession, PriceChange, PriceListItem, Product } from "@/types/database";

type FilterKey =
  | "all"
  | "safe"
  | "review"
  | "not_found"
  | "new_product"
  | "presentation_diff"
  | "discontinued"
  | "increased"
  | "decreased";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "safe", label: "Coincidencias seguras" },
  { key: "review", label: "Revisar" },
  { key: "not_found", label: "No encontrados" },
  { key: "presentation_diff", label: "Presentación distinta" },
  { key: "discontinued", label: "Discontinuados" },
  { key: "increased", label: "Subieron" },
  { key: "decreased", label: "Bajaron" },
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

/** Un ítem cuenta como "asociado" (confiable) cuando su match está confirmado, no sólo sugerido. */
function isAssociated(row: ExportRow): boolean {
  return row.item.match_state === "safe";
}

export default function ResultsPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<ComparisonSession | null>(null);
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [catalogGaps, setCatalogGaps] = useState<Product[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [showCatalogGaps, setShowCatalogGaps] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("none");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ExportRow | null>(null);
  const [exporting, setExporting] = useState<"all" | "approved" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionId) load();
  }, [sessionId]);

  async function load() {
    if (!sessionId) return;
    setLoading(true);
    const sessionData = await comparisonSessionsRepo.get(sessionId);
    setSession(sessionData ?? null);
    if (!sessionData) {
      setLoading(false);
      return;
    }

    const items = await priceListItemsRepo.listByPriceList(sessionData.price_list_id);
    const changes = await priceChangesRepo.listBySession(sessionId);
    const productIds = [...new Set(items.map((i) => i.matched_product_id).filter(Boolean))] as string[];
    const products = await productsRepo.getMany(productIds);

    const productsById = new Map(products.map((p) => [p.id, p]));
    const changesByItem = new Map(changes.map((c) => [c.price_list_item_id, c]));

    const merged: ExportRow[] = items.map((item) => ({
      item,
      product: item.matched_product_id ? productsById.get(item.matched_product_id) ?? null : null,
      change: changesByItem.get(item.id) ?? null,
    }));

    setRows(merged);

    // Sentido inverso al de "no encontrados": de TU catálogo para este
    // proveedor, cuáles no aparecieron en absoluto en esta lista. Se deriva
    // en vivo de lo ya cargado — cualquier producto con al menos un ítem que
    // le haya quedado asociado (sea cual sea su match_state) cuenta como
    // "sí apareció".
    const catalogProducts = (await productsRepo.listBySupplier(sessionData.supplier_id)).filter((p) => p.active);
    const matchedProductIds = new Set(items.map((i) => i.matched_product_id).filter(Boolean) as string[]);
    setCatalogGaps(catalogProducts.filter((p) => !matchedProductIds.has(p.id)));
    setCatalogTotal(catalogProducts.length);

    setLoading(false);
  }

  const filtered = useMemo(() => {
    let result = rows.filter((row) => {
      if (filter === "increased") {
        return Boolean(row.change && row.change.diff_absolute > 0 && (row.change.status === "approved" || isAssociated(row)));
      }
      if (filter === "decreased") {
        return Boolean(row.change && row.change.diff_absolute < 0 && (row.change.status === "approved" || isAssociated(row)));
      }
      if (!["all", "increased", "decreased"].includes(filter) && row.item.match_state !== filter) return false;
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
  }, [rows, filter, search, sort]);

  // Igual que en la cola: "not_found" no cuenta como pendiente de revisión
  // porque no hay nada que decidir ahí — el proveedor tiene un artículo que
  // vos nunca cargaste a tu sistema. Esos se ven en la tarjeta/filtro "No
  // encontrados", no acá.
  const pendingReviewCount = rows.filter((r) => ["review", "presentation_diff"].includes(r.item.match_state)).length;

  async function decide(row: ExportRow, status: "approved" | "rejected") {
    if (!row.change) return;
    const updated: PriceChange = { ...row.change, status, decided_at: new Date().toISOString() };
    await priceChangesRepo.update(updated);
    load();
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="eyebrow">Comparación</p>
          <h1 className="font-display text-2xl font-semibold text-ink">
            {new Date(session.created_at).toLocaleDateString("es-AR")}
          </h1>
        </div>
        <div className="flex gap-2">
          {pendingReviewCount > 0 && (
            <Link
              to={`/comparisons/${session.id}/review`}
              className="rounded bg-amber-400 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600"
            >
              Revisar pendientes ({pendingReviewCount})
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

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-7">
        <MiniStat label="Analizados" value={session.total_items} hint="ítems de la lista del proveedor" />
        <MiniStat label="Seguros" value={session.safe_matches} tone="text-success-500" />
        <MiniStat label="Revisar" value={session.review_items} tone="text-amber-600" />
        <MiniStat
          label="Presentación distinta"
          value={session.presentation_diff_items}
          tone="text-amber-600"
          hint="mismo producto, otra presentación — también entra en 'Revisar pendientes'"
        />
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
      </div>

      {showCatalogGaps ? (
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-steel-100 bg-steel-50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink">
                Productos de tu catálogo que Protec no mencionó en esta lista
              </p>
              <p className="text-xs text-steel-600">
                Puede ser que este proveedor no los vendió esta vez, o que su código/descripción cambió lo suficiente
                como para que no se reconociera automáticamente. Revisalos a mano si te interesa.
              </p>
            </div>
            <button onClick={() => setShowCatalogGaps(false)} className="shrink-0 text-sm text-teal-600 hover:underline">
              ‹ Volver a los resultados
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-steel-100 text-left text-xs font-medium text-steel-600">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2">Precio actual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-steel-100">
              {catalogGaps.map((p) => (
                <tr key={p.id} className="hover:bg-steel-50">
                  <td className="mono-num px-3 py-2 text-steel-600">{p.code}</td>
                  <td className="px-3 py-2 text-ink">{p.description}</td>
                  <td className="mono-num px-3 py-2 text-ink">{formatPrice(p.current_price, p.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {catalogGaps.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-steel-600">
              Todo tu catálogo para este proveedor apareció en esta lista.
            </p>
          )}
        </div>
      ) : (
        <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={clsx(
              "rounded-full px-3 py-1 text-xs font-medium",
              filter === f.key ? "bg-teal-500 text-white" : "bg-white text-steel-600 hover:bg-steel-100"
            )}
          >
            {f.label}
          </button>
        ))}
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

      {(filter === "increased" || filter === "decreased") && (
        <p className="mb-3 text-xs text-steel-300">
          Mostrando sólo cambios ya aprobados o con match confirmado — los pendientes de revisión no cuentan acá
          todavía.
        </p>
      )}

      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-steel-100 bg-steel-50 text-left text-xs font-medium text-steel-600">
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
            {filtered.map((row) => (
              <tr key={row.item.id} className="hover:bg-steel-50">
                <td className="px-3 py-2"></td>
                <td className="max-w-xs truncate px-3 py-2 text-ink">
                  {row.product?.description ?? row.item.supplier_description}
                </td>
                <td className="mono-num px-3 py-2 text-steel-600">{row.product?.code ?? row.item.supplier_code}</td>
                <td className="mono-num px-3 py-2 text-steel-600">
                  {row.change ? formatPrice(row.change.old_price) : "—"}
                </td>
                <td className="mono-num px-3 py-2 text-ink">
                  {row.change ? formatPrice(row.change.final_new_price ?? row.change.new_price) : "—"}
                </td>
                <td className="px-3 py-2">
                  <PriceDeltaBadge percent={row.change?.diff_percent ?? null} />
                </td>
                <td className="mono-num px-3 py-2 text-steel-600">
                  {row.item.match_score !== null ? `${row.item.match_score.toFixed(0)}%` : "—"}
                </td>
                <td className="px-3 py-2">
                  <MatchStateBadge state={row.item.match_state} />
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    {row.change && row.change.status === "approved" && (
                      <button
                        onClick={() => decide(row, "rejected")}
                        className="rounded bg-danger-50 px-2 py-1 text-xs font-medium text-danger-500 hover:bg-danger-500 hover:text-white"
                      >
                        Rechazar
                      </button>
                    )}
                    {row.change && row.change.status === "rejected" && (
                      <button
                        onClick={() => decide(row, "approved")}
                        className="rounded bg-steel-100 px-2 py-1 text-xs font-medium text-steel-600 hover:bg-steel-200"
                      >
                        Reincluir
                      </button>
                    )}
                    <button
                      onClick={() => setSelected(row)}
                      className="rounded px-2 py-1 text-xs font-medium text-steel-600 hover:bg-steel-100"
                    >
                      Ver
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
            load();
          }}
        />
      )}
    </div>
  );
}

function priceOf(row: ExportRow): number | null {
  if (row.change) return row.change.final_new_price ?? row.change.new_price;
  return row.item.parsed_price;
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
        {hint && <span className="ml-1 text-steel-300">ⓘ</span>}
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
  const needsResolution = row.item.match_state !== "safe";
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/20" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">
            {row.product?.description ?? row.item.supplier_description}
          </h2>
          <button onClick={onClose} className="text-steel-300 hover:text-ink">
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
          <Field label="Precio" value={row.item.parsed_price !== null ? formatPrice(row.item.parsed_price) : row.item.raw_price} />
        </Section>

        <Section title="Matching">
          <Field label="Score" value={row.item.match_score !== null ? `${row.item.match_score.toFixed(0)}%` : "—"} />
          <Field label="Método" value={matchLevelLabel(row.item.match_level)} />
          <MatchStateBadge state={row.item.match_state} />
        </Section>

        {row.change && (
          <Section title="Cambio">
            <Field label="Anterior" value={formatPrice(row.change.old_price)} />
            <Field label="Nuevo" value={formatPrice(row.change.final_new_price ?? row.change.new_price)} />
            <PriceDeltaBadge percent={row.change.diff_percent} />
          </Section>
        )}

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
    case "code_family":
      return "Familia de código (otra presentación)";
    case "description":
      return "Descripción (fuzzy)";
    default:
      return "Sin match";
  }
}
