import { normalizeCodeForMatch, normalizeText, canonicalHeader, extractPresentation, presentationAlert } from "./normalize";

/** Sólo prefijos conocidos con separador explícito: nunca recortar letras de un modelo. */
export function codeWithoutKnownPrefix(code: string): string {
  return normalizeText(code).replace(/^ET\s*[-–—]\s*(?=\S)/i, "");
}
export function baseCode(code: string): string {
  return normalizeCodeForMatch(codeWithoutKnownPrefix(code));
}
export function sameCodeWithoutPrefix(a: string, b: string): boolean {
  const key = baseCode(a);
  return Boolean(key) && key === baseCode(b) && normalizeCodeForMatch(a) !== normalizeCodeForMatch(b);
}
export function buildPrefixCodeIndex<T extends { code: string }>(products: T[]): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const product of products) {
    const key = baseCode(product.code);
    if (!key) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(product); else index.set(key, [product]);
  }
  return index;
}

/** Para un alias nuevo se controlan cantidades explícitas, incluida xU = 1. */
export function prefixPresentationConflict(ownDescription: string, ownUnit: string, supplierDescription: string, supplierUnit: string): string {
  const count = (description: string, unit: string) => extractPresentation(description, unit).count ??
    (/^(?:x\s*)?(?:u|un|unidad|unidades)$/.test(canonicalHeader(unit)) ? 1 : null);
  const own = count(ownDescription, ownUnit), incoming = count(supplierDescription, supplierUnit);
  if (own !== null && incoming !== null && own !== incoming) return "Cantidad/presentación distinta";
  const alert = presentationAlert(ownDescription, ownUnit, supplierDescription, supplierUnit);
  return alert.reason === "Revisar presentación" ? "" : alert.reason;
}
