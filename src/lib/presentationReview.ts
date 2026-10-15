import { priceIssue } from "./pricePolicy";
import type { PriceChange, PriceListItem, Product } from "@/types/database";

/** Aviso, no deducción de cantidades: duplicación o reducción a la mitad.
 * Una relación confirmada (incluso 1:1) resuelve el aviso para esa fila. */
export function presentationReviewReason(item: PriceListItem, product: Product | null, change?: Pick<PriceChange, "old_price" | "new_price" | "final_new_price"> | null): string | null {
  if (item.match_state === "presentation_diff") return "El producto tiene una presentación distinta.";
  if (!product || item.match_state !== "safe" || item.matched_presentations?.length || priceIssue(item, product)) return null;
  const old = change?.old_price ?? product.current_price;
  const incoming = change ? change.final_new_price ?? change.new_price : item.parsed_price;
  if (!(old > 0) || incoming === null || incoming <= 0 || !Number.isFinite(old) || !Number.isFinite(incoming)) return null;
  const ratio = incoming / old;
  return ratio >= 2 || ratio <= 0.5 ? "Diferencia grande de precio: verificá si compara caja, pack o unidad." : null;
}
