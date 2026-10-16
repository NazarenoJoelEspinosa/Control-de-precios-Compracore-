import { baseCode, prefixPresentationConflict } from "./codePrefixes";
import { normalizeCodeForMatch } from "./normalize";
import type { DiscontinuedCode, Equivalence, PriceListItem, Product } from "@/types/database";
export interface GapReason { kind: "none" | "ambiguous" | "presentation" | "linked" | "rejected" | "discontinued" | "prefix_disabled"; message: string; itemId?: string }
export function buildGapReasons(products: Product[], source: PriceListItem[], ignoreEtPrefix: boolean, equivalences: Equivalence[], discontinued: DiscontinuedCode[]): Record<string, GapReason> {
  const exact = new Map<string, PriceListItem[]>(), prefixed = new Map<string, PriceListItem[]>();
  for (const item of source) for (const [index, key] of [[exact, normalizeCodeForMatch(item.supplier_code)], [prefixed, baseCode(item.supplier_code)]] as const) { const bucket = index.get(key); if (bucket) bucket.push(item); else index.set(key, [item]); }
  const rejected = new Set(equivalences.filter(e => e.decision === "rejected").map(e => `${e.supplier_code}::${e.product_id}`));
  const disc = new Set(discontinued.map(d => d.supplier_code));
  return Object.fromEntries(products.map(product => {
    const full = exact.get(normalizeCodeForMatch(product.code)) ?? [];
    const aliases = prefixed.get(baseCode(product.code)) ?? [];
    const candidates = full.length ? full : ignoreEtPrefix ? aliases : [];
    let reason: GapReason;
    if (!candidates.length) reason = aliases.length && !ignoreEtPrefix ? { kind: "prefix_disabled", message: "Hay un código con/sin ET-, pero la regla está desactivada para este proveedor." } : { kind: "none", message: "Sin coincidencia por código. Revisá las sugerencias o buscá otra palabra de la descripción." };
    else if (candidates.every(i => disc.has(i.supplier_code) || i.match_state === "discontinued")) reason = { kind: "discontinued", message: "Este código está marcado como discontinuado. Podés rehabilitarlo desde el Diccionario." };
    else if (candidates.every(i => rejected.has(`${i.supplier_code}::${product.id}`))) reason = { kind: "rejected", message: "Esta coincidencia fue rechazada anteriormente. Revisala antes de volver a vincular." };
    else if (candidates.length > 1) reason = { kind: "ambiguous", message: `Hay ${candidates.length} filas del proveedor para este código base. Elegí la presentación correcta.` };
    else {
      const item = candidates[0];
      const linked = item.matched_presentations?.length || item.matched_product_id;
      if (linked) reason = { kind: "linked", message: "La fila del proveedor ya tiene un artículo asociado. Si son variantes del mismo producto, agregá tus otras presentaciones a esa relación.", itemId: item.id };
      else if (item.match_state === "presentation_diff" || item.candidate_product_ids && item.candidate_product_ids.length > 1 || prefixPresentationConflict(product.description, product.unit, item.supplier_description, item.supplier_unit)) reason = { kind: "presentation", message: item.review_reason || "Mismo código, distintas cantidades o varias presentaciones propias. Enseñá la relación.", itemId: item.id };
      else reason = { kind: "presentation", message: "Hay una fila con el mismo código base, pendiente de confirmar su relación.", itemId: item.id };
    }
    return [product.id, reason];
  }));
}
