import { describe, expect, it } from "vitest";
import { matchesResultFilters, resultStatus, type ResultView } from "../resultFilters";
import type { ExportRow } from "../exportResults";

function row(): ExportRow {
  const product = { id: "p", supplier_id: "s", code: "A", description: "Artículo x1", unit: "x1", currency: "ARS" as const, brand: "", active: true, current_price: 100, created_at: "", updated_at: "" };
  const item = { id: "i", price_list_id: "l", supplier_code: "A", supplier_description: "Artículo x1", supplier_unit: "x1", supplier_brand: "", supplier_currency: "ARS" as const, raw_price: "110", parsed_price: 110, parse_error: null, matched_product_id: "p", match_level: "exact_code" as const, match_score: 100, match_state: "safe" as const, raw_data: {}, created_at: "" };
  const change = { id: "c", comparison_session_id: "s", price_list_item_id: "i", product_id: "p", old_price: 100, new_price: 110, final_new_price: null, old_currency: "ARS" as const, new_currency: "ARS" as const, diff_absolute: 10, diff_percent: 10, status: "pending" as const, decided_at: null, created_at: "" };
  return { product, item, change };
}

describe("un próximo paso por resultado", () => {
  it("identificado no implica precio aprobado", () => { const r = row(); expect(resultStatus(r)).toBe("pending"); expect(matchesResultFilters(r, "approved", "all", "all")).toBe(false); });
  it("muestra sin cambios aunque no exista un registro de cambio", () => { const r = row(); r.change = null; r.item.parsed_price = 100; expect(resultStatus(r)).toBe("unchanged"); expect(matchesResultFilters(r, "unchanged", "all", "all")).toBe(true); });
  it("no cuenta un cambio de cero como aprobado ni listo para exportar", () => { const r = row(); r.change = { ...r.change!, new_price: 100, diff_absolute: 0, status: "approved" }; expect(resultStatus(r)).toBe("unchanged"); expect(matchesResultFilters(r, "approved", "all", "all")).toBe(false); });
  it("usa el precio convertido para reconocer que no hubo cambios", () => { const r = row(); r.change = null; r.item.parsed_price = 1000; r.item.matched_presentations = [{ product_id: "p", supplier_quantity: 10, own_quantity: 1 }]; expect(resultStatus(r)).toBe("unchanged"); });
  it("presentación distinta no se cuenta además como identificación", () => { const r = row(); r.item.match_state = "presentation_diff"; expect(matchesResultFilters(r, "review", "presentations", "all")).toBe(true); expect(matchesResultFilters(r, "review", "identification", "all")).toBe(false); });
  it("una suba grande no se ofrece para aprobar aunque antes estuviera aprobada", () => { const r = row(); r.change = { ...r.change!, new_price: 10000, diff_absolute: 9900, status: "approved" }; expect(resultStatus(r)).toBe("presentations"); expect(matchesResultFilters(r, "approved", "all", "all")).toBe(false); });
  it("un rechazado queda accesible sin volver a llenar la revisión", () => { const r = row(); r.change = { ...r.change!, new_price: 10000, status: "rejected" }; expect(resultStatus(r)).toBe("rejected"); expect(matchesResultFilters(r, "review", "all", "all")).toBe(false); expect(matchesResultFilters(r, "all", "all", "rejected_price")).toBe(true); });
  it("las pestañas de trabajo son excluyentes; lista completa permite ver todo", () => {
    const a = row(), b = row(), c = row(), d = row(); b.change = { ...b.change!, status: "approved" }; c.change = null; c.item.parsed_price = 100; d.item.parse_error = "Inválido";
    for (const r of [a, b, c, d]) { expect((["review", "pending", "approved", "unchanged"] as ResultView[]).filter(v => matchesResultFilters(r, v, "all", "all"))).toHaveLength(1); expect(matchesResultFilters(r, "all", "all", "all")).toBe(true); }
  });
});
