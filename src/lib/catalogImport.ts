import { parseDecimal } from "./normalize";
import { parseCurrency } from "./pricePolicy";
import type { ColumnMapping } from "./columnMapping";
import type { Currency, Product } from "@/types/database";

export function prepareCatalogImport(rows: Record<string, unknown>[], mapping: ColumnMapping, fallback: Currency) {
  const products: Omit<Product, "id" | "created_at" | "updated_at" | "supplier_id">[] = [];
  const errors: string[] = [];
  let skipped = 0;
  if (!mapping.code || !mapping.description || !mapping.price) return { products, errors, skipped };
  rows.forEach((row, index) => {
    const code = String(row[mapping.code!] ?? "").trim();
    if (!code) { skipped++; return; }
    try {
      const money = parseCurrency(row[mapping.currency ?? ""], fallback);
      if (!money.currency || money.error) throw new Error(money.error ?? "Moneda inválida");
      products.push({ code, description: String(row[mapping.description!] ?? "").trim(),
        brand: String(row[mapping.brand ?? ""] ?? "").trim(), unit: String(row[mapping.unit ?? ""] ?? "").trim(),
        currency: money.currency, current_price: parseDecimal(row[mapping.price!]), active: true });
    } catch (e) { errors.push(`Fila ${index + 1}, ${code}: ${e instanceof Error ? e.message : "Precio inválido"}`); }
  });
  return { products, errors, skipped };
}
