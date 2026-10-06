import type { ComparisonSession, PriceChange, PriceListItem, Product } from "@/types/database";
import { priceIssue } from "./pricePolicy";
import { convertPresentationPrice } from "./presentationConversions";

type Change = Pick<PriceChange, "price_list_item_id" | "product_id" | "diff_absolute" | "status">;
export function comparisonStats(items: PriceListItem[], changes: Change[], products: Product[]): Pick<ComparisonSession,
  "total_items" | "safe_matches" | "review_items" | "not_found_items" | "new_products" | "presentation_diff_items" | "discontinued_items" | "price_increases" | "price_decreases" | "price_unchanged" | "approved_changes"> {
  const stats = { total_items: items.length, safe_matches: 0, review_items: 0, not_found_items: 0, new_products: 0, presentation_diff_items: 0, discontinued_items: 0,
    price_increases: 0, price_decreases: 0, price_unchanged: 0, approved_changes: 0 };
  const counters = { safe: "safe_matches", review: "review_items", not_found: "not_found_items", new_product: "new_products", presentation_diff: "presentation_diff_items", discontinued: "discontinued_items" } as const;
  const byId = new Map(products.map(p => [p.id, p]));
  const byPair = new Map(changes.map(c => [`${c.price_list_item_id}::${c.product_id}`, c]));
  for (const item of items) {
    stats[counters[item.match_state]]++;
    if (item.match_state !== "safe") continue;
    const ids = item.matched_presentations?.map(c => c.product_id) ?? [item.matched_product_id];
    for (const id of ids) {
      const product = id ? byId.get(id) : null;
      if (!product || priceIssue(item, product)) continue;
      const change = byPair.get(`${item.id}::${id}`);
      if (change?.status === "rejected") continue;
      if (change) {
        if (change.diff_absolute > 0) stats.price_increases++;
        else if (change.diff_absolute < 0) stats.price_decreases++;
        else stats.price_unchanged++;
        if (change.status === "approved" && change.diff_absolute !== 0) stats.approved_changes++;
      } else {
        const conversion = item.matched_presentations?.find(c => c.product_id === id);
        const price = conversion ? convertPresentationPrice(item.parsed_price!, conversion.supplier_quantity, conversion.own_quantity) : item.parsed_price;
        if (price === product.current_price) stats.price_unchanged++;
      }
    }
  }
  return stats;
}
