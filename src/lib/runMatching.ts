import { selectCatalogCandidates, matchSelectedItems } from "./catalogMatching";
import { buildPrefixCodeIndex } from "./codePrefixes";
import { presentationReviewReason, supplierPresentationLimits } from "./presentationReview";
import { priceIssue } from "./pricePolicy";
import { comparisonStats } from "./comparisonStats";
import { learnedPresentations, presentationChange, ruleConversion } from "./presentationConversions";
import { normalizeCodeForMatch, normalizeText, parseDecimal } from "./normalize";
import { buildProductIndexEntry, matchItem, type MatchDeps, type ProductForMatch, type MatchResult } from "./matching";
import {
  getDB, newId, nowISO,
  discontinuedCodesRepo,
  equivalencesRepo,
  priceChangesRepo,
  priceListItemsRepo,
  priceListsRepo,
  productsRepo,
  settingsRepo,
  suppliersRepo,
  presentationRulesRepo,
} from "./db";
import type { ComparisonSession, PriceListItem, Product, Equivalence } from "@/types/database";

/** Índices y memoria se cargan una vez por lista. No hay consultas a IndexedDB
 * dentro del loop; identificar y aprobar precios son estados independientes. */
async function matchInWorker(supplierId: string, items: PriceListItem[], deps: MatchDeps, products: Product[], equivalences: Equivalence[], discontinued: Set<string>, options: Parameters<typeof selectCatalogCandidates>[4]): Promise<{ matches: MatchResult[]; candidatesByProduct: Record<string, string[]> }> {
  if (typeof Worker === "undefined") {
    const selection = selectCatalogCandidates(products, items, equivalences, discontinued, options);
    return { matches: matchSelectedItems(supplierId, items, deps, selection, options), candidatesByProduct: selection.candidatesByProduct };
  }
  const worker = new Worker(new URL("./matching.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = event => resolve(event.data);
      worker.onerror = event => reject(new Error(event.message || "No se pudo ejecutar el motor de comparación."));
      worker.postMessage({ supplierId, items, deps, products, equivalences, discontinued, options });
    });
  } finally { worker.terminate(); }
}

