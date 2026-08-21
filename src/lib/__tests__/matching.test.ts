import { describe, it, expect } from "vitest";
import { parseDecimal, extractPresentation, presentationAlert } from "@/lib/normalize";
import { scoreDescription, buildProductIndexEntry } from "@/lib/matching";

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
