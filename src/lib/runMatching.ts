import { normalizeCodeForMatch, normalizeText, parseDecimal } from "./normalize";
import { matchItem, type MatchDeps, type ProductForMatch } from "./matching";
import {
  comparisonSessionsRepo,
  equivalencesRepo,
  priceChangesRepo,
  priceListItemsRepo,
  priceListsRepo,
  productsRepo,
} from "./db";
import type { ComparisonSession, PriceListItem, Product } from "@/types/database";

/**
 * Corre el pipeline completo de matching para una lista ya cargada (con sus
 * price_list_items ya insertados). Antes esto vivía en una Edge Function de
 * Supabase; ahora corre en el navegador porque todos los datos ya están acá
 * (IndexedDB) — no hay ningún servidor al que llamar.
 *
 * Con ~3.000 ítems esto tarda del orden de 1-2 segundos. Si en el futuro el
 * volumen crece mucho más, este mismo código se puede mover a un Web Worker
 * sin cambiar la lógica (es puro, no toca el DOM).
 */
export async function runMatchingForPriceList(priceListId: string, supplierId: string): Promise<string> {
  const items = await priceListItemsRepo.listByPriceList(priceListId);
  const allProducts = await productsRepo.list();
  const activeProducts = allProducts.filter((p) => p.active);

  const byExactCode = new Map<string, ProductForMatch>();
  const byNormalizedCode = new Map<string, ProductForMatch>();
  const productsById = new Map<string, ProductForMatch>();
  for (const p of activeProducts) {
    byExactCode.set(normalizeText(p.code).toUpperCase(), p);
    byNormalizedCode.set(normalizeCodeForMatch(p.code), p);
    productsById.set(p.id, p);
  }

  const equivalencesForSupplier = (
    await Promise.all(items.map((it) => equivalencesRepo.findForSupplierCode(supplierId, it.supplier_code)))
  ).flat();
  const confirmedEquivalences = new Map(
    equivalencesForSupplier.filter((e) => e.decision === "confirmed").map((e) => [e.supplier_code, e.product_id])
  );
  const rejectedEquivalences = new Set(
    equivalencesForSupplier.filter((e) => e.decision === "rejected").map((e) => `${e.supplier_code}::${e.product_id}`)
  );

  const summary = {
    total_items: 0,
    safe_matches: 0,
    review_items: 0,
    not_found_items: 0,
    new_products: 0,
    presentation_diff_items: 0,
    price_increases: 0,
    price_decreases: 0,
    price_unchanged: 0,
    approved_changes: 0,
  };

  const updatedItems: PriceListItem[] = [];
  const changesToCreate: Parameters<typeof priceChangesRepo.bulkCreate>[0] = [];

  for (const item of items) {
    summary.total_items++;

    let parsedPrice: number | null = null;
    let parseError: string | null = null;
    try {
      parsedPrice = parseDecimal(item.raw_price);
    } catch {
      parseError = "No se pudo interpretar el precio";
    }

    const deps: MatchDeps = {
      byExactCode,
      byNormalizedCode,
      confirmedEquivalences,
      rejectedEquivalences,
      productsById,
      descriptionCandidates: activeProducts,
    };

    const result = matchItem(
      supplierId,
      {
        supplier_code: item.supplier_code,
        supplier_description: item.supplier_description,
        supplier_brand: item.supplier_brand,
        supplier_unit: item.supplier_unit,
      },
      deps
    );

    switch (result.matchState) {
      case "safe":
        summary.safe_matches++;
        break;
      case "review":
        summary.review_items++;
        break;
      case "not_found":
        summary.not_found_items++;
        break;
      case "presentation_diff":
        summary.presentation_diff_items++;
        break;
      case "new_product":
        summary.new_products++;
        break;
    }
    if (!result.matchedProductId) summary.new_products++;

    updatedItems.push({
      ...item,
      parsed_price: parsedPrice,
      parse_error: parseError,
      matched_product_id: result.matchedProductId,
      match_level: result.matchLevel,
      match_score: result.matchScore,
      match_state: result.matchState,
    });

    if (result.matchedProductId && parsedPrice !== null) {
      const product = productsById.get(result.matchedProductId) as Product;
      const diff = Math.round((parsedPrice - product.current_price) * 100) / 100;
      if (diff > 0) summary.price_increases++;
      else if (diff < 0) summary.price_decreases++;
      else summary.price_unchanged++;

      if (diff !== 0) {
        changesToCreate.push({
          comparison_session_id: "", // se completa después de crear la sesión
          price_list_item_id: item.id,
          product_id: product.id,
          old_price: product.current_price,
          new_price: parsedPrice,
          final_new_price: null,
          old_currency: product.currency,
          new_currency: product.currency,
          diff_absolute: diff,
          diff_percent: product.current_price ? Math.round((diff / product.current_price) * 10000) / 100 : null,
          status: "pending",
          decided_at: null,
        });
      }
    }
  }

  const session: ComparisonSession = await comparisonSessionsRepo.create({
    supplier_id: supplierId,
    price_list_id: priceListId,
    status: "open",
    ...summary,
  });

  await priceListItemsRepo.bulkUpdate(updatedItems);
  if (changesToCreate.length > 0) {
    await priceChangesRepo.bulkCreate(changesToCreate.map((c) => ({ ...c, comparison_session_id: session.id })));
  }
  await priceListsRepo.updateStatus(priceListId, "processed");

  return session.id;
}
