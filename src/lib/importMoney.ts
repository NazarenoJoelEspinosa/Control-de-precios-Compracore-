import { parseDecimal, type PriceNumberFormat } from "./normalize";
import { parsePriceCurrency } from "./pricePolicy";
import type { Currency } from "@/types/database";
import type { ColumnMapping } from "./columnMapping";

export interface ImportMoneyOptions {
  numberFormat: PriceNumberFormat;
  currencyChoices: Record<string, Currency>;
  askCurrency?: boolean;
}
export const emptyMoneyOptions = (): ImportMoneyOptions => ({ numberFormat: "auto", currencyChoices: {}, askCurrency: true });

export function currencyChoice(options: ImportMoneyOptions | undefined, label: string): Currency | undefined {
  const value = options?.currencyChoices[label];
  return value === "ARS" || value === "USD" ? value : undefined;
}

export function currencyQuestion(price: unknown, currency: unknown): string | null {
  const result = parsePriceCurrency(price, currency, "ARS");
  if (result.error) return String(currency ?? "").trim() || result.error;
  if (!String(currency ?? "").trim() && !/(USD|US\$|U\$S|U\$D|ARS|AR\$|\$)/i.test(String(price ?? ""))) return "Sin moneda indicada";
  return null;
}

export function importCurrency(price: unknown, currency: unknown, fallback: Currency, options?: ImportMoneyOptions) {
  const question = currencyQuestion(price, currency);
  const choice = question ? currencyChoice(options, question) : undefined;
  // Una contradicción entre columna y precio exige corregir el archivo.
  const conflict = parsePriceCurrency(price, currency, fallback);
  if (conflict.error?.includes("contradicen")) return conflict;
  if (choice) return { currency: choice, error: null };
  if (question && options?.askCurrency) return { currency: null, error: `Elegí la moneda para «${question}» antes de continuar.` };
  return conflict;
}

export function inspectImportMoney(rows: Record<string, unknown>[], mapping: ColumnMapping, options: ImportMoneyOptions) {
  const questions = new Set<string>();
  const conflicts = new Set<string>();
  let ambiguous = false;
  for (const row of rows) {
    if (!String(row[mapping.code ?? ""] ?? "").trim()) continue;
    const price = row[mapping.price ?? ""], currency = row[mapping.currency ?? ""];
    const detected = parsePriceCurrency(price, currency, "ARS");
    if (detected.error?.includes("contradicen")) { conflicts.add(detected.error); continue; }
    const question = currencyQuestion(price, currency);
    if (question) questions.add(question);
    if (typeof price === "string" && /^\s*(?:(?:ARS|USD|U\$D|U\$S|US\$|AR\$|\$)\s*)?-?\d{1,3}[.,]\d{3}\s*(?:ARS|USD|U\$D|U\$S|US\$|AR\$|\$)?\s*$/i.test(price)) ambiguous = true;
  }
  return { questions: [...questions], conflicts: [...conflicts], needsFormat: ambiguous && options.numberFormat === "auto",
    unresolved: conflicts.size > 0 || [...questions].some(q => !currencyChoice(options, q)) };
}

export function importPrice(value: unknown, options?: ImportMoneyOptions) {
  return parseDecimal(value, options?.numberFormat);
}