export async function runMatchingForPriceList(priceListId: string, supplierId: string): Promise<string> {
  const items = await priceListItemsRepo.listByPriceList(priceListId);
  const sourceList = await priceListsRepo.get(priceListId);
  const priceColumn = sourceList?.column_mapping?.price;
  const numberFormat = sourceList?.column_mapping?.number_format;
  // Sólo la carpeta de ESTE proveedor — nunca el catálogo entero. Esto es lo
  // que evita tanto los choques de código entre proveedores como el costo de
  // comparar cada ítem contra productos que ni siquiera son de este
  // proveedor (con catálogos grandes, la mayor parte del tiempo de matching
  // se iba en comparar contra productos irrelevantes).
  const supplierProducts = await productsRepo.listBySupplier(supplierId);
  const activeProducts = supplierProducts.filter((p) => p.active);
  const rawThresholds = await settingsRepo.get();
  const supplier = await suppliersRepo.get(supplierId);
  const thresholds = { safeMin: rawThresholds.safe_min, reviewMin: rawThresholds.review_min };

  const byExactCode = new Map<string, ProductForMatch>();
  const byNormalizedCode = new Map<string, ProductForMatch>();
  const exactCodeCandidates = new Map<string, ProductForMatch[]>();
  const normalizedCodeCandidates = new Map<string, ProductForMatch[]>();
  const productsById = new Map<string, ProductForMatch>();
  for (const p of activeProducts) {
    byExactCode.set(normalizeText(p.code).toUpperCase(), p);
    byNormalizedCode.set(normalizeCodeForMatch(p.code), p);
    productsById.set(p.id, p);
    for (const [index, key] of [[exactCodeCandidates, normalizeText(p.code).toUpperCase()], [normalizedCodeCandidates, normalizeCodeForMatch(p.code)]] as const) {
      const group = index.get(key); if (group) group.push(p); else index.set(key, [p]);
    }
  }

  // Tokenizar el catálogo es la parte cara del matching — se hace UNA vez
  // acá, nunca dentro del loop de ítems.
  const descriptionIndex = activeProducts.map(buildProductIndexEntry);
  const tokenIndex = new Map<string, typeof descriptionIndex>();
  const codeFamilyIndex = new Map<string, typeof descriptionIndex>();
  for (const entry of descriptionIndex) {
    const prefix = entry.normalizedCode.slice(0, 5);
    if (prefix.length >= 5) {
      const bucket = codeFamilyIndex.get(prefix);
      if (bucket) bucket.push(entry); else codeFamilyIndex.set(prefix, [entry]);
    }
    for (const token of entry.tokenSet) {
      const stem = token.length > 4 && token.endsWith("es") ? token.slice(0, -2) : token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
      const bucket = tokenIndex.get(stem);
      if (bucket) bucket.push(entry); else tokenIndex.set(stem, [entry]);
    }
  }

  // Traer de una sola consulta todo lo que el proveedor tiene aprendido
  // (equivalencias + discontinuados), en vez de una consulta por ítem.
  const [equivalencesForSupplier, discontinuedForSupplier, rules] = await Promise.all([
    equivalencesRepo.listForSupplier(supplierId),
    discontinuedCodesRepo.listForSupplier(supplierId),
    presentationRulesRepo.listForSupplier(supplierId),
  ]);
  // Las claves deben coincidir EXACTAMENTE con las que usa matching.ts.
  // Antes se guardaban como `supplier_code`, pero el motor buscaba
  // `supplierId::supplierCode`, por lo que las equivalencias aprendidas
  // nunca se recuperaban en la siguiente comparación.
  const conversionsByCode = learnedPresentations(equivalencesForSupplier, new Set(activeProducts.map(p => p.id)));
  const confirmedEquivalences = new Map<string, string>(
    equivalencesForSupplier
      .filter((e) => e.decision === "confirmed")
      .map((e) => [`${supplierId}::${e.supplier_code}`, e.product_id])
  );
  const rejectedEquivalences = new Set<string>(
    equivalencesForSupplier
      .filter((e) => e.decision === "rejected")
      .map((e) => `${supplierId}::${e.supplier_code}::${e.product_id}`)
  );
  const discontinuedCodes = new Set(discontinuedForSupplier.map((d) => d.supplier_code));

  const deps: MatchDeps = {
    byExactCode,
    byNormalizedCode,
    exactCodeCandidates, normalizedCodeCandidates,
    confirmedEquivalences,
    rejectedEquivalences,
    productsById,
    descriptionIndex,
    tokenIndex,
    codeFamilyIndex,
    prefixCodeIndex: supplier?.ignore_et_prefix === true ? buildPrefixCodeIndex(activeProducts) : undefined,
    maxCandidates: rawThresholds.max_candidates ?? 250,
    enableCodeFamily: rawThresholds.enable_code_family !== false,
    enableDescription: rawThresholds.enable_description !== false,
  };

  const updatedItems: PriceListItem[] = [];
  const changesToCreate: Parameters<typeof priceChangesRepo.bulkCreate>[0] = [];
  const workerResults = await matchInWorker(supplierId, items, deps, activeProducts, equivalencesForSupplier, discontinuedCodes, {
    ...thresholds, ignorePrefix: supplier?.ignore_et_prefix === true, maxCandidates: rawThresholds.max_candidates ?? 250,
    enableDescription: rawThresholds.enable_description !== false, enableCodeFamily: rawThresholds.enable_code_family !== false,
  });
  for (let index = 0; index < items.length; index++) {
    const original = items[index];
    let parsedPrice: number | null = null, parseError: string | null = null;
    // XLSX conserva números tipados: 54.123 es un decimal, no el texto
    // argentino "54.123" (54 mil). No perder ese dato al serializar raw_price.
    const sourcePrice = priceColumn ? original.raw_data?.[priceColumn] : undefined;
    try { parsedPrice = parseDecimal(typeof sourcePrice === "number" ? sourcePrice : original.raw_price,
      numberFormat === "dot_decimal" || numberFormat === "comma_decimal" ? numberFormat : "auto"); }
    catch (error) { parseError = error instanceof Error ? error.message : "Precio inválido"; }
    const result = workerResults.matches[index];
    const discontinued = discontinuedCodes.has(original.supplier_code);
    const learned = discontinued ? undefined : conversionsByCode.get(original.supplier_code);
    let conversions = learned;
    const item: PriceListItem = { ...original, parsed_price: parsedPrice, parse_error: parseError,
      supplier_currency: original.supplier_currency === undefined ? supplier?.default_currency : original.supplier_currency,
      comparison_error: null, matched_presentations: undefined,
      review_reason: result.presentationReason || (result.matchState === "not_found" ? "Sin coincidencia por código ni descripción suficiente." : ""),
      candidate_product_ids: result.candidates.map(c => c.product.id),
      presentation_limits: supplierPresentationLimits(supplier),
      matched_product_id: discontinued ? null : result.matchedProductId,
      match_level: discontinued ? "none" : result.matchLevel,
      match_score: discontinued ? null : result.matchScore,
      match_state: discontinued ? "discontinued" : result.matchState };
    if (!discontinued && !conversions && result.matchedProductId) {
      const product = productsById.get(result.matchedProductId) as Product;
      try {
        const conversion = ruleConversion(rules, product, item);
        if (conversion) conversions = [conversion];
      } catch (error) { item.comparison_error = error instanceof Error ? error.message : "Regla inválida"; }
    }
    if (conversions?.length) {
      item.matched_presentations = conversions;
      item.matched_product_id = conversions[0].product_id;
      if (learned) { item.match_level = "equivalence"; item.match_score = 100; item.match_state = "safe"; }
    }
    updatedItems.push(item);
    if (item.match_state !== "safe") continue;
    const ids = conversions?.map(c => c.product_id) ?? [item.matched_product_id];
    for (const id of ids) {
      const product = id ? productsById.get(id) as Product | undefined : undefined;
      if (!product || priceIssue(item, product)) continue;
      const conversion = conversions?.find(c => c.product_id === id) ?? { product_id: product.id, supplier_quantity: 1, own_quantity: 1 };
      const change = presentationChange(product, parsedPrice!, conversion);
      // Identificación automática no equivale a aprobación manual del precio.
      // Conservar el comportamiento existente por defecto sólo para códigos coincidentes.
      change.status = rawThresholds.auto_confirm_exact !== false &&
        ["exact_code", "normalized_code"].includes(item.match_level ?? "") && !presentationReviewReason(item, product, change) ? "approved" : "pending";
      if (change.diff_absolute !== 0 || conversions?.length) changesToCreate.push({ ...change,
        comparison_session_id: "", price_list_item_id: item.id });
    }
  }
  const summary = comparisonStats(updatedItems, changesToCreate, activeProducts);

  const session: ComparisonSession = {
    id: newId(), created_at: nowISO(),
    supplier_id: supplierId,
    price_list_id: priceListId,
    status: "open",
    catalog_snapshot: activeProducts,
    catalog_candidates: workerResults.candidatesByProduct,
    ...summary,
  };
  const db = await getDB();
  const tx = db.transaction(["products", "suppliers", "comparisonSessions", "priceListItems", "priceChanges", "priceLists"], "readwrite");
  try {
    const currentSupplier = await tx.objectStore("suppliers").get(supplierId);
    if (!currentSupplier?.active || currentSupplier.deleted_at) throw new Error("El proveedor ya no está activo.");
    const currentCatalog = (await tx.objectStore("products").index("bySupplier").getAll(supplierId)).filter(p => p.active);
    if (JSON.stringify(currentCatalog) !== JSON.stringify(activeProducts)) throw new Error("El catálogo cambió durante el procesamiento. Volvé a iniciar la comparación.");
    await tx.objectStore("comparisonSessions").put(session);
    for (const item of updatedItems) await tx.objectStore("priceListItems").put(item);
    for (const change of changesToCreate) await tx.objectStore("priceChanges").put({ ...change, id: newId(), created_at: nowISO(), comparison_session_id: session.id });
    const priceList = await tx.objectStore("priceLists").get(priceListId);
    if (!priceList || priceList.supplier_id !== supplierId) throw new Error("La lista ya no está disponible.");
    await tx.objectStore("priceLists").put({ ...priceList, status: "processed" });
    await tx.done;
  } catch (error) { try { tx.abort(); } catch { /* Ya abortada. */ } await tx.done.catch(() => undefined); throw error; }

  return session.id;
}

