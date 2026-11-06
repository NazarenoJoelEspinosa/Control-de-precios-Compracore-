import { buildProductIndexEntry, matchItem, type MatchDeps, type ProductForMatch, type MatchResult } from "./matching";
import { normalizeCodeForMatch, normalizeText, stemToken, tokenize } from "./normalize";
import { baseCode } from "./codePrefixes";
import type { Equivalence, PriceListItem, Product } from "@/types/database";

export interface CatalogCandidateSelection {
  /** Sólo las filas que son candidatas de algún artículo propio pasan al motor de precios. */
  productIdsByItem: Map<string, string[]>;
  candidatesByProduct: Record<string, string[]>;
}

/** Índice del universo grande: se construye una sola vez por lista del proveedor. */
function supplierIndex(items: PriceListItem[], ignorePrefix: boolean) {
  const entries = items.map(item => buildProductIndexEntry({ id: item.id, code: item.supplier_code,
    description: item.supplier_description, brand: item.supplier_brand, unit: item.supplier_unit,
    current_price: 0, currency: item.supplier_currency ?? "ARS" }));
  const exact = new Map<string, ProductForMatch[]>(), normalized = new Map<string, ProductForMatch[]>();
  const prefix = new Map<string, ProductForMatch[]>();
  const families = new Map<string, typeof entries>(), tokens = new Map<string, typeof entries>();
  for (const entry of entries) {
    for (const [index, key] of [[exact, normalizeText(entry.product.code).toUpperCase()], [normalized, entry.normalizedCode], [prefix, baseCode(entry.product.code)]] as const) {
      const group = index.get(key); if (group) group.push(entry.product); else index.set(key, [entry.product]);
    }
    const family = entry.normalizedCode.slice(0, 5);
    if (family.length >= 5) { const group = families.get(family); if (group) group.push(entry); else families.set(family, [entry]); }
    for (const token of new Set([...entry.tokenSet].map(stemToken))) { const group = tokens.get(token); if (group) group.push(entry); else tokens.set(token, [entry]); }
  }
  const deps: MatchDeps = {
    byExactCode: new Map([...exact].map(([code, rows]) => [code, rows[0]])),
    byNormalizedCode: new Map([...normalized].map(([code, rows]) => [code, rows[0]])),
    exactCodeCandidates: exact, normalizedCodeCandidates: normalized,
    productsById: new Map(entries.map(e => [e.product.id, e.product])),
    confirmedEquivalences: new Map(), rejectedEquivalences: new Set(), descriptionIndex: entries,
    prefixCodeIndex: ignorePrefix ? prefix : undefined, codeFamilyIndex: families,
  };
  return { deps, tokens };
}

