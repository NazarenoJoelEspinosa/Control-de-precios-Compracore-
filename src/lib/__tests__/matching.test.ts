import { describe, it, expect } from "vitest";
import { parseDecimal, extractPresentation, presentationAlert, codeFamilySimilarity, normalizeCodeForMatch } from "@/lib/normalize";
import { scoreDescription, buildProductIndexEntry, matchItem, type MatchDeps, type ProductForMatch } from "@/lib/matching";

describe("parseDecimal — formato argentino y variantes", () => {
  it("interpreta coma decimal argentina", () => {
    expect(parseDecimal("10.500,50")).toBe(10500.5);
  });
  it("interpreta formato US con coma de miles", () => {
    expect(parseDecimal("10,500.50")).toBe(10500.5);
  });
  it("interpreta punto como separador de miles cuando hay 3 dígitos", () => {
    expect(parseDecimal("1.500")).toBe(1500);
  });
  it("interpreta coma como decimal cuando hay 2 dígitos después", () => {
    expect(parseDecimal("1500,50")).toBe(1500.5);
  });
  it("saca símbolos de moneda", () => {
    expect(parseDecimal("$ 10.500,50")).toBe(10500.5);
    expect(parseDecimal("ARS 2500")).toBe(2500);
  });
  it("rechaza precios inválidos en vez de inventar un número", () => {
    expect(() => parseDecimal("N/A")).toThrow();
    expect(() => parseDecimal("")).toThrow();
    expect(() => parseDecimal(null)).toThrow();
  });
});

describe("scoreDescription — casos peligrosos de falso positivo", () => {
  function score(query: string, candidate: string): number {
    const entry = buildProductIndexEntry({
      id: "x", code: "X", description: candidate, current_price: 0, currency: "ARS",
    });
    return scoreDescription(query, entry.text, entry.tokenSet, entry.trigramSet);
  }

  it("penaliza medidas distintas aunque el resto del texto sea casi idéntico", () => {
    const s10 = score("DISCO CORTE 10 MM", "DISCO CORTE 10 MM");
    const s12 = score("DISCO CORTE 10 MM", "DISCO CORTE 12 MM");
    expect(s10).toBeGreaterThan(90);
    expect(s12).toBeLessThan(s10 - 15);
  });

  it("distingue cantidades distintas (500 vs 1000 unidades)", () => {
    const sameQty = score("TORNILLO 8X1 X1000", "TORNILLO 8X1 X1000");
    const diffQty = score("TORNILLO 8X1 X1000", "TORNILLO 8X1 X500");
    expect(diffQty).toBeLessThan(sameQty - 10);
  });

  it("NO fuerza una coincidencia alta cuando la medida está en sistemas distintos (mm vs pulgadas)", () => {
    // "115 mm" y "4 1/2" (pulgadas) son el mismo disco en la práctica, pero el
    // motor no tiene tabla de conversión de unidades — y es intencional que
    // NO le dé score alto: es preferible mandar esto a revisión humana que
    // inventar una coincidencia por similitud de texto. Ver sección 44 del
    // prompt original: "no encontrado" es preferible a "coincidencia incorrecta".
    const s = score("DISCO DE CORTE 115 MM", "Disco corte 4 1/2");
    expect(s).toBeLessThan(40);
  });

  it("sí reconoce coincidencias claras con abreviaturas/orden de palabras distinto", () => {
    const s = score("DISCO CORTE 115MM METALICO", "Disco Corte Metalico 115 mm");
    expect(s).toBeGreaterThan(70);
  });
});

describe("extractPresentation / presentationAlert", () => {
  it("detecta cambio de cantidad como alerta de presentación", () => {
    const alert = presentationAlert("Tornillo 8x1 — Caja", "X1000", "Tornillo 8x1", "Caja X500");
    expect(alert.reason).not.toBe("");
  });

  it("no genera alerta cuando la presentación es idéntica", () => {
    const alert = presentationAlert("Guantes de cuero", "Par", "Guantes de cuero", "Par");
    expect(alert.reason).toBe("");
  });

  it("extrae cantidad de patrones comunes (x500, c/500)", () => {
    expect(extractPresentation("Tornillo 8x1 x500").count).toBe(500);
    expect(extractPresentation("Tornillo 8x1 c/500").count).toBe(500);
  });
});

