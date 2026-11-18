import { parseDecimal, type PriceNumberFormat } from "./normalize";
import type { ColumnMapping } from "./columnMapping";

/** Conserva el valor original y la columna elegida para poder auditar el precio. */
export function selectSupplierPrice(row: Record<string, unknown>, mapping: ColumnMapping, preferOffer = false, format: PriceNumberFormat = "auto") {
  const normal = { raw: row[mapping.price ?? ""], source: "normal" as const, column: mapping.price, error: null as string | null };
  if (!preferOffer) return normal;
  const fallbackNormal = () => {
    try {
      if (parseDecimal(normal.raw, format) <= 0) throw new Error("debe ser mayor que cero");
      return normal;
    } catch (error) { return { ...normal, error: `Precio normal inválido: ${error instanceof Error ? error.message : String(normal.raw)}` }; }
  };
  if (!mapping.offerPrice || mapping.offerPrice === mapping.price) return { ...normal, error: "Elegí una columna de oferta distinta del precio normal." };
  const offer = row[mapping.offerPrice];
  if (offer === null || offer === undefined || String(offer).trim() === "") return fallbackNormal();
  const selected = { raw: offer, source: "offer" as const, column: mapping.offerPrice, error: null as string | null };
  try {
    const price = parseDecimal(offer, format);
    if (price === 0) return fallbackNormal();
    if (price < 0) return { ...selected, error: "Precio de oferta negativo: revisá esta fila." };
    return selected;
  } catch (error) {
    return { ...selected, error: `Precio de oferta inválido: ${error instanceof Error ? error.message : String(offer)}` };
  }
}
