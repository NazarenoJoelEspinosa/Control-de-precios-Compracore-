import { importCurrency, importPrice, inspectImportMoney, type ImportMoneyOptions } from "./importMoney";
import type { ColumnMapping } from "./columnMapping";
import type { Currency, Product } from "@/types/database";

export function prepareCatalogImport(rows: Record<string, unknown>[], mapping: ColumnMapping, fallback: Currency, options?: ImportMoneyOptions) {
  const products: Omit<Product, "id" | "created_at" | "updated_at" | "supplier_id">[] = [];
  const errors: string[] = [];
  let skipped = 0;
  if (!mapping.code || !mapping.description || !mapping.price) return { products, errors, skipped };
  if (options && inspectImportMoney(rows, mapping, options).needsFormat) errors.push("Elegí los separadores de esta lista: hay importes ambiguos.");
  rows.forEach((row, index) => {
    const code = String(row[mapping.code!] ?? "").trim();
    if (!code) { skipped++; return; }
    try {
      const money = importCurrency(row[mapping.price!], row[mapping.currency ?? ""], fallback, options);
      if (!money.currency || money.error) throw new Error(money.error ?? "Moneda inválida");
      products.push({ code, description: String(row[mapping.description!] ?? "").trim(),
        brand: String(row[mapping.brand ?? ""] ?? "").trim(), unit: String(row[mapping.unit ?? ""] ?? "").trim(),
        currency: money.currency, current_price: importPrice(row[mapping.price!], options), active: true });
    } catch (e) { errors.push(`Fila ${index + 1}, ${code}: ${e instanceof Error ? e.message : "Precio inválido"}`); }
  });
  return { products, errors, skipped };
}

