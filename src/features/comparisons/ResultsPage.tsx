import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import clsx from "clsx";
import { comparisonSessionsRepo, equivalencesRepo, priceChangesRepo, priceListItemsRepo, productsRepo } from "@/lib/db";
import { MatchStateBadge, PriceDeltaBadge } from "@/components/ui/StatusBadges";
import { formatPrice } from "@/lib/normalize";
import { exportAllResults, exportApprovedOnly, type ExportRow } from "@/lib/exportResults";
import type { ComparisonSession, PriceChange, PriceListItem, Product } from "@/types/database";

type FilterKey = "all" | "safe" | "review" | "not_found" | "new_product" | "presentation_diff" | "increased" | "decreased";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "safe", label: "Coincidencias seguras" },
  { key: "review", label: "Revisar" },
  { key: "not_found", label: "No encontrados" },
  { key: "new_product", label: "Nuevos" },
  { key: "presentation_diff", label: "Presentación distinta" },
  { key: "increased", label: "Subieron" },
  { key: "decreased", label: "Bajaron" },
];

export default function ResultsPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<ComparisonSession | null>(null);
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ExportRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (filter === "increased" && !(row.change && row.change.diff_absolute > 0)) return false;
      if (filter === "decreased" && !(row.change && row.change.diff_absolute < 0)) return false;
      if (!["all", "increased", "decreased"].includes(filter) && row.item.match_state !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        const haystack = `${row.item.supplier_code} ${row.item.supplier_description} ${row.product?.code ?? ""} ${row.product?.description ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  async function decide(row: ExportRow, status: "approved" | "rejected") {
    if (!row.change) return;
    const updated: PriceChange = { ...row.change, status, decided_at: new Date().toISOString() };
    await priceChangesRepo.update(updated);
    load();
  }

  async function bulkApprove() {
    if (selectedIds.size === 0) return;
    const toUpdate = rows
      .filter((r) => selectedIds.has(r.item.id) && r.change)
      .map((r) => ({ ...r.change!, status: "approved" as const, decided_at: new Date().toISOString() }));
    if (toUpdate.length === 0) return;
    if (!window.confirm(`¿Aprobar ${toUpdate.length} cambios de precio?`)) return;
    await priceChangesRepo.updateMany(toUpdate);
    setSelectedIds(new Set());
    load();
  }

  async function confirmMatch(row: ExportRow, productId: string) {
    if (!session) return;
    await equivalencesRepo.confirm(session.supplier_id, row.item.supplier_code, productId);
    await priceListItemsRepo.update({
      ...row.item,
      matched_product_id: productId,
      match_state: "safe",
      match_level: "equivalence",
    });
    setSelected(null);
    load();
  }

  async function rejectMatch(row: ExportRow) {
    if (!session || !row.item.matched_product_id) return;
    await equivalencesRepo.reject(session.supplier_id, row.item.supplier_code, row.item.matched_product_id);
    await priceListItemsRepo.update({
      ...row.item,
      matched_product_id: null,
      match_state: "not_found",
      match_level: "none",
      match_score: null,
    });
    setSelected(null);
    load();
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
          <button
            onClick={() => exportAllResults(rows, `pricecore-resultados-${session.id.slice(0, 8)}.xlsx`)}
            className="rounded border border-steel-200 px-3 py-2 text-sm font-medium text-steel-600 hover:bg-steel-50"
          >
            Exportar todo
          </button>
          <button
            onClick={() => exportApprovedOnly(rows, `pricecore-aprobados-${session.id.slice(0, 8)}.xlsx`)}
            className="rounded bg-teal-500 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-600"
          >
            Exportar solo aprobados
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Analizados" value={session.total_items} />
        <MiniStat label="Seguros" value={session.safe_matches} tone="text-success-500" />
        <MiniStat label="Revisar" value={session.review_items} tone="text-amber-600" />
        <MiniStat label="No encontrados" value={session.not_found_items} tone="text-danger-500" />
      </div>

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
        <input
          placeholder="Buscar código o descripción..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto rounded border border-steel-200 px-3 py-1.5 text-sm focus:border-teal-500"
        />
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded bg-teal-50 px-4 py-2 text-sm">
          <span className="text-teal-600">{selectedIds.size} seleccionados</span>
          <button onClick={bulkApprove} className="rounded bg-teal-500 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-600">
            Aprobar seleccionados
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-steel-600 hover:text-ink">
            Limpiar selección
          </button>
        </div>
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
                <td className="px-3 py-2">
                  {row.change && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.item.id)}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(row.item.id);
                        else next.delete(row.item.id);
                        setSelectedIds(next);
                      }}
                    />
                  )}
                </td>
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
                    {row.change && row.change.status === "pending" && (
                      <>
                        <button
                          onClick={() => decide(row, "approved")}
                          className="rounded bg-success-50 px-2 py-1 text-xs font-medium text-success-500 hover:bg-success-500 hover:text-white"
                        >
                          Aprobar
                        </button>
                        <button
                          onClick={() => decide(row, "rejected")}
                          className="rounded bg-danger-50 px-2 py-1 text-xs font-medium text-danger-500 hover:bg-danger-500 hover:text-white"
                        >
                          Rechazar
                        </button>
                      </>
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

      {selected && (
        <ProductDrawer
          row={selected}
          onClose={() => setSelected(null)}
          onConfirmMatch={confirmMatch}
          onRejectMatch={rejectMatch}
        />
      )}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="panel p-3">
      <p className="text-xs text-steel-600">{label}</p>
      <p className={clsx("mono-num text-xl font-semibold", tone ?? "text-ink")}>{value.toLocaleString("es-AR")}</p>
    </div>
  );
}

function ProductDrawer({
  row,
  onClose,
  onConfirmMatch,
  onRejectMatch,
}: {
  row: ExportRow;
  onClose: () => void;
  onConfirmMatch: (row: ExportRow, productId: string) => void;
  onRejectMatch: (row: ExportRow) => void;
}) {
  const needsReview = row.item.match_state === "review" || row.item.match_state === "presentation_diff";
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

        {needsReview && row.item.matched_product_id && (
          <div className="mt-2 space-y-2 rounded bg-steel-50 p-3">
            <p className="text-xs text-steel-600">
              ¿Es este el producto correcto? Tu decisión se guarda en el diccionario de equivalencias y se aplica
              automáticamente la próxima vez que aparezca este código de proveedor.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => onConfirmMatch(row, row.item.matched_product_id!)}
                className="flex-1 rounded bg-success-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-success-500/90"
              >
                Sí, es el mismo producto
              </button>
              <button
                onClick={() => onRejectMatch(row)}
                className="flex-1 rounded bg-danger-50 px-3 py-1.5 text-xs font-semibold text-danger-500 hover:bg-danger-500 hover:text-white"
              >
                No, son distintos
              </button>
            </div>
          </div>
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
    case "description":
      return "Descripción (fuzzy)";
    default:
      return "Sin match";
  }
}
