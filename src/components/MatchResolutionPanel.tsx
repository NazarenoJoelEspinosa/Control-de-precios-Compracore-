import PresentationConversionEditor from "./PresentationConversionEditor";
import { useEffect, useState } from "react";
import { productsRepo, settingsRepo } from "@/lib/db";
import { confirmMatch, markDiscontinued, rejectSuggestion } from "@/lib/reviewActions";
import { formatPrice } from "@/lib/normalize";
import { buildProductIndexEntry, scoreDescription } from "@/lib/matching";
import type { ComparisonSession, PriceListItem, Product } from "@/types/database";

export default function MatchResolutionPanel({
  session,
  item,
  suggestedProduct,
  onResolved,
}: {
  session: ComparisonSession;
  item: PriceListItem;
  /** Producto que sugirió el algoritmo, si hay uno (null si es "no encontrado" puro). */
  suggestedProduct: Product | null;
  onResolved: () => void;
}) {
  const [teaching, setTeaching] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<{ product: Product; score: number }[] | null>(null);

  // Para "no encontrado" no hay ninguna sugerencia del algoritmo — en vez de
  // mandar directo a una caja de búsqueda vacía, calculamos acá mismo los
  // candidatos más parecidos por descripción (aunque su score haya quedado
  // por debajo del umbral de revisión) para dar un punto de partida.
  useEffect(() => {
    if (suggestedProduct) {
      setSimilar(null);
      return;
    }
    let cancelled = false;
    Promise.all([productsRepo.listBySupplier(session.supplier_id), settingsRepo.get()]).then(([catalog, settings]) => {
      if (cancelled) return;
      if (settings.enable_description === false) { setSimilar([]); return; }
      const queryText = [item.supplier_description, item.supplier_brand, item.supplier_unit].filter(Boolean).join(" ");
      const scored = catalog
        .filter((p) => p.active)
        .map((p) => {
          const entry = buildProductIndexEntry(p);
          return { product: p, score: scoreDescription(queryText, entry.text, entry.tokenSet, entry.trigramSet) };
        })
        .filter((c) => c.score >= 25) // por debajo de esto ya no aporta, sería ruido
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      setSimilar(scored);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedProduct, item.id, session.supplier_id]);

  async function handleSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setResults(await productsRepo.search(session.supplier_id, q));
  }

  async function handleConfirm(productId: string) {
    setBusy(true);
    setError("");
    try { await confirmMatch(session, item, productId); onResolved(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo confirmar."); }
    finally { setBusy(false); }
  }

  async function handleReject() {
    setBusy(true);
    setError("");
    try { await rejectSuggestion(session, item); setSearching(true); onResolved(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo rechazar."); }
    finally { setBusy(false); }
  }

  async function handleDiscontinued() {
    if (!window.confirm("¿Marcar este código como discontinuado? No se va a volver a preguntar por él con este proveedor.")) return;
    setBusy(true);
    setError("");
    try { await markDiscontinued(session, item); onResolved(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }

  // Atajos de teclado — sólo cuando hay una sugerencia visible (no mientras
  // se está escribiendo en el buscador, para no interferir con lo que tipeás).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (isTyping || busy || teaching) return;
      if (!suggestedProduct || searching) return;

      const key = e.key.toLowerCase();
      if (e.key === "Enter" || key === "y") {
        e.preventDefault();
        handleConfirm(suggestedProduct.id);
      } else if (key === "n") {
        e.preventDefault();
        handleReject();
      } else if (key === "d") {
        e.preventDefault();
        handleDiscontinued();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedProduct, searching, busy, teaching]);

  return (
    <div className="space-y-3 rounded bg-steel-50 p-3">
      {error && <p role="alert" className="text-xs text-danger-500">{error}</p>}
      <details onToggle={e => setTeaching(e.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-semibold text-teal-600">Vendo este producto en otra presentación / varias presentaciones</summary>
        {teaching && <PresentationConversionEditor session={session} item={item} onResolved={onResolved} />}
      </details>
      {!teaching && suggestedProduct && !searching && (
        <>
          <p className="text-xs text-steel-600">¿Es este el producto correcto? Confirmarlo deja su precio pendiente de aprobación.</p>
          <div className="rounded border border-steel-200 bg-white p-2 text-sm">
            <p className="font-medium text-ink">{suggestedProduct.description}</p>
            <p className="mono-num text-xs text-steel-600">
              {suggestedProduct.code} · {formatPrice(suggestedProduct.current_price, suggestedProduct.currency)}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => handleConfirm(suggestedProduct.id)}
              className="flex-1 rounded bg-success-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-success-500/90 disabled:opacity-60"
            >
              Confirmar producto <span className="opacity-70">(Enter)</span>
            </button>
            <button
              disabled={busy}
              onClick={handleReject}
              className="flex-1 rounded bg-danger-50 px-3 py-1.5 text-xs font-semibold text-danger-500 hover:bg-danger-500 hover:text-white disabled:opacity-60"
            >
              No, buscar otro <span className="opacity-70">(N)</span>
            </button>
          </div>
          <p className="text-center text-xs text-steel-600">Atajos: Enter = sí · N = buscar otro · D = discontinuado</p>
        </>
      )}

      {!teaching && (!suggestedProduct || searching) && (
        <>
          {!suggestedProduct && similar && similar.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-steel-600">Quizás sea alguno de estos:</p>
              {similar.map(({ product: p }) => (
                <button
                  key={p.id}
                  disabled={busy}
                  onClick={() => handleConfirm(p.id)}
                  className="block w-full rounded border border-steel-200 bg-white p-2 text-left text-sm hover:border-teal-500 hover:bg-teal-50 disabled:opacity-60"
                >
                  <p className="font-medium text-ink">{p.description}</p>
                  <p className="mono-num text-xs text-steel-600">
                    {p.code} · {formatPrice(p.current_price, p.currency)}
                  </p>
                </button>
              ))}
            </div>
          )}
          {!suggestedProduct && similar && similar.length === 0 && (
            <p className="text-xs text-steel-600">No encontramos nada parecido por descripción — buscá a mano:</p>
          )}
          <p className="text-xs text-steel-600">Buscá en el catálogo de este proveedor por código o descripción:</p>
          <input
            autoFocus
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Ej: disco corte, 4587..."
            className="w-full rounded border border-steel-200 px-3 py-1.5 text-sm focus:border-teal-500"
          />
          {results.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {results.map((p) => (
                <button
                  key={p.id}
                  disabled={busy}
                  onClick={() => handleConfirm(p.id)}
                  className="block w-full rounded border border-steel-200 bg-white p-2 text-left text-sm hover:border-teal-500 hover:bg-teal-50 disabled:opacity-60"
                >
                  <p className="font-medium text-ink">{p.description}</p>
                  <p className="mono-num text-xs text-steel-600">
                    {p.code} · {formatPrice(p.current_price, p.currency)}
                  </p>
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && results.length === 0 && (
            <p className="text-xs text-steel-600">No encontramos nada con ese texto en el catálogo.</p>
          )}
        </>
      )}

      <button
        disabled={busy}
        onClick={handleDiscontinued}
        className="w-full rounded border border-steel-200 px-3 py-1.5 text-xs font-medium text-steel-600 hover:bg-steel-100 disabled:opacity-60"
      >
        No existe / producto discontinuado
      </button>
    </div>
  );
}