/** Mi catálogo es el conjunto de consultas; nunca se puntúan productos ajenos a él. */
export function selectCatalogCandidates(products: Product[], items: PriceListItem[], equivalences: Equivalence[], discontinued: Set<string>, options: {
  ignorePrefix: boolean; maxCandidates: number; enableDescription: boolean; enableCodeFamily: boolean;
  safeMin: number; reviewMin: number;
}): CatalogCandidateSelection {
  const available = items.filter(i => !discontinued.has(i.supplier_code));
  const { deps, tokens } = supplierIndex(available, options.ignorePrefix);
  const byCode = new Map<string, PriceListItem[]>();
  for (const item of available) { const group = byCode.get(item.supplier_code); if (group) group.push(item); else byCode.set(item.supplier_code, [item]); }
  const memories = new Map<string, Equivalence[]>();
  for (const e of equivalences) { const group = memories.get(e.product_id); if (group) group.push(e); else memories.set(e.product_id, [e]); }
  const productIdsByItem = new Map<string, string[]>(), candidatesByProduct: Record<string, string[]> = {};
  for (const product of products.filter(p => p.active)) {
    const memory = (memories.get(product.id) ?? []).filter(e => e.supplier_id === product.supplier_id);
    const learned = memory.filter(e => e.decision === "confirmed").flatMap(e => byCode.get(e.supplier_code) ?? []);
    const rejected = new Set(memory.filter(e => e.decision === "rejected").flatMap(e => byCode.get(e.supplier_code) ?? []).map(i => `${product.supplier_id}::${product.code}::${i.id}`));
    const incoming = { supplier_code: product.code, supplier_description: product.description, supplier_brand: product.brand, supplier_unit: product.unit };
    const queryDeps = { ...deps, rejectedEquivalences: rejected, maxCandidates: options.maxCandidates, enableCodeFamily: options.enableCodeFamily };
    // Códigos y memoria resuelven sin recorrer tokens comunes ni puntuar texto.
    let result = matchItem(product.supplier_id, incoming, { ...queryDeps, enableDescription: false }, options);
    if (result.matchState === "not_found" && !learned.length && options.enableDescription) {
      // Los tokens raros pesan más: la marca común no puede esconder el modelo.
      const weighted = new Map<string, { entry: (typeof deps.descriptionIndex)[number]; weight: number }>();
      for (const token of new Set(tokenize([product.description, product.brand, product.unit].join(" ")).map(stemToken))) {
        const bucket = tokens.get(token) ?? [], weight = 1 / Math.log2(bucket.length + 2);
        for (const entry of bucket) { const current = weighted.get(entry.product.id); if (current) current.weight += weight; else weighted.set(entry.product.id, { entry, weight }); }
      }
      const shortlist = [...weighted.values()].sort((a, b) => b.weight - a.weight || a.entry.product.id.localeCompare(b.entry.product.id)).slice(0, options.maxCandidates).map(x => x.entry);
      result = matchItem(product.supplier_id, incoming, { ...queryDeps, descriptionIndex: shortlist, tokenIndex: undefined, enableDescription: true }, options);
    }
    const suggestions = result.matchState === "not_found" ? [] : result.candidates.map(c => c.product.id);
    candidatesByProduct[product.id] = [...new Set([...learned.map(i => i.id), ...suggestions])];
    // Duplicados del proveedor no se resuelven eligiendo una fila arbitraria.
    // Las equivalencias específicas ya confirmadas sí conservan su memoria.
    const unambiguousLearned = learned.filter(i => byCode.get(i.supplier_code)?.length === 1);
    const chosen = new Set([...unambiguousLearned.map(i => i.id), ...(result.matchedProductId ? [result.matchedProductId] : [])]);
    for (const itemId of chosen) { const group = productIdsByItem.get(itemId); if (group) group.push(product.id); else productIdsByItem.set(itemId, [product.id]); }
  }
  return { productIdsByItem, candidatesByProduct };
}

/** Mantiene las políticas de identidad/presentación existentes, pero sólo entre
 * los artículos propios que eligieron esta fila durante la búsqueda inversa. */
export function matchSelectedItems(supplierId: string, items: PriceListItem[], deps: MatchDeps, selection: CatalogCandidateSelection, thresholds: { safeMin: number; reviewMin: number }): MatchResult[] {
  const entries = new Map(deps.descriptionIndex.map(e => [e.product.id, e]));
  return items.map(item => {
    const ids = new Set(selection.productIdsByItem.get(item.id) ?? []);
    if (!ids.size) return { matchedProductId: null, matchLevel: "none", matchScore: null, matchState: "not_found", presentationReason: "", candidates: [] };
    const selected = [...ids].map(id => entries.get(id)).filter((e): e is NonNullable<typeof e> => Boolean(e));
    const exact = new Map<string, ProductForMatch[]>(), normalized = new Map<string, ProductForMatch[]>(), prefix = new Map<string, ProductForMatch[]>();
    const families = new Map<string, typeof selected>();
    for (const entry of selected) {
      for (const [index, key] of [[exact, normalizeText(entry.product.code).toUpperCase()], [normalized, entry.normalizedCode], [prefix, baseCode(entry.product.code)]] as const) {
        const group = index.get(key); if (group) group.push(entry.product); else index.set(key, [entry.product]);
      }
      const key = entry.normalizedCode.slice(0, 5), group = families.get(key); if (group) group.push(entry); else families.set(key, [entry]);
    }
    return matchItem(supplierId, item, { ...deps,
      byExactCode: new Map([...exact].map(([key, group]) => [key, group[0]])),
      byNormalizedCode: new Map([...normalized].map(([key, group]) => [key, group[0]])),
      exactCodeCandidates: exact, normalizedCodeCandidates: normalized,
      prefixCodeIndex: deps.prefixCodeIndex ? prefix : undefined, descriptionIndex: selected, tokenIndex: undefined,
      codeFamilyIndex: families,
      productsById: new Map(selected.map(e => [e.product.id, e.product])),
    }, thresholds);
  });
}
