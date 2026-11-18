import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { selectSupplierPrice } from "../priceSelection";
import { suggestColumnMapping } from "../columnMapping";
import { emptyMoneyOptions, inspectImportMoney } from "../importMoney";
import { getDB, suppliersRepo, productsRepo, priceListsRepo, priceListItemsRepo, priceChangesRepo, supplierColumnConfigRepo } from "../db";
import { runMatchingForPriceList } from "../runMatching";

const mapping = { code: "Código", description: "Descripción", price: "Precio normal", offerPrice: "Precio de oferta", currency: "Moneda" };
beforeEach(async () => { const db = await getDB(); for (const name of db.objectStoreNames) await db.clear(name); });

describe("precio normal con oferta opcional", () => {
  it.each([undefined, null, "", "   ", 0, "0", "0,00", "0.00"])("usa el normal si la oferta está vacía o en cero: %s", offer => {
    expect(selectSupplierPrice({ "Precio normal": 120, "Precio de oferta": offer }, mapping, true)).toMatchObject({ raw: 120, source: "normal", column: "Precio normal", error: null });
  });
  it("sólo aplica ofertas cuando el usuario lo activa, conservando el valor numérico original", () => {
    const row = { "Precio normal": 100, "Precio de oferta": 54.123 };
    expect(selectSupplierPrice(row, mapping, false)).toMatchObject({ raw: 100, source: "normal" });
    expect(selectSupplierPrice(row, mapping, true)).toMatchObject({ raw: 54.123, source: "offer", column: "Precio de oferta", error: null });
  });
  it.each(["Consultar", "#VALUE!", -10, Infinity, NaN])("marca una oferta inválida sin reemplazarla silenciosamente por el normal: %s", offer => {
    const selected = selectSupplierPrice({ "Precio normal": 120, "Precio de oferta": offer }, mapping, true);
    expect(selected.source).toBe("offer");
    expect(selected.error).toBeTruthy();
  });
  it("detecta las dos columnas y respeta el formato elegido para la oferta", () => {
    expect(suggestColumnMapping(["Código", "Descripción", "Precio normal", "Precio de oferta"])).toMatchObject(mappingWithoutCurrency());
    const row = { "Precio normal": "10.000,00", "Precio de oferta": "1.500" };
    expect(selectSupplierPrice(row, mapping, true, "comma_decimal").raw).toBe("1.500");
    expect(inspectImportMoney([{ ...row, Código: "A", Moneda: "ARS" }], mapping, { ...emptyMoneyOptions(), preferOffer: true }).needsFormat).toBe(true);
    expect(selectSupplierPrice(row, { ...mapping, offerPrice: mapping.price }, true).error).toBeTruthy();
    expect(selectSupplierPrice(row, { price: mapping.price }, true).error).toBeTruthy();
  });
  it("consulta moneda y separadores sobre el precio elegido, no sobre el descartado", () => {
    const rows = [{ Código: "A", "Precio normal": "1.500", "Precio de oferta": "USD 12,50" }];
    const check = inspectImportMoney(rows, mapping, { ...emptyMoneyOptions(), preferOffer: true });
    expect(check.unresolved).toBe(false);
    expect(check.needsFormat).toBe(false);
  });
  it("calcula una lista mixta sin poner en cero los artículos sin oferta ni aprobar ofertas inválidas", async () => {
    const supplier = await suppliersRepo.create({ name: "Proveedor de prueba", code: "P", email: "", phone: "", active: true, price_includes_vat: false, vat_rate: 21, default_currency: "ARS", notes: "" });
    const source = [
      { code: "A", normal: 1000, offer: 110 },
      { code: "B", normal: 120, offer: 0 },
      { code: "C", normal: 130, offer: "" },
      { code: "D", normal: 140, offer: "Consultar" },
      { code: "E", normal: 9000, offer: 54.123 },
      { code: "F", normal: 150, offer: -1 },
    ];
    await productsRepo.bulkUpsertByCode(supplier.id, source.map(row => ({ code: row.code, description: `Artículo ${row.code}`, unit: "x1", brand: "", current_price: 100, currency: "ARS", active: true })));
    const list = await priceListsRepo.create({ supplier_id: supplier.id, file_name: "mixta.xlsx", row_count: source.length, status: "mapped", column_mapping: { ...mapping, price_selection: "offer_when_available", number_format: "auto" } });
    await priceListItemsRepo.bulkCreate(source.map(row => ({ price_list_id: list.id, supplier_code: row.code, supplier_description: `Artículo ${row.code}`, supplier_unit: "x1", supplier_brand: "", supplier_currency: "ARS", raw_price: String(row.normal), parsed_price: null, parse_error: null, matched_product_id: null, match_level: null, match_score: null, match_state: "not_found", raw_data: { "Precio normal": row.normal, "Precio de oferta": row.offer } })));
    const sessionId = await runMatchingForPriceList(list.id, supplier.id);
    const items = await priceListItemsRepo.listByPriceList(list.id);
    for (const [code, price, kind] of [["A", 110, "offer"], ["B", 120, "normal"], ["C", 130, "normal"], ["E", 54.12, "offer"]] as const) {
      expect(items.find(i => i.supplier_code === code)).toMatchObject({ parsed_price: price, price_source: kind, parse_error: null });
    }
    const changes = await priceChangesRepo.listBySession(sessionId);
    expect(changes.map(c => c.new_price).sort((a, b) => a - b)).toEqual([54.12, 110, 120, 130]);
    for (const code of ["D", "F"]) {
      const item = items.find(i => i.supplier_code === code)!;
      expect(item.parse_error).toContain("oferta");
      expect(changes.some(c => c.price_list_item_id === item.id)).toBe(false);
    }
  });
  it("recuerda la elección del proveedor sin modificar el formato del catálogo", async () => {
    await supplierColumnConfigRepo.save("offers", { code_column: "Código", description_column: "Descripción", price_column: "Precio normal", offer_price_column: "Precio de oferta", prefer_offer: true, currency_column: "Moneda", brand_column: null, unit_column: null, ean_column: null });
    await supplierColumnConfigRepo.saveCatalogNumberFormat("offers", "comma_decimal");
    expect(await supplierColumnConfigRepo.get("offers")).toMatchObject({ offer_price_column: "Precio de oferta", prefer_offer: true, catalog_number_format: "comma_decimal" });
  });
});

function mappingWithoutCurrency() { const { currency, ...columns } = mapping; return columns; }
