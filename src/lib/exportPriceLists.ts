import { resultStatus } from "./resultFilters";
import type { ExportRow } from "./exportResults";
import type { Currency } from "@/types/database";
import { addDetailedResultsSheet } from "./exportResults";

interface ApprovedPrice {
  id: string; code: string; description: string; price: number; oldPrice: number; currency: Currency; supplierCodes: string[];
}

/** Un artículo propio por fila. No elegir arbitrariamente entre precios contradictorios. */
function approvedPrices(rows: ExportRow[]): ApprovedPrice[] {
  const prices = new Map<string, ApprovedPrice>();
  for (const row of rows) {
    if (resultStatus(row) !== "approved" || !row.product || !row.change) continue;
    const { product, change } = row;
    const price = change.final_new_price ?? change.new_price;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change.old_price) || !product.code.trim() || change.product_id !== product.id || change.new_currency !== product.currency) {
      throw new Error(`Revisá el precio aprobado de ${product.code}: no se puede incluir en la lista para actualizar.`);
    }
    if (price === change.old_price) continue;
    const previous = prices.get(product.id);
    if (previous && (previous.price !== price || previous.currency !== product.currency || previous.oldPrice !== change.old_price)) {
      throw new Error(`El artículo ${product.code} tiene precios aprobados distintos. Resolvé esa diferencia antes de exportar.`);
    }
    prices.set(product.id, { id: product.id, code: product.code, description: product.description, price,
      oldPrice: change.old_price, currency: product.currency, supplierCodes: [...new Set([...(previous?.supplierCodes ?? []), row.item.supplier_code])] });
  }
  if (!prices.size) throw new Error("No hay cambios de precio aprobados para exportar.");
  return [...prices.values()].sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }) || a.description.localeCompare(b.description, "es") || a.id.localeCompare(b.id));
}

async function downloadPriceList(rows: ExportRow[], fileName: string, summary: boolean, customTitle?: string) {
  const prices = approvedPrices(rows);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CompraCore";
  workbook.created = new Date();
  const custom = customTitle !== undefined;
  const headerRowNumber = custom ? 3 : 1;
  const sheet = workbook.addWorksheet(custom ? "Lista de precios" : summary ? "Cambios aprobados" : "Precios", {
    views: [{ state: "frozen", ySplit: headerRowNumber, showGridLines: false, zoomScale: 100 }],
    pageSetup: { paperSize: 9, orientation: summary || custom ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: custom ? "1:3" : "1:1", margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: "&LCompraCore&R&P / &N" },
  });
  sheet.columns = custom ? [
    { key: "code", width: 19 }, { key: "supplierCode", width: 23 }, { key: "description", width: 62 },
    { key: "old", width: 19 }, { key: "price", width: 19 }, { key: "difference", width: 18 }, { key: "percent", width: 16 },
  ] : summary ? [
    { header: "Código", key: "code", width: 20 }, { header: "Descripción", key: "description", width: 62 },
    { header: "Precio anterior", key: "old", width: 19 }, { header: "Precio nuevo", key: "price", width: 19 },
    { header: "Diferencia", key: "difference", width: 18 }, { header: "Variación %", key: "percent", width: 17 },
    { header: "Moneda", key: "currency", width: 12 },
  ] : [
    { header: "Código", key: "code", width: 20 }, { header: "Descripción", key: "description", width: 64 },
    { header: "Precio", key: "price", width: 20 }, { header: "Moneda", key: "currency", width: 12 },
  ];
  if (custom) {
    sheet.mergeCells("A1:G1"); sheet.getCell("A1").value = customTitle;
    sheet.getCell("A1").font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF243746" } };
    sheet.getRow(1).height = 28;
    sheet.mergeCells("A2:G2"); sheet.getCell("A2").value = "Sólo cambios aprobados · Rojo: subió · Verde: bajó · El detalle completo está en la segunda hoja";
    sheet.getCell("A2").font = { name: "Calibri", size: 10, color: { argb: "FF52606D" } };
    sheet.getRow(2).height = 22;
    sheet.getRow(3).values = ["Código interno", "Código proveedor", "Descripción interna", "Precio anterior", "Precio nuevo", "Diferencia", "Porcentaje"];
  }
  const header = sheet.getRow(headerRowNumber);
  header.height = 30;
  header.eachCell(cell => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F6E63" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  sheet.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: prices.length + headerRowNumber, column: sheet.columnCount } };
  for (const [index, value] of prices.entries()) {
    const difference = Math.round((value.price - value.oldPrice) * 100) / 100;
    const row = sheet.addRow({ code: value.code, description: value.description, price: value.price, currency: value.currency,
      supplierCode: value.supplierCodes.join(" / "),
      old: value.oldPrice, difference, percent: value.oldPrice > 0 ? (value.price - value.oldPrice) / value.oldPrice : null });
    row.height = Math.min(400, Math.max(24, Math.ceil(value.description.length / 58) * 14 + 6));
    row.eachCell(cell => {
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF243746" } };
      cell.alignment = { vertical: "middle" };
      cell.border = { bottom: { style: "hair", color: { argb: "FFE4EBEF" } } };
      if (index % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F6F6" } };
    });
    row.getCell("code").numFmt = "@";
    row.getCell("description").alignment = { vertical: "middle", wrapText: true };
    row.getCell("price").numFmt = "#,##0.00";
    row.getCell("price").font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF0F6E63" } };
    if (!custom) row.getCell("currency").alignment = { vertical: "middle", horizontal: "center" };
    if (summary || custom) {
      row.getCell("old").numFmt = "#,##0.00";
      row.getCell("difference").numFmt = '#,##0.00;[Red]-#,##0.00';
      row.getCell("percent").numFmt = '0.00%;[Red]-0.00%';
    }
    if (custom) {
      row.getCell("supplierCode").numFmt = "@";
      row.getCell("supplierCode").alignment = { vertical: "middle", wrapText: true };
      for (const key of ["old", "price", "difference"]) row.getCell(key).numFmt = value.currency === "USD" ? '"USD" #,##0.00' : '"$" #,##0.00';
      row.getCell("percent").numFmt = "0.0%";
      row.getCell("price").font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF243746" } };
      for (const key of ["difference", "percent"]) {
        row.getCell(key).fill = { type: "pattern", pattern: "solid", fgColor: { argb: difference > 0 ? "FFFDE9E7" : difference < 0 ? "FFE8F4EA" : "FFF0F2F4" } };
        row.getCell(key).font = { name: "Calibri", size: 11, bold: true, color: { argb: difference > 0 ? "FF9C2920" : difference < 0 ? "FF236B38" : "FF52606D" } };
      }
    }
  }
  if (custom) addDetailedResultsSheet(workbook, rows, `${customTitle} — Detalle completo`, "Detalle completo");
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  try {
    const link = document.createElement("a"); link.href = url; link.download = fileName; link.click();
  } finally { URL.revokeObjectURL(url); }
}

/** Lista diaria: sólo código y descripción propios, precio final aprobado y moneda. */
export async function exportUpdatePriceList(rows: ExportRow[], fileName: string) { await downloadPriceList(rows, fileName, false); }
export async function exportApprovedChangeSummary(rows: ExportRow[], fileName: string) { await downloadPriceList(rows, fileName, true); }
export async function exportCustomComparison(rows: ExportRow[], fileName: string, title = "CompraCore — Cambios aprobados") { await downloadPriceList(rows, fileName, true, title); }
