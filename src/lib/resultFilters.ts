import type { ExportRow } from "./exportResults";
import { priceIssue } from "./pricePolicy";
import { presentationReviewReason } from "./presentationReview";
import { convertPresentationPrice } from "./presentationConversions";
export type ResultView = "all" | "review" | "pending" | "approved" | "unchanged";
export type ReviewKind = "all" | "presentations" | "identification" | "price";
export type ExtraFilter = "all" | "safe" | "not_found" | "presentation_diff" | "discontinued" | "increased" | "decreased" | "price_error" | "pending_price" | "approved_price" | "rejected_price";
export type ResultStatus = "identification" | "presentations" | "price" | "pending" | "approved" | "unchanged" | "rejected" | "outside";

/** Un solo próximo paso por fila; los motivos de revisión no se cuentan dos veces. */
export function resultStatus(row: ExportRow): ResultStatus {
  if (row.item.match_state === "review") return "identification";
  if (row.item.match_state === "presentation_diff") return "presentations";
  if (row.item.match_state !== "safe" || !row.product) return "outside";
  if (row.change?.status === "rejected") return "rejected";
  if (priceIssue(row.item, row.product)) return "price";
  if (presentationReviewReason(row.item, row.product, row.change)) return "presentations";
  if (row.change) {
    if (row.change.diff_absolute === 0) return "unchanged";
    return row.change.status === "approved" ? "approved" : "pending";
  }
  const conversion = row.item.matched_presentations?.find(c => c.product_id === row.product!.id);
  const incoming = conversion ? convertPresentationPrice(row.item.parsed_price!, conversion.supplier_quantity, conversion.own_quantity) : row.item.parsed_price;
  return incoming === row.product.current_price ? "unchanged" : "price";
}

export function matchesResultFilters(row: ExportRow, view: ResultView, kind: ReviewKind, extra: ExtraFilter): boolean {
  const status = resultStatus(row);
  const review = ["identification", "presentations", "price"].includes(status);
  if (view === "review" && (!review || (kind !== "all" && status !== kind))) return false;
  if (["pending", "approved", "unchanged"].includes(view) && status !== view) return false;
  if (extra === "pending_price" && status !== "pending") return false;
  if (extra === "approved_price" && status !== "approved") return false;
  if (extra === "rejected_price" && row.change?.status !== "rejected") return false;
  const issue = priceIssue(row.item, row.product);
  if (extra === "price_error" && !issue) return false;
  if (extra === "increased" && !(row.change && row.change.diff_absolute > 0 && row.change.status !== "rejected" && !issue)) return false;
  if (extra === "decreased" && !(row.change && row.change.diff_absolute < 0 && row.change.status !== "rejected" && !issue)) return false;
  if (["safe", "not_found", "presentation_diff", "discontinued"].includes(extra) && row.item.match_state !== extra) return false;
  return true;
}