describe("codeFamilySimilarity", () => {
  it("detecta un código base compartido con sufijo de cantidad distinto", () => {
    const a = normalizeCodeForMatch("TOR8X1X100");
    const b = normalizeCodeForMatch("TOR8X1X1000");
    expect(codeFamilySimilarity(a, b)).toBeGreaterThanOrEqual(0.6);
  });

  it("no confunde códigos que sólo comparten el prefijo por casualidad", () => {
    const a = normalizeCodeForMatch("TOR8X1X100");
    const b = normalizeCodeForMatch("TOX99Z");
    expect(codeFamilySimilarity(a, b)).toBeLessThan(0.6);
  });
});

describe("matchItem — flujo completo", () => {
  function buildDeps(products: ProductForMatch[]): MatchDeps {
    return {
      byExactCode: new Map(products.map((p) => [p.code.toUpperCase(), p])),
      byNormalizedCode: new Map(products.map((p) => [normalizeCodeForMatch(p.code), p])),
      confirmedEquivalences: new Map(),
      rejectedEquivalences: new Set(),
      productsById: new Map(products.map((p) => [p.id, p])),
      descriptionIndex: products.map(buildProductIndexEntry),
    };
  }

  it("código exacto no muestra candidatos alternativos", () => {
    const products: ProductForMatch[] = [
      { id: "1", code: "4587", description: "Disco de corte 115 mm", current_price: 2000, currency: "ARS" },
    ];
    const result = matchItem("sup1", { supplier_code: "4587", supplier_description: "Disco de corte 115 mm" }, buildDeps(products));
    expect(result.matchState).toBe("safe");
    expect(result.candidates).toHaveLength(1);
  });

  it("código exacto queda 'safe' aunque la descripción parezca sugerir otra presentación (el código manda)", () => {
    const products: ProductForMatch[] = [
      { id: "1", code: "7001", description: "Tornillo 8x1 x100", unit: "Caja", current_price: 1800, currency: "ARS" },
    ];
    // Misma descripción en apariencia de "otra cantidad", pero el CÓDIGO del
    // proveedor es idéntico al interno — no debería dudar de esto.
    const result = matchItem(
      "sup1",
      { supplier_code: "7001", supplier_description: "Tornillo 8x1 x500", supplier_unit: "Caja" },
      buildDeps(products)
    );
    expect(result.matchState).toBe("safe");
  });

  it("detecta presentación distinta por familia de código (mismo tornillo, otro pack)", () => {
    const products: ProductForMatch[] = [
      { id: "1", code: "TOR8X1X100", description: "Tornillo autoperforante 8x1 x100", unit: "Caja", current_price: 1800, currency: "ARS" },
    ];
    const result = matchItem(
      "sup1",
      { supplier_code: "TOR8X1X1000", supplier_description: "Tornillo autoperforante 8x1 x1000", supplier_unit: "Caja" },
      buildDeps(products)
    );
    expect(result.matchState).toBe("presentation_diff");
    expect(result.matchLevel).toBe("code_family");
    expect(result.matchedProductId).toBe("1");
  });

  it("por debajo del umbral de revisión, manda directo a no encontrado sin mostrar candidato dudoso", () => {
    const products: ProductForMatch[] = [
      { id: "1", code: "9999", description: "Bulón hexagonal M8", current_price: 500, currency: "ARS" },
    ];
    const result = matchItem(
      "sup1",
      { supplier_code: "AAAA", supplier_description: "Zapatilla deportiva talle 42" },
      buildDeps(products),
      { safeMin: 97, reviewMin: 50 }
    );
    expect(result.matchState).toBe("not_found");
    expect(result.matchedProductId).toBeNull();
  });

  it("catálogo mediano (800 productos) procesa 300 ítems en tiempo razonable — cubre la regresión de re-tokenizar por ítem", () => {
    const products: ProductForMatch[] = Array.from({ length: 800 }, (_, i) => ({
      id: `p${i}`,
      code: `COD${i}`,
      description: `Producto de ferretería número ${i} variante ${i % 37}`,
      current_price: 100 + i,
      currency: "ARS",
    }));
    const deps = buildDeps(products);

    const start = performance.now();
    for (let i = 0; i < 300; i++) {
      matchItem("sup1", { supplier_code: `NOEXISTE${i}`, supplier_description: `algo random ${i} sin relación` }, deps);
    }
    const elapsed = performance.now() - start;
    // Nota: las descripciones de este test comparten casi todas las mismas
    // palabras entre sí a propósito (peor caso: nada se descarta rápido por
    // el atajo de "cero superposición"). Un catálogo real, con productos de
    // categorías distintas, es bastante más rápido que esto en la práctica.
    // El límite generoso de acá es para agarrar una regresión real (por
    // ejemplo, volver a tokenizar el catálogo por cada ítem), no para medir
    // rendimiento fino.
    expect(elapsed).toBeLessThan(8000);
  });
});
