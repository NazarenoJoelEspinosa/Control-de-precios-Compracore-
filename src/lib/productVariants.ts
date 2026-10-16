import { canonicalHeader, extractPresentation, normalizeText } from "./normalize";

/** Identidad de presentación dentro de un código; conserva IDs al actualizar precios. */
export function productVariantKey(product: { code: string; description: string; unit: string }): string {
  const presentation = extractPresentation(product.description, product.unit);
  const unit = canonicalHeader(product.unit);
  const count = extractPresentation("", product.unit).count ?? presentation.count ?? (/^(?:x\s*)?(?:u|un|unidad|unidades)$/.test(unit) ? 1 : null);
  const identity = count !== null ? `quantity:${count}:${presentation.kind === "Unidad" ? "" : presentation.kind}:${presentation.measure}` : `unit:${unit}:${presentation.kind}:${presentation.measure}`;
  // Sin una cantidad explícita en la columna unidad, la descripción también
  // distingue variantes: nunca pisar filas diferentes por una inferencia ambigua.
  const descriptionKey = extractPresentation("", product.unit).count === null ? canonicalHeader(product.description) : "";
  return `${normalizeText(product.code).toUpperCase()}::${identity}::${descriptionKey}`;
}
