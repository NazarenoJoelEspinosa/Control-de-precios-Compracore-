import { getDB, productsRepo, suppliersRepo, priceListsRepo, priceListItemsRepo, comparisonSessionsRepo, priceChangesRepo } from "../db";
import { runMatchingForPriceList } from "../runMatching";
import { confirmMatch } from "../reviewActions";

/** También se ejecuta en Chrome con Worker e IndexedDB nativos. */
export async function runCatalogOrientationScenarios() {
  const db = await getDB(); for (const store of db.objectStoreNames) await db.clear(store);
  const checks: string[] = []; const check = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const supplier = await suppliersRepo.create({ name: "Proveedor grande", code: "T", email: "", phone: "", active: true, price_includes_vat: false, vat_rate: 21, default_currency: "ARS", notes: "" });
  const { records: own } = await productsRepo.bulkUpsertByCode(supplier.id, [
    { code: "OXI-280", description: "SELLADOR TEKBOND NEUTRO TRANSPARENTE 280 GRS", unit: "x1", brand: "TEKBOND", currency: "ARS", current_price: 100, active: true },
    { code: "SOLO-MIO", description: "MOTOR HIDRAULICO EXCLUSIVO ZX999", unit: "x1", brand: "", currency: "ARS", current_price: 200, active: true },
  ]);
  const list = await priceListsRepo.create({ supplier_id: supplier.id, file_name: "grande.csv", row_count: 501, status: "mapped", column_mapping: null });
  await priceListItemsRepo.bulkCreate(Array.from({ length: 501 }, (_, i) => ({ price_list_id: list.id,
    supplier_code: i ? `EXTRA${i}` : "TKSL280", supplier_description: i ? `PRODUCTO TEKBOND QUE NO VENDO ${i}` : own[0].description,
    supplier_unit: "x1", supplier_brand: "TEKBOND", supplier_currency: "ARS", raw_price: "110", parsed_price: null, parse_error: null,
    matched_product_id: null, match_level: null, match_score: null, match_state: "not_found", raw_data: {},
  })));
  const id = await runMatchingForPriceList(list.id, supplier.id), session = (await comparisonSessionsRepo.get(id))!;
  const items = await priceListItemsRepo.listByPriceList(list.id), found = items.find(i => i.supplier_code === "TKSL280")!;
  check(Object.keys(session.catalog_candidates ?? {}).length === 2, "Una consulta por artículo propio, no por cada fila del proveedor");
  check(found.matched_product_id === own[0].id, "Encuentra el equivalente del artículo propio con otro código");
  check(items.filter(i => i.match_state === "review").length === 0, "Los 500 artículos que no vendo no llenan la revisión");
  const identified = new Set(items.filter(i => i.match_state === "safe").map(i => i.matched_product_id));
  check(own.filter(p => !identified.has(p.id)).map(p => p.id).join() === own[1].id, "El pendiente es el artículo propio sin equivalente");
  check((await priceChangesRepo.listBySession(id)).length === 1, "Sólo calcula precios de mis artículos encontrados");
  const before = await priceListItemsRepo.listByPriceList(list.id);
  let rejected = false; try { await confirmMatch(session, found, own[1].id); } catch { rejected = true; }
  check(rejected, "Vincular otro artículo no pisa una asociación confirmada");
  check(JSON.stringify(await priceListItemsRepo.listByPriceList(list.id)) === JSON.stringify(before), "El rechazo de una vinculación conflictiva no deja cambios parciales");
  return { checks, sessionId: id, supplierId: supplier.id, ownIds: own.map(p => p.id) };
}
