import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { comparisonSessionsRepo, priceListItemsRepo, productsRepo } from "@/lib/db";
import MatchResolutionPanel from "@/components/MatchResolutionPanel";
import { MatchStateBadge } from "@/components/ui/StatusBadges";
import { formatPrice } from "@/lib/normalize";
import type { ComparisonSession, PriceListItem, Product } from "@/types/database";

export default function ReviewQueue() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<ComparisonSession | null>(null);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [productsById, setProductsById] = useState<Map<string, Product>>(new Map());
  const [index, setIndex] = useState(0);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const allItems = await priceListItemsRepo.listByPriceList(sessionData.price_list_id);
    const pending = allItems.filter((i) => ["review", "presentation_diff", "not_found"].includes(i.match_state));
    setItems(pending);

    const productIds = [...new Set(pending.map((i) => i.matched_product_id).filter(Boolean))] as string[];
    const products = await productsRepo.getMany(productIds);
    setProductsById(new Map(products.map((p) => [p.id, p])));

    setIndex(0);
    setLoading(false);
  }

  const current = items[index];
  const remaining = items.length - index;

  function advance() {
    setIndex((i) => Math.min(i + 1, items.length));
  }

  function skipForNow() {
    if (current) setSkipped((s) => new Set(s).add(current.id));
    advance();
  }

  async function handleResolved() {
    // El ítem resuelto ya no debería seguir en la cola — lo sacamos y no avanzamos
    // el índice (el siguiente ítem pasa a ocupar esta posición).
    if (!sessionId) return;
    const sessionData = await comparisonSessionsRepo.get(sessionId);
    setSession(sessionData ?? null);
    setItems((prev) => prev.filter((i) => i.id !== current?.id));
  }

  const skippedItems = useMemo(() => items.filter((i) => skipped.has(i.id)), [items, skipped]);

  if (loading) return <p className="text-sm text-steel-600">Cargando...</p>;
  if (!session) return <p className="text-sm text-danger-500">No se encontró la sesión.</p>;

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <p className="font-display text-lg font-semibold text-ink">No queda nada por revisar 🎉</p>
        <p className="mt-1 text-sm text-steel-600">Todos los ítems dudosos de esta comparación ya fueron resueltos.</p>
        <Link
          to={`/comparisons/${session.id}`}
          className="mt-4 inline-block rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600"
        >
          Volver a resultados
        </Link>
      </div>
    );
  }

  if (!current) {
    // Se terminó la cola (todo resuelto o dejado pendiente)
    return (
      <div className="mx-auto max-w-lg">
        <p className="font-display text-lg font-semibold text-ink">Terminaste la ronda</p>
        {skippedItems.length === 0 ? (
          <p className="mt-1 text-sm text-steel-600">No dejaste nada pendiente. Buen trabajo.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-steel-600">
              Dejaste {skippedItems.length} para después. Podés retomarlos ahora o más tarde desde acá.
            </p>
            <div className="panel mt-4 divide-y divide-steel-100">
              {skippedItems.map((it) => (
                <div key={it.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-ink">{it.supplier_description || it.supplier_code}</span>
                  <MatchStateBadge state={it.match_state} />
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                setItems(skippedItems);
                setSkipped(new Set());
                setIndex(0);
              }}
              className="mt-4 rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600"
            >
              Retomar los pendientes ahora
            </button>
          </>
        )}
        <div className="mt-3">
          <Link to={`/comparisons/${session.id}`} className="text-sm text-steel-600 hover:text-ink">
            ← Volver a resultados
          </Link>
        </div>
      </div>
    );
  }

  const suggestedProduct = current.matched_product_id ? productsById.get(current.matched_product_id) ?? null : null;

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate(`/comparisons/${session.id}`)} className="text-sm text-steel-600 hover:text-ink">
          ← Salir del panel
        </button>
        <span className="text-xs text-steel-300">
          {remaining} de {items.length}
        </span>
      </div>

      <div className="panel p-6">
        <MatchStateBadge state={current.match_state} />
        <h2 className="mt-3 font-display text-lg font-semibold text-ink">
          {current.supplier_description || "(sin descripción)"}
        </h2>
        <p className="mono-num mt-1 text-sm text-steel-600">
          Código proveedor: {current.supplier_code} · {current.parsed_price !== null ? formatPrice(current.parsed_price) : current.raw_price}
        </p>

        <div className="mt-5">
          <MatchResolutionPanel session={session} item={current} suggestedProduct={suggestedProduct} onResolved={handleResolved} />
        </div>

        <button
          onClick={skipForNow}
          className="mt-3 w-full rounded px-3 py-2 text-xs font-medium text-steel-600 hover:bg-steel-50"
        >
          Dejar para después →
        </button>
      </div>
    </div>
  );
}
