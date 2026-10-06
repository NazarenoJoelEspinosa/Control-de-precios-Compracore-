import type { Currency, PriceListItem, Product } from "@/types/database";

export function parseCurrency(value: unknown, fallback: Currency): { currency: Currency | null; error: string | null } {
  const label = String(value ?? "").trim().toUpperCase();
  if (!label) return { currency: fallback, error: null };
  if (["ARS", "$", "AR$", "PESO", "PESOS"].includes(label)) return { currency: "ARS", error: null };
  if (["USD", "US$", "U$S", "DOLAR", "DÓLAR", "DOLARES", "DÓLARES"].includes(label)) return { currency: "USD", error: null };
  return { currency: null, error: `Moneda no reconocida: ${label}` };
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
