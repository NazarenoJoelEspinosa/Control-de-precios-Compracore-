import { normalizeText } from "./normalize";
import type { PresentationRule, PriceListItem, Equivalence, PresentationConversion, Product, PriceChange } from "@/types/database";

export function validateQuantities(supplier: number, own: number): void {
  if (!Number.isFinite(supplier) || !Number.isFinite(own) || supplier <= 0 || own <= 0) {
    throw new Error("Las cantidades deben ser números positivos y finitos.");
  }
}

/** Precio proveedor × cantidad propia / cantidad proveedor; redondear sólo al final. */
export function convertPresentationPrice(price: number, supplier: number, own: number): number {
  validateQuantities(supplier, own);
  const converted = price * (own / supplier);
  if (!Number.isFinite(price) || !Number.isFinite(converted)) throw new Error("El precio convertido no es válido.");
  return Math.round(converted * 100) / 100;
}

export function learnedPresentations(equivalences: Equivalence[], activeProductIds: Set<string>): Map<string, PresentationConversion[]> {
  const byCode = new Map<string, PresentationConversion[]>();
  for (const e of equivalences) {
    if (e.decision !== "confirmed" || !activeProductIds.has(e.product_id) || e.supplier_quantity === undefined || e.own_quantity === undefined) continue;
    // Backups antiguos o editados no deben introducir divisiones inválidas.
    try { validateQuantities(e.supplier_quantity, e.own_quantity); } catch { continue; }
    const rows = byCode.get(e.supplier_code) ?? [];
    rows.push({ product_id: e.product_id, supplier_quantity: e.supplier_quantity, own_quantity: e.own_quantity });
    byCode.set(e.supplier_code, rows);
  }
  return byCode;
}

export function presentationChange(product: Product, price: number, conversion: PresentationConversion): Omit<PriceChange, "id" | "created_at" | "comparison_session_id" | "price_list_item_id"> {
  const newPrice = convertPresentationPrice(price, conversion.supplier_quantity, conversion.own_quantity);
  const diff = Math.round((newPrice - product.current_price) * 100) / 100;
  return {
    product_id: product.id, old_price: product.current_price, new_price: newPrice,
    final_new_price: null, old_currency: product.currency, new_currency: product.currency,
    diff_absolute: diff,
    diff_percent: product.current_price ? Math.round((diff / product.current_price) * 10000) / 100 : null,
    status: "approved", decided_at: null,
  };
}

/** Patrones literales con límites de palabra; nada de coincidencias parciales x10/x1000. */
export function ruleConversion(rules: PresentationRule[], product: Product, item: PriceListItem): PresentationConversion | null {
  const matches = (pattern: string, text: string) => {
    const key = normalizeText(pattern).replace(/\s+/g, "").toLowerCase();
    if (!key) return false;
    const aliases = ["xu", "u", "un", "unidad", "unidades"];
    const tokens = normalizeText(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (aliases.includes(key)) return tokens.some(t => aliases.includes(t));
    // Un patrón x200 también admite «x 200», sin confundirlo con x2000.
    const words = (value: string) => normalizeText(value).toLowerCase().replace(/\bx\s+(\d+)/g, "x$1").split(/[^a-z0-9]+/).filter(Boolean);
    const needle = words(pattern), haystack = words(text);
    return needle.length > 0 && haystack.some((_, index) => needle.every((word, offset) => haystack[index + offset] === word));
  };
  const candidates = rules.filter(r => r.active && r.supplier_id === product.supplier_id &&
    Number.isFinite(r.factor) && r.factor > 0 &&
    matches(r.supplier_pattern ?? "", `${item.supplier_unit} ${item.supplier_description}`) &&
    matches(r.own_pattern || r.own_label, `${product.unit} ${product.description}`));
  if (!candidates.length) return null;
  if (new Set(candidates.map(r => r.factor)).size > 1) throw new Error("Reglas de presentación contradictorias: revisá el diccionario.");
  // El cociente equivale al factor guardado. No inferimos una cantidad física del texto.
  const own = Number((candidates[0].own_pattern || candidates[0].own_label).match(/x\s*(\d+)/i)?.[1] ?? 1);
  return { product_id: product.id, supplier_quantity: own / candidates[0].factor, own_quantity: own };
}
