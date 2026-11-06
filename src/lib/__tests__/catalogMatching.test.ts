import { describe, expect, it } from "vitest";
import { selectCatalogCandidates } from "../catalogMatching";
import type { PriceListItem, Product, Equivalence } from "@/types/database";

const options = { ignorePrefix: false, maxCandidates: 250, enableDescription: true, enableCodeFamily: true, safeMin: 97, reviewMin: 50 };
function product(id = "own", code = "A", description = "SELLADOR TEKBOND NEUTRO TRANSPARENTE X280GRS"): Product {
  return { id, supplier_id: "s", code, description, unit: "x1", brand: "TEKBOND", currency: "ARS", current_price: 100, active: true, created_at: "", updated_at: "" };
}
function item(id = "provider", code = "A", description = "SELLADOR TEKBOND NEUTRO TRANSPARENTE X280GRS"): PriceListItem {
  return { id, price_list_id: "l", supplier_code: code, supplier_description: description, supplier_unit: "x1", supplier_brand: "TEKBOND", supplier_currency: "ARS", raw_price: "110", parsed_price: 110, parse_error: null, matched_product_id: null, match_level: null, match_score: null, match_state: "not_found", raw_data: {}, created_at: "" };
}
function memory(own: Product, supplierCode = "CAJA", decision: "confirmed" | "rejected" = "confirmed"): Equivalence {
  return { id: "e", supplier_id: "s", supplier_code: supplierCode, product_id: own.id, decision, origin: "manual", confidence: 100, created_at: "", updated_at: "", supplier_quantity: 1000, own_quantity: 1 };
}
describe("mi catálogo busca dentro del universo del proveedor", () => {
  it("cientos de productos Tekbond que no vendo no generan pendientes", () => {
    const own = product();
    const source = [item(), ...Array.from({ length: 500 }, (_, i) => item(`extra${i}`, `OTRO${i}`, "SELLADOR TEKBOND NEUTRO OTRA PRESENTACION"))];
    const result = selectCatalogCandidates([own], source, [], new Set(), options);
    expect(Object.keys(result.candidatesByProduct)).toEqual([own.id]);
    expect([...result.productIdsByItem.keys()]).toEqual(["provider"]);
  });
  it("conserva un pendiente por cada artículo propio aunque no encuentre candidato", () => {
    const result = selectCatalogCandidates([product("a", "A"), product("b", "B")], [item()], [], new Set(), { ...options, enableDescription: false, enableCodeFamily: false });
    expect(result.candidatesByProduct).toEqual({ a: ["provider"], b: [] });
  });
  it("reutiliza códigos y cantidades aprendidas sin buscar todos los productos del proveedor", () => {
    const own = product("own", "MIO", "Mi descripción abreviada"), row = item("box", "CAJA", "Caja del proveedor");
    const result = selectCatalogCandidates([own], [row], [memory(own)], new Set(), { ...options, enableDescription: false });
    expect(result.candidatesByProduct.own).toEqual([row.id]);
    expect(result.productIdsByItem.get(row.id)).toEqual([own.id]);
  });
  it("una fila puede servir como candidata de x100, x10 y x1 sin elegir una variante arbitraria", () => {
    const own = [100, 10, 1].map(q => ({ ...product(`p${q}`, "TOR"), unit: `x${q}` }));
    const result = selectCatalogCandidates(own, [item("box", "TOR")], [], new Set(), options);
    expect(result.productIdsByItem.get("box")).toHaveLength(3);
  });
  it("dos filas con el mismo código del proveedor piden elección en vez de aprobar ambas", () => {
    const result = selectCatalogCandidates([product()], [item("one"), item("two")], [], new Set(), options);
    expect(result.candidatesByProduct.own.sort()).toEqual(["one", "two"]);
    expect(result.productIdsByItem.size).toBe(0);
  });
  it("un código aprendido tampoco elige entre filas duplicadas de la lista nueva", () => {
    const own = product("own", "MIO");
    const result = selectCatalogCandidates([own], [item("one", "CAJA"), item("two", "CAJA")], [memory(own)], new Set(), options);
    expect(result.candidatesByProduct.own.sort()).toEqual(["one", "two"]);
    expect(result.productIdsByItem.size).toBe(0);
  });
  it("encuentra un modelo al final de la lista usando tokens raros dentro del cupo", () => {
    const own = product("own", "MIO", "LLAVE INDUSTRIAL MODELOUNICO");
    const source = [...Array.from({ length: 1000 }, (_, i) => item(`noise${i}`, `P${i}`, "LLAVE INDUSTRIAL COMUN")), item("last", "PUNICO", "LLAVE INDUSTRIAL MODELOUNICO")];
    const result = selectCatalogCandidates([own], source, [], new Set(), { ...options, maxCandidates: 1, enableCodeFamily: false });
    expect(result.productIdsByItem.get("last")).toEqual([own.id]);
  });
  it("respeta ET por proveedor y las equivalencias rechazadas", () => {
    const own = product("own", "ABC"), row = item("alias", "ET-ABC");
    const noPrefix = selectCatalogCandidates([own], [row], [], new Set(), { ...options, enableDescription: false, enableCodeFamily: false });
    expect(noPrefix.productIdsByItem.size).toBe(0);
    const enabled = selectCatalogCandidates([own], [row], [], new Set(), { ...options, ignorePrefix: true });
    expect(enabled.productIdsByItem.get(row.id)).toEqual([own.id]);
    const rejected = selectCatalogCandidates([own], [row], [memory(own, "ET-ABC", "rejected")], new Set(), { ...options, ignorePrefix: true, enableDescription: false, enableCodeFamily: false });
    expect(rejected.productIdsByItem.size).toBe(0);
  });
  it("excluye códigos discontinuados, artículos inactivos y memoria de otro proveedor", () => {
    const own = product("own", "MIO"), row = item("box", "CAJA");
    expect(selectCatalogCandidates([own], [row], [memory(own)], new Set(["CAJA"]), options).productIdsByItem.size).toBe(0);
    expect(selectCatalogCandidates([{ ...own, active: false }], [row], [], new Set(), options).candidatesByProduct).toEqual({});
    expect(selectCatalogCandidates([own], [row], [{ ...memory(own), supplier_id: "other" }], new Set(), { ...options, enableDescription: false }).productIdsByItem.size).toBe(0);
  });
  it("1800 propios contra 10000 del proveedor sólo selecciona los 1800 códigos que vendo", () => {
    const own = Array.from({ length: 1800 }, (_, i) => product(`own${i}`, `COD${i}`));
    const source = Array.from({ length: 10000 }, (_, i) => item(`provider${i}`, `COD${i}`));
    const start = performance.now();
    const result = selectCatalogCandidates(own, source, [], new Set(), options);
    expect(result.productIdsByItem.size).toBe(1800);
    expect(Object.keys(result.candidatesByProduct)).toHaveLength(1800);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
