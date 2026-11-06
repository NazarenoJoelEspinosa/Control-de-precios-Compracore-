import { useEffect, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { comparisonSessionsRepo, priceListItemsRepo, productsRepo, equivalencesRepo, discontinuedCodesRepo, suppliersRepo } from "@/lib/db";
import CatalogIdentificationReview from "./CatalogIdentificationReview";
import type { ComparisonSession, PriceListItem, Product, Equivalence, DiscontinuedCode } from "@/types/database";

export default function ReviewQueue() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState<ComparisonSession | null>(null);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [equivalences, setEquivalences] = useState<Equivalence[]>([]);
  const [discontinued, setDiscontinued] = useState<DiscontinuedCode[]>([]);
  const [ignorePrefix, setIgnorePrefix] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    if (!sessionId) return;
    try {
      const current = await comparisonSessionsRepo.get(sessionId); setSession(current ?? null);
      if (!current) return;
      const [source, catalog, memory, stopped, supplier] = await Promise.all([
        priceListItemsRepo.listByPriceList(current.price_list_id), productsRepo.listBySupplier(current.supplier_id),
        equivalencesRepo.listForSupplier(current.supplier_id), discontinuedCodesRepo.listForSupplier(current.supplier_id), suppliersRepo.get(current.supplier_id),
      ]);
      const identified = new Set(source.filter(i => i.match_state === "safe").flatMap(i => i.matched_presentations?.map(c => c.product_id) ?? [i.matched_product_id]));
      setProducts(catalog.filter(p => p.active && !identified.has(p.id)));
      setItems(source); setEquivalences(memory); setDiscontinued(stopped); setIgnorePrefix(supplier?.ignore_et_prefix === true); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar tu catálogo."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); const restored = () => { void load(); }; window.addEventListener("pricecore:restored", restored); return () => window.removeEventListener("pricecore:restored", restored); }, [sessionId]);
  if (loading) return <p>Cargando tu catálogo…</p>;
  if (error) return <p role="alert" className="text-danger-500">{error}</p>;
  if (!session) return <p>No se encontró la comparación.</p>;
  if (session.status === "closed") return <p>Esta comparación está finalizada. <Link to={`/comparisons/${session.id}`}>Ver resultados</Link></p>;
  return <CatalogIdentificationReview session={session} products={products} items={items} equivalences={equivalences} discontinued={discontinued} ignoreEtPrefix={ignorePrefix} initialProductId={searchParams.get("productId") ?? undefined} onRefresh={load} onClose={() => navigate(`/comparisons/${session.id}`)} />;
}
