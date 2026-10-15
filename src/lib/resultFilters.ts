import type { ExportRow } from "./exportResults";
import { priceIssue } from "./pricePolicy";
import { presentationReviewReason } from "./presentationReview";
export type ResultView = "all" | "review" | "pending" | "approved";
export type ReviewKind = "all" | "presentations" | "identification" | "price";
export type ExtraFilter = "all" | "safe" | "not_found" | "presentation_diff" | "discontinued" | "increased" | "decreased" | "price_error" | "pending_price" | "approved_price" | "rejected_price";
export function matchesResultFilters(row: ExportRow, view: ResultView, kind: ReviewKind, extra: ExtraFilter): boolean {
  const issue = priceIssue(row.item, row.product);
  const presentation = presentationReviewReason(row.item, row.product, row.change);
  const identification = row.item.match_state === "review";
  const priceError = Boolean(issue && (row.product || identification || row.item.match_state === "presentation_diff"));
  if (view === "review" && !(presentation || identification || priceError)) return false;
  if (view === "review" && kind === "presentations" && !presentation) return false;
  if (view === "review" && kind === "identification" && !identification) return false;
  if (view === "review" && kind === "price" && !priceError) return false;
  const pending = row.change && row.change.diff_absolute !== 0 && ["pending", "edited"].includes(row.change.status) && !issue && !presentation;
  const approved = row.change?.status === "approved" && !issue && !presentation;
  if (view === "pending" && !pending) return false;
  if (view === "approved" && !approved) return false;
  if (extra === "pending_price" && !pending) return false;
  if (extra === "approved_price" && !approved) return false;
  if (extra === "rejected_price" && row.change?.status !== "rejected") return false;
  if (extra === "price_error" && !issue) return false;
  if (extra === "increased" && !(row.change && row.change.diff_absolute > 0 && row.change.status !== "rejected" && !issue)) return false;
  if (extra === "decreased" && !(row.change && row.change.diff_absolute < 0 && row.change.status !== "rejected" && !issue)) return false;
  if (["safe", "not_found", "presentation_diff", "discontinued"].includes(extra) && row.item.match_state !== extra) return false;
  return true;
}
