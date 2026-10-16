import { priceIssue } from "./pricePolicy";
import type { PriceChange, PriceListItem, Product, Supplier } from "@/types/database";

export function supplierPresentationLimits(supplier?: Pick<Supplier, "presentation_increase_percent" | "presentation_decrease_percent"> | null) {
  const increase = supplier?.presentation_increase_percent;
  const decrease = supplier?.presentation_decrease_percent;
  return { increase: typeof increase === "number" && Number.isFinite(increase) && increase > 0 ? increase : 100,
    decrease: typeof decrease === "number" && Number.isFinite(decrease) && decrease > 0 && decrease < 100 ? decrease : 50 };
}

/** Aviso, no deducción de cantidades: duplicación o reducción a la mitad.
 * Una relación confirmada (incluso 1:1) resuelve el aviso para esa fila. */
export function presentationReviewReason(item: PriceListItem, product: Product | null, change?: Pick<PriceChange, "old_price" | "new_price" | "final_new_price"> | null): string | null {
  if (item.match_state === "presentation_diff") return "El producto tiene una presentación distinta.";
  if (!product || item.match_state !== "safe" || item.matched_presentations?.length || priceIssue(item, product)) return null;
  const old = change?.old_price ?? product.current_price;
  const incoming = change ? change.final_new_price ?? change.new_price : item.parsed_price;
  if (!(old > 0) || incoming === null || incoming <= 0 || !Number.isFinite(old) || !Number.isFinite(incoming)) return null;
  const ratio = incoming / old;
  const increase = item.presentation_limits?.increase ?? 100, decrease = item.presentation_limits?.decrease ?? 50;
  return (ratio - 1) * 100 >= increase - 1e-8 || (1 - ratio) * 100 >= decrease - 1e-8 ? "Diferencia grande de precio: verificá si compara caja, pack o unidad." : null;
}
