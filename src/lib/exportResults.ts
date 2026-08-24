import * as XLSX from "xlsx";
import type { PriceChange, PriceListItem, Product } from "@/types/database";

export interface ExportRow {
  item: PriceListItem;
  product: Product | null;
  change: PriceChange | null;
}

const STATE_LABELS: Record<PriceListItem["match_state"], string> = {
  safe: "Coincidencia segura",
  review: "Revisar",
  not_found: "No encontrado",
  new_product: "Nuevo producto",
  presentation_diff: "Presentación distinta",
  discontinued: "Discontinuado",
};

function buildSheetData(rows: ExportRow[]) {
  return rows.map((row) => ({
    "Código interno": row.product?.code ?? "",
    "Código proveedor": row.item.supplier_code,
    Descripción: row.product?.description ?? row.item.supplier_description,
    "Precio anterior": row.change?.old_price ?? row.product?.current_price ?? "",
    "Precio nuevo": row.change ? (row.change.final_new_price ?? row.change.new_price) : row.item.parsed_price ?? "",
    Diferencia: row.change?.diff_absolute ?? "",
    Porcentaje: row.change?.diff_percent ?? "",
    Estado: STATE_LABELS[row.item.match_state],
    "Estado del cambio": row.change ? row.change.status : "",
  }));
}

/** Exporta todos los resultados de la sesión (sección 25 del brief: export completo). */
export function exportAllResults(rows: ExportRow[], fileName: string) {
  const sheet = XLSX.utils.json_to_sheet(buildSheetData(rows));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Resultados");
  XLSX.writeFile(workbook, fileName);
}

/** Exporta solo los cambios aprobados — el archivo que efectivamente se usa para actualizar el sistema de gestión. */
export function exportApprovedOnly(rows: ExportRow[], fileName: string) {
  const approved = rows.filter((r) => r.change?.status === "approved");
  const sheet = XLSX.utils.json_to_sheet(buildSheetData(approved));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Cambios aprobados");
  XLSX.writeFile(workbook, fileName);
}
