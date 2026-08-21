import { canonicalHeader } from "./normalize";

export type ColumnField = "code" | "description" | "price" | "unit" | "brand" | "ean" | "currency";

/**
 * Alias conocidos por campo — portado de FILE_ALIASES en CompraCore, ampliado.
 * Se usa para proponer un mapeo automático que el usuario siempre confirma
 * (nunca se aplica sin pasar por la pantalla de confirmación).
 */
const FIELD_ALIASES: Record<ColumnField, string[]> = {
  code: ["codigo", "cod", "sku", "codigo interno", "codigo producto", "id", "articulo", "cod articulo", "referencia"],
  description: ["descripcion", "desc", "producto", "detalle", "nombre", "denominacion", "articulo descripcion"],
  price: ["precio", "precio lista", "precio neto", "precio unitario", "importe", "pvp", "precio venta", "costo"],
  unit: ["unidad", "un", "u medida", "unidad medida", "presentacion", "embalaje"],
  brand: ["marca", "fabricante"],
  ean: ["ean", "codigo barras", "cod barras", "barcode"],
  currency: ["moneda", "divisa", "currency"],
};

export interface ColumnMapping {
  code?: string;
  description?: string;
  price?: string;
  unit?: string;
  brand?: string;
  ean?: string;
  currency?: string;
}

/** Propone un mapeo automático comparando headers normalizados contra los alias. */
export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const normalizedHeaders = headers.map((h) => ({ original: h, norm: canonicalHeader(h) }));
  const mapping: ColumnMapping = {};

  (Object.keys(FIELD_ALIASES) as ColumnField[]).forEach((field) => {
    const aliases = FIELD_ALIASES[field];
    const match = normalizedHeaders.find((h) => aliases.includes(h.norm));
    if (match) {
      mapping[field] = match.original;
    }
  });

  return mapping;
}
