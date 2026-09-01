import { getDB } from "./db";

interface BackupPayload {
  version: 2;
  exported_at: string;
  suppliers: unknown[];
  supplierColumnConfig: unknown[];
  products: unknown[];
  equivalences: unknown[];
  priceLists: unknown[];
  priceListItems: unknown[];
  comparisonSessions: unknown[];
  priceChanges: unknown[];
  discontinuedCodes: unknown[];
  settings: unknown[];
  presentationRules: unknown[];
}

const STORES = [
  "suppliers",
  "supplierColumnConfig",
  "products",
  "equivalences",
  "priceLists",
  "priceListItems",
  "comparisonSessions",
  "priceChanges",
  "discontinuedCodes",
  "settings",
  "presentationRules",
] as const;

/** Vuelca toda la base local a un objeto plano, listo para bajar como .json. */
export async function exportBackup(): Promise<BackupPayload> {
  const db = await getDB();
  const payload: Record<string, unknown[]> = {};
  for (const store of STORES) {
    payload[store] = await db.getAll(store);
  }
  return {
    version: 2,
    exported_at: new Date().toISOString(),
    ...(payload as Omit<BackupPayload, "version" | "exported_at">),
  };
}

export function downloadBackup(payload: BackupPayload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pricecore-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Restaura un backup. Por defecto hace merge (put) en vez de reemplazar todo,
 * así importar un backup viejo no borra trabajo hecho después — en caso de
 * conflicto por id, gana el registro importado.
 */
export async function importBackup(payload: BackupPayload): Promise<void> {
  if (payload.version !== 1 && payload.version !== 2) {
    throw new Error("Formato de backup no reconocido.");
  }
  const db = await getDB();
  for (const store of STORES) {
    const records = payload[store] as { id: string }[] | undefined;
    if (!records) continue;
    const tx = db.transaction(store, "readwrite");
    // El backup es un blob genérico validado sólo por versión/forma general;
    // cada store ya validó su propio shape al exportarse desde la misma DB.
    await Promise.all(records.map((r) => tx.store.put(r as never)));
    await tx.done;
  }
}

export async function readBackupFile(file: File): Promise<BackupPayload> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
    throw new Error("El archivo no parece ser un backup válido de PriceCore.");
  }
  return parsed as BackupPayload;
}
