import { resultStatus } from "./resultFilters";
import type { ExportRow } from "./exportResults";
import type { Currency } from "@/types/database";

interface ApprovedPrice {
  id: string; code: string; description: string; price: number; oldPrice: number; currency: Currency;
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
      oldPrice: change.old_price, currency: product.currency });
  }
  if (!prices.size) throw new Error("No hay cambios de precio aprobados para exportar.");
  return [...prices.values()].sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }) || a.description.localeCompare(b.description, "es") || a.id.localeCompare(b.id));
}

async function downloadPriceList(rows: ExportRow[], fileName: string, summary: boolean) {
  const prices = approvedPrices(rows);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CompraCore";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(summary ? "Cambios aprobados" : "Precios", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false, zoomScale: 100 }],
    pageSetup: { paperSize: 9, orientation: summary ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: "1:1", margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: "&LCompraCore&R&P / &N" },
  });
  sheet.columns = summary ? [
    { header: "Código", key: "code", width: 20 }, { header: "Descripción", key: "description", width: 62 },
    { header: "Precio anterior", key: "old", width: 19 }, { header: "Precio nuevo", key: "price", width: 19 },
    { header: "Diferencia", key: "difference", width: 18 }, { header: "Variación %", key: "percent", width: 17 },
    { header: "Moneda", key: "currency", width: 12 },
  ] : [
    { header: "Código", key: "code", width: 20 }, { header: "Descripción", key: "description", width: 64 },
    { header: "Precio", key: "price", width: 20 }, { header: "Moneda", key: "currency", width: 12 },
  ];
  const header = sheet.getRow(1);
  header.height = 30;
  header.eachCell(cell => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F6E63" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: prices.length + 1, column: sheet.columnCount } };
  for (const [index, value] of prices.entries()) {
    const difference = Math.round((value.price - value.oldPrice) * 100) / 100;
    const row = sheet.addRow({ code: value.code, description: value.description, price: value.price, currency: value.currency,
      old: value.oldPrice, difference, percent: value.oldPrice > 0 ? (value.price - value.oldPrice) / value.oldPrice : null });
    row.height = value.description.length > 60 ? 34 : 24;
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
    row.getCell("currency").alignment = { vertical: "middle", horizontal: "center" };
    if (summary) {
      row.getCell("old").numFmt = "#,##0.00";
      row.getCell("difference").numFmt = '#,##0.00;[Red]-#,##0.00';
      row.getCell("percent").numFmt = '0.00%;[Red]-0.00%';
    }
  }
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  try {
    const link = document.createElement("a"); link.href = url; link.download = fileName; link.click();
  } finally { URL.revokeObjectURL(url); }
}

/** Lista diaria: sólo código y descripción propios, precio final aprobado y moneda. */
export async function exportUpdatePriceList(rows: ExportRow[], fileName: string) { await downloadPriceList(rows, fileName, false); }
export async function exportApprovedChangeSummary(rows: ExportRow[], fileName: string) { await downloadPriceList(rows, fileName, true); }
