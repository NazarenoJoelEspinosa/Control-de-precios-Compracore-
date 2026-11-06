import type { Currency, PriceListItem, Product } from "@/types/database";

export function parseCurrency(value: unknown, fallback: Currency): { currency: Currency | null; error: string | null } {
  const label = String(value ?? "").trim().toUpperCase();
  if (!label) return { currency: fallback, error: null };
  if (["ARS", "$", "AR$", "PESO", "PESOS"].includes(label)) return { currency: "ARS", error: null };
  if (["USD", "US$", "U$S", "U$D", "DOLAR", "DÓLAR", "DOLARES", "DÓLARES"].includes(label)) return { currency: "USD", error: null };
  return { currency: null, error: `Moneda no reconocida: ${label}` };
}

/** La moneda escrita junto al importe también es explícita; el valor por
 * defecto sólo se usa cuando no hay moneda en ninguna de las dos columnas. */
export function parsePriceCurrency(price: unknown, currency: unknown, fallback: Currency): ReturnType<typeof parseCurrency> {
  const text = String(price ?? "").trim().toUpperCase();
  const markers = [text.match(/^(USD|US\$|U\$S|U\$D|ARS|AR\$|\$)\s*(?=-?[\d.,])/i)?.[1],
    text.match(/(?:[\d.,])\s*(USD|US\$|U\$S|U\$D|ARS|AR\$|\$)$/i)?.[1]].filter((m): m is string => Boolean(m));
  const embedded = new Set(markers.map(m => parseCurrency(m, fallback).currency));
  const explicit = String(currency ?? "").trim();
  const result = parseCurrency(explicit || markers[0], fallback);
  if (result.error) return result;
  if (embedded.size > 1 || (explicit && embedded.size && !embedded.has(result.currency))) {
    return { currency: null, error: "La moneda de la columna y la del precio se contradicen. Revisá el archivo." };
  }
  return result;
}

/** Identificar un producto y validar su precio son decisiones independientes. */
export function priceIssue(item: PriceListItem, product: Product | null): string | null {
  if (item.parse_error || item.parsed_price === null || !Number.isFinite(item.parsed_price)) return item.parse_error || "Precio inválido o vacío";
  if (item.comparison_error) return item.comparison_error;
  if (item.currency_error) return item.currency_error;
  if (product && item.supplier_currency && item.supplier_currency !== product.currency) {
    return `Moneda incompatible: proveedor ${item.supplier_currency}, catálogo ${product.currency}. Corregí la moneda o la lista; no se convierte automáticamente.`;
  }
  return null;
}

