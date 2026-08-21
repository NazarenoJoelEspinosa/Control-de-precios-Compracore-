import * as XLSX from "xlsx";
import Papa from "papaparse";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, unknown>[];
  headerRowIndex: number;
}

/**
 * Lee un XLSX/XLS/CSV y devuelve headers + filas como objetos.
 * Detecta automáticamente la fila de encabezado buscando la primera fila
 * con al menos 2 celdas de texto no vacías (evita romperse con títulos o
 * filas de metadata arriba del header real, un caso real visto en listas
 * de proveedores).
 */
export async function parseSpreadsheetFile(file: File): Promise<ParsedFile> {
  const isCsv = file.name.toLowerCase().endsWith(".csv");
  if (isCsv) {
    return parseCsv(file);
  }
  return parseXlsx(file);
}

async function parseXlsx(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });

  const headerRowIndex = findHeaderRow(matrix);
  const headers = (matrix[headerRowIndex] ?? []).map((h) => String(h ?? "").trim());
  const rows: Record<string, unknown>[] = [];

  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const rowArr = matrix[i];
    if (!rowArr || rowArr.every((c) => c === "" || c === null || c === undefined)) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = rowArr[idx] ?? "";
    });
    rows.push(obj);
  }

  return { headers: headers.filter(Boolean), rows, headerRowIndex };
}

async function parseCsv(file: File): Promise<ParsedFile> {
  const text = await file.text();
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  const headers = result.meta.fields ?? [];
  return { headers, rows: result.data, headerRowIndex: 0 };
}

function findHeaderRow(matrix: unknown[][]): number {
  const limit = Math.min(matrix.length, 15); // no vale la pena escanear más de 15 filas
  for (let i = 0; i < limit; i++) {
    const row = matrix[i] ?? [];
    const textCells = row.filter((c) => typeof c === "string" && c.trim().length > 1);
    if (textCells.length >= 2) return i;
  }
  return 0;
}
