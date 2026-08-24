import {
  comparisonSessionsRepo,
  discontinuedCodesRepo,
  equivalencesRepo,
  priceChangesRepo,
  priceListItemsRepo,
  productsRepo,
} from "./db";
import type { ComparisonSession, MatchState, PriceListItem } from "@/types/database";

const STATE_TO_COUNTER: Record<MatchState, keyof ComparisonSession | null> = {
  safe: "safe_matches",
  review: "review_items",
  not_found: "not_found_items",
  presentation_diff: "presentation_diff_items",
  discontinued: "discontinued_items",
  new_product: "new_products",
};

async function shiftCounter(session: ComparisonSession, from: MatchState, to: MatchState): Promise<ComparisonSession> {
  const updated = { ...session };
  const fromKey = STATE_TO_COUNTER[from];
  const toKey = STATE_TO_COUNTER[to];
  if (fromKey) (updated[fromKey] as number) = Math.max(0, (updated[fromKey] as number) - 1);
  if (toKey) (updated[toKey] as number) = (updated[toKey] as number) + 1;
  return updated;
}

/**
 * El usuario confirma que `productId` es el producto correcto para este ítem
 * (ya sea aceptando la sugerencia del algoritmo o eligiéndolo a mano en la
 * búsqueda manual). Un mismo producto puede terminar con varias equivalencias
 * — una por cada código/presentación de proveedor — y eso es intencional.
 */
export async function confirmMatch(session: ComparisonSession, item: PriceListItem, productId: string): Promise<void> {
  const product = await productsRepo.get(productId);
  if (!product) return;

  await equivalencesRepo.confirm(session.supplier_id, item.supplier_code, productId);

  const updatedItem: PriceListItem = {
    ...item,
    matched_product_id: productId,
    match_state: "safe",
    match_level: "equivalence",
  };
  await priceListItemsRepo.update(updatedItem);

  const updatedSession = await shiftCounter(session, item.match_state, "safe");

  if (item.parsed_price !== null) {
    const diff = Math.round((item.parsed_price - product.current_price) * 100) / 100;
    if (diff > 0) updatedSession.price_increases++;
    else if (diff < 0) updatedSession.price_decreases++;
    else updatedSession.price_unchanged++;

    if (diff !== 0) {
      const existing = (await priceChangesRepo.listBySession(session.id)).find(
        (c) => c.price_list_item_id === item.id
      );
      if (existing) {
        await priceChangesRepo.update({
          ...existing,
          old_price: product.current_price,
          new_price: item.parsed_price,
          diff_absolute: diff,
          diff_percent: product.current_price ? Math.round((diff / product.current_price) * 10000) / 100 : null,
        });
      } else {
        await priceChangesRepo.bulkCreate([
          {
            comparison_session_id: session.id,
            price_list_item_id: item.id,
            product_id: productId,
            old_price: product.current_price,
            new_price: item.parsed_price,
            final_new_price: null,
            old_currency: product.currency,
            new_currency: product.currency,
            diff_absolute: diff,
            diff_percent: product.current_price ? Math.round((diff / product.current_price) * 10000) / 100 : null,
            status: "pending",
            decided_at: null,
          },
        ]);
      }
    }
  }

  await comparisonSessionsRepo.update(updatedSession);
}

/** El usuario descarta el candidato sugerido: se recuerda para no volver a sugerirlo, y el ítem vuelve a "no encontrado" (para buscar a mano). */
export async function rejectSuggestion(session: ComparisonSession, item: PriceListItem): Promise<void> {
  if (item.matched_product_id) {
    await equivalencesRepo.reject(session.supplier_id, item.supplier_code, item.matched_product_id);
  }
  const updatedItem: PriceListItem = {
    ...item,
    matched_product_id: null,
    match_state: "not_found",
    match_level: "none",
    match_score: null,
  };
  await priceListItemsRepo.update(updatedItem);
  const updatedSession = await shiftCounter(session, item.match_state, "not_found");
  await comparisonSessionsRepo.update(updatedSession);
}

/** No existe ningún producto interno para este código — se recuerda para futuras listas del mismo proveedor. */
export async function markDiscontinued(session: ComparisonSession, item: PriceListItem): Promise<void> {
  await discontinuedCodesRepo.mark(session.supplier_id, item.supplier_code);
  const updatedItem: PriceListItem = {
    ...item,
    matched_product_id: null,
    match_state: "discontinued",
    match_level: "none",
    match_score: null,
  };
  await priceListItemsRepo.update(updatedItem);
  const updatedSession = await shiftCounter(session, item.match_state, "discontinued");
  await comparisonSessionsRepo.update(updatedSession);
}
