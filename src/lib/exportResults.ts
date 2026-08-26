import ExcelJS from "exceljs";
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

/** Mismos colores que usa la app (StatusBadges) para que el Excel se lea igual que la pantalla. */
const STATE_COLORS: Record<PriceListItem["match_state"], { fill: string; font: string }> = {
  safe: { fill: "FFE9F3EC", font: "FF2E7D46" },
  review: { fill: "FFFCF2E1", font: "FFB87A1F" },
  not_found: { fill: "FFFBEAE6", font: "FFC23B22" },
  new_product: { fill: "FFE9F0FA", font: "FF2C6FBB" },
  presentation_diff: { fill: "FFF1ECF7", font: "FF7B5EA7" },
  discontinued: { fill: "FFE4E8EC", font: "FF52606D" },
};

const CHANGE_STATUS_LABELS: Record<string, string> = {
  approved: "Aprobado",
  rejected: "Rechazado",
  edited: "Editado",
};

const HEADER_FILL = "FF0F6E63"; // teal-500
const TITLE_COLOR = "FF1B1F23"; // ink

interface ColumnDef {
  header: string;
  width: number;
  key: string;
}

const COLUMNS: ColumnDef[] = [
  { header: "Código interno", width: 16, key: "internal_code" },
  { header: "Código proveedor", width: 18, key: "supplier_code" },
  { header: "Descripción proveedor", width: 40, key: "supplier_description" },
  { header: "Descripción interna", width: 40, key: "internal_description" },
  { header: "Precio anterior", width: 16, key: "old_price" },
  { header: "Precio nuevo", width: 16, key: "new_price" },
  { header: "Diferencia", width: 14, key: "diff" },
  { header: "Porcentaje", width: 12, key: "percent" },
  { header: "Estado", width: 22, key: "state" },
  { header: "Estado del cambio", width: 16, key: "change_status" },
];

async function buildWorkbook(rows: ExportRow[], title: string, sheetName: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PriceCore";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

  // Fila de título
  sheet.mergeCells(1, 1, 1, COLUMNS.length);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: TITLE_COLOR } };
  titleCell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 26;

  // Fila 2 vacía como respiro visual
  sheet.getRow(2).height = 6;

  // Encabezado (fila 3)
  const headerRow = sheet.getRow(3);
  COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFFFFFFF" } } };
  });
  headerRow.height = 20;

  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COLUMNS.length } };

  // Filas de datos
  rows.forEach((row, idx) => {
    const excelRow = sheet.getRow(4 + idx);
    const oldPrice = row.change?.old_price ?? null;
    const newPrice = row.change ? row.change.final_new_price ?? row.change.new_price : row.item.parsed_price;

    excelRow.getCell(1).value = row.product?.code ?? "";
    excelRow.getCell(2).value = row.item.supplier_code;
    excelRow.getCell(3).value = row.item.supplier_description;
    excelRow.getCell(4).value = row.product?.description ?? "";
    excelRow.getCell(5).value = oldPrice;
    excelRow.getCell(6).value = newPrice;
    excelRow.getCell(7).value = row.change?.diff_absolute ?? null;
    excelRow.getCell(8).value = row.change?.diff_percent ?? null;
    excelRow.getCell(9).value = STATE_LABELS[row.item.match_state];
    excelRow.getCell(10).value = row.change ? CHANGE_STATUS_LABELS[row.change.status] ?? row.change.status : "";

    [5, 6, 7].forEach((col) => {
      excelRow.getCell(col).numFmt = '"$" #,##0.00';
    });
    excelRow.getCell(8).numFmt = '0.0"%"';

    const stateCell = excelRow.getCell(9);
    const colors = STATE_COLORS[row.item.match_state];
    stateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.fill } };
    stateCell.font = { color: { argb: colors.font }, bold: true, size: 10 };
    stateCell.alignment = { vertical: "middle" };

    // Bandas alternadas para que se lea mejor con muchas filas
    if (idx % 2 === 1) {
      for (let col = 1; col <= COLUMNS.length; col++) {
        if (col === 9) continue; // no pisar el color de estado
        excelRow.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F8F9" } };
      }
    }

    for (let col = 1; col <= COLUMNS.length; col++) {
      excelRow.getCell(col).border = { bottom: { style: "hair", color: { argb: "FFE4E8EC" } } };
    }
  });

  return workbook;
}

async function downloadWorkbook(workbook: ExcelJS.Workbook, fileName: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Exporta todos los resultados de la sesión, con las dos descripciones (proveedor e interna) — ocultá o borrá la que no necesites al imprimir. */
export async function exportAllResults(rows: ExportRow[], fileName: string) {
  const workbook = await buildWorkbook(rows, "PriceCore — Resultados de la comparación", "Resultados");
  await downloadWorkbook(workbook, fileName);
}

/** Exporta solo los cambios aprobados — el archivo que efectivamente se usa para actualizar el sistema de gestión. */
export async function exportApprovedOnly(rows: ExportRow[], fileName: string) {
  const approved = rows.filter((r) => r.change?.status === "approved");
  const workbook = await buildWorkbook(approved, "PriceCore — Cambios aprobados", "Aprobados");
  await downloadWorkbook(workbook, fileName);
}
