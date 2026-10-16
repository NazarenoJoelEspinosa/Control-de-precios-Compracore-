import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { baseCode, buildPrefixCodeIndex, sameCodeWithoutPrefix } from "../codePrefixes";
import { buildProductIndexEntry, matchItem, type MatchDeps, type ProductForMatch } from "../matching";
import { normalizeCodeForMatch } from "../normalize";
import { getDB, productsRepo, priceListsRepo, priceListItemsRepo, priceChangesRepo, suppliersRepo } from "../db";
import { runMatchingForPriceList } from "../runMatching";
const product = (id: string, code: string, description = "Llave combinada", unit = "U"): ProductForMatch => ({ id, code, description, unit, current_price: 100, currency: "ARS" });
function deps(products: ProductForMatch[]): MatchDeps {
  return { byExactCode: new Map(products.map(p => [p.code.toUpperCase(), p])), byNormalizedCode: new Map(products.map(p => [normalizeCodeForMatch(p.code), p])), productsById: new Map(products.map(p => [p.id, p])), prefixCodeIndex: buildPrefixCodeIndex(products), confirmedEquivalences: new Map(), rejectedEquivalences: new Set(), descriptionIndex: products.map(buildProductIndexEntry), enableDescription: false, enableCodeFamily: false };
}
const incoming = (code: string, description = "Llave combinada", unit = "U") => ({ supplier_code: code, supplier_description: description, supplier_unit: unit });
describe("códigos con/sin ET-", () => {
  it.each([["ABC123", "ET-ABC123"], ["ET-ABC123", "ABC123"], ["AbC-123", " et - abc123 " ]])("reconoce %s frente a %s", (own, source) => {
    const result = matchItem("s", incoming(source), deps([product("p", own)]));
    expect(result).toMatchObject({ matchedProductId: "p", matchLevel: "code_prefix", matchState: "safe" });
  });
  it("conserva coincidencias exactas y equivalencias confirmadas antes de aplicar el alias", () => {
    const d = deps([product("a", "ABC123"), product("b", "ET-ABC123"), product("c", "OTRO")]);
    expect(matchItem("s", incoming("ET-ABC123"), d).matchedProductId).toBe("b");
    d.confirmedEquivalences.set("s::ET-XYZ123", "c"); d.prefixCodeIndex = buildPrefixCodeIndex([product("a", "XYZ123")]);
    expect(matchItem("s", incoming("ET-XYZ123"), d).matchedProductId).toBe("c");
  });
  it("no quita otras marcas, letras del modelo ni ceros iniciales", () => {
    for (const [a, b] of [["ETABC123", "ABC123"], ["XX-ABC123", "ABC123"], ["ET-00123", "123"], ["ET-ABC123", "ABC124"], ["ET-", ""]]) expect(sameCodeWithoutPrefix(a, b)).toBe(false);
    expect(baseCode("ET-00123")).toBe("00123");
  });
  it("no elige arbitrariamente si el código base pertenece a dos productos", () => {
    const result = matchItem("s", incoming("ET-ABC123"), deps([product("a", "ABC-123"), product("b", "ABC123")]));
    expect(result).toMatchObject({ matchedProductId: null, matchState: "presentation_diff" }); expect(result.candidates).toHaveLength(2);
  });
  it("respeta rechazos previos para este código", () => {
    const d = deps([product("a", "ABC123")]); d.rejectedEquivalences.add("s::ET-ABC123::a");
    expect(matchItem("s", incoming("ET-ABC123"), d).matchState).toBe("not_found");
  });
  it.each([["x100", "x1000"], ["xU", "x100"]])("deja presentación %s frente a %s para revisión", (own, source) => {
    expect(matchItem("s", incoming("ET-ABC123", "Tornillo", source), deps([product("a", "ABC123", "Tornillo", own)]))).toMatchObject({ matchedProductId: "a", matchState: "presentation_diff" });
  });
});

describe("integración con comparación y precios", () => {
  beforeEach(async () => { const db = await getDB(); for (const name of db.objectStoreNames) await db.clear(name); });
  it("identifica el alias sólo en su proveedor y deja el precio pendiente", async () => {
    const db = await getDB();
    await db.put("suppliers", { id: "s", name: "Proveedor ET", code: "S", email: "", phone: "", active: true, price_includes_vat: false, vat_rate: 21, default_currency: "ARS", notes: "", ignore_et_prefix: true, created_at: "", updated_at: "" });
    const own = await productsRepo.upsertByCode("s", { code: "ABC123", description: "Llave", unit: "U", brand: "", currency: "ARS", current_price: 100, active: true });
    await productsRepo.upsertByCode("other", { code: "ET-ABC123", description: "Otro artículo", unit: "U", brand: "", currency: "ARS", current_price: 1, active: true });
    const list = await priceListsRepo.create({ supplier_id: "s", file_name: "lista.csv", row_count: 1, status: "mapped", column_mapping: null });
    await priceListItemsRepo.bulkCreate([{ price_list_id: list.id, supplier_code: "ET-ABC123", supplier_description: "Llave", supplier_unit: "U", supplier_brand: "", supplier_currency: "ARS", raw_price: "150", parsed_price: null, parse_error: null, matched_product_id: null, match_level: null, match_score: null, match_state: "not_found", raw_data: {} }]);
    const sessionId = await runMatchingForPriceList(list.id, "s");
    expect((await priceListItemsRepo.listByPriceList(list.id))[0]).toMatchObject({ matched_product_id: own.id, match_level: "code_prefix", match_state: "safe" });
    expect((await priceChangesRepo.listBySession(sessionId))[0]).toMatchObject({ status: "pending", new_price: 150 });
    await suppliersRepo.update("s", { ignore_et_prefix: false });
    // Descripciones diferentes evitan que el fuzzy oculte una aplicación indebida del prefijo.
    const [item] = await priceListItemsRepo.listByPriceList(list.id);
    await priceListItemsRepo.update({ ...item, supplier_description: "ZZZZZZ" });
    await runMatchingForPriceList(list.id, "s");
    expect((await priceListItemsRepo.listByPriceList(list.id))[0].match_level).not.toBe("code_prefix");
    await suppliersRepo.update("s", { ignore_et_prefix: undefined });
    await runMatchingForPriceList(list.id, "s");
    expect((await priceListItemsRepo.listByPriceList(list.id))[0].match_level).not.toBe("code_prefix");
  });
});
