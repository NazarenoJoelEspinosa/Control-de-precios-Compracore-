import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { emptyMoneyOptions, importCurrency, importPrice, inspectImportMoney } from "../importMoney";
import { prepareCatalogImport } from "../catalogImport";
import { supplierColumnConfigRepo } from "../db";

const mapping = { code: "Código", description: "Descripción", price: "Precio", currency: "Moneda" };
describe("decisiones de moneda y separadores al importar", () => {
  it("pregunta por importes ambiguos y cada formato produce un valor distinto", () => {
    const rows = [{ Código: "A", Precio: "1.500", Moneda: "ARS" }];
    expect(inspectImportMoney(rows, mapping, emptyMoneyOptions()).needsFormat).toBe(true);
    expect(inspectImportMoney([{ Código: "A", Precio: "1,500 USD" }], mapping, emptyMoneyOptions()).needsFormat).toBe(true);
    expect(importPrice("1.500", { ...emptyMoneyOptions(), numberFormat: "comma_decimal" })).toBe(1500);
    expect(importPrice("1.500", { ...emptyMoneyOptions(), numberFormat: "dot_decimal" })).toBe(1.5);
    expect(importPrice("5447.585", { ...emptyMoneyOptions(), numberFormat: "dot_decimal" })).toBe(5447.59);
    expect(importPrice("5.447,585", { ...emptyMoneyOptions(), numberFormat: "comma_decimal" })).toBe(5447.59);
    expect(() => importPrice("5.447,585", { ...emptyMoneyOptions(), numberFormat: "dot_decimal" })).toThrow();
    expect(inspectImportMoney([{ Código: "A", Precio: 54.123, Moneda: "ARS" }], mapping, emptyMoneyOptions()).needsFormat).toBe(false);
  });
  it("no elige ARS para una moneda desconocida ni para una fila sin moneda", () => {
    expect(importCurrency("10", "DLS", "ARS", emptyMoneyOptions()).currency).toBeNull();
    expect(importCurrency("10", "", "ARS", emptyMoneyOptions()).currency).toBeNull();
    const rows = [{ Código: "A", Descripción: "Artículo", Precio: "26,71", Moneda: "DLS" }];
    const options = { ...emptyMoneyOptions(), currencyChoices: { DLS: "USD" as const } };
    expect(inspectImportMoney(rows, mapping, options).unresolved).toBe(false);
    const result = prepareCatalogImport(rows, mapping, "ARS", options);
    expect(result.errors).toEqual([]);
    expect(result.products[0]).toMatchObject({ currency: "USD", current_price: 26.71 });
  });
  it("admite pesos y dólares en la misma lista y no permite forzar una contradicción", () => {
    const options = emptyMoneyOptions();
    expect(importCurrency("USD 26,71", "", "ARS", options).currency).toBe("USD");
    expect(importCurrency("7,45", "U$D", "ARS", options).currency).toBe("USD");
    expect(importCurrency("5447.585", "ARS", "USD", options).currency).toBe("ARS");
    const rows = [{ Código: "A", Precio: "USD 10", Moneda: "ARS" }];
    expect(inspectImportMoney(rows, mapping, options).unresolved).toBe(true);
    expect(importCurrency("USD 10", "ARS", "ARS", { ...options, currencyChoices: { ARS: "USD" } }).currency).toBeNull();
  });
  it("recuerda formatos separados para OneSoft y proveedor sin perder columnas", async () => {
    const supplierId = "money-settings";
    await supplierColumnConfigRepo.save(supplierId, { code_column: "Código", description_column: "Descripción", price_column: "Precio", currency_column: "Moneda", unit_column: null, brand_column: null, ean_column: null, price_number_format: "dot_decimal" });
    await supplierColumnConfigRepo.saveCatalogNumberFormat(supplierId, "comma_decimal");
    expect(await supplierColumnConfigRepo.get(supplierId)).toMatchObject({ code_column: "Código", price_column: "Precio", price_number_format: "dot_decimal", catalog_number_format: "comma_decimal" });
  });
});
