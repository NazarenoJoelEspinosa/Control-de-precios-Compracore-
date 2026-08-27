import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  ComparisonSession,
  DiscontinuedCode,
  Equivalence,
  MatchingSettings,
  PriceChange,
  PriceList,
  PriceListItem,
  Product,
  Supplier,
  SupplierColumnConfig,
} from "@/types/database";

interface PriceCoreDB extends DBSchema {
  suppliers: { key: string; value: Supplier };
  supplierColumnConfig: { key: string; value: SupplierColumnConfig; indexes: { bySupplier: string } };
  products: { key: string; value: Product; indexes: { byCode: string } };
  equivalences: {
    key: string;
    value: Equivalence;
    indexes: { bySupplierCode: [string, string]; bySupplier: string };
  };
  discontinuedCodes: {
    key: string;
    value: DiscontinuedCode;
    indexes: { bySupplierCode: [string, string]; bySupplier: string };
  };
  priceLists: { key: string; value: PriceList };
  priceListItems: { key: string; value: PriceListItem; indexes: { byPriceList: string } };
  comparisonSessions: { key: string; value: ComparisonSession };
  priceChanges: { key: string; value: PriceChange; indexes: { bySession: string } };
  settings: { key: string; value: MatchingSettings };
}

const DB_NAME = "pricecore";
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<PriceCoreDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<PriceCoreDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PriceCoreDB>(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        // Cada creación está guardada por `contains` para que esto funcione
        // tanto en una base nueva (todo se crea de una) como en una que ya
        // tenía una versión anterior (sólo se agrega lo nuevo, sin tocar lo
        // existente ni perder datos).
        if (!db.objectStoreNames.contains("suppliers")) {
          db.createObjectStore("suppliers", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("supplierColumnConfig")) {
          const s = db.createObjectStore("supplierColumnConfig", { keyPath: "id" });
          s.createIndex("bySupplier", "supplier_id");
        }
        if (!db.objectStoreNames.contains("products")) {
          const s = db.createObjectStore("products", { keyPath: "id" });
          s.createIndex("byCode", "code", { unique: true });
        }

        let equivStore = db.objectStoreNames.contains("equivalences")
          ? transaction.objectStore("equivalences")
          : (() => {
              const s = db.createObjectStore("equivalences", { keyPath: "id" });
              s.createIndex("bySupplierCode", ["supplier_id", "supplier_code"]);
              return s;
            })();
        // Índice nuevo: traer TODAS las equivalencias de un proveedor de una,
        // en vez de consultar la base una vez por cada código de la lista
        // (con 10.000 ítems, eso eran 10.000 consultas — el cuello de botella
        // principal de matching lento con listas grandes).
        if (!equivStore.indexNames.contains("bySupplier")) {
          equivStore.createIndex("bySupplier", "supplier_id");
        }

        let discStore = db.objectStoreNames.contains("discontinuedCodes")
          ? transaction.objectStore("discontinuedCodes")
          : (() => {
              const s = db.createObjectStore("discontinuedCodes", { keyPath: "id" });
              s.createIndex("bySupplierCode", ["supplier_id", "supplier_code"]);
              return s;
            })();
        if (!discStore.indexNames.contains("bySupplier")) {
          discStore.createIndex("bySupplier", "supplier_id");
        }

        if (!db.objectStoreNames.contains("priceLists")) {
          db.createObjectStore("priceLists", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("priceListItems")) {
          const s = db.createObjectStore("priceListItems", { keyPath: "id" });
          s.createIndex("byPriceList", "price_list_id");
        }
        if (!db.objectStoreNames.contains("comparisonSessions")) {
          db.createObjectStore("comparisonSessions", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("priceChanges")) {
          const s = db.createObjectStore("priceChanges", { keyPath: "id" });
          s.createIndex("bySession", "comparison_session_id");
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export function newId(): string {
  return crypto.randomUUID();
}
export function nowISO(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Repositorios — helpers finitos por store, para no repetir getDB() en cada
// componente. Cada método es una operación completa (no hay transacciones
// multi-store complejas: el volumen de datos de esta herramienta no las
// necesita).
// ---------------------------------------------------------------------------

export const discontinuedCodesRepo = {
  async has(supplierId: string, supplierCode: string): Promise<boolean> {
    const db = await getDB();
    const rows = await db.getAllFromIndex("discontinuedCodes", "bySupplierCode", [supplierId, supplierCode]);
    return rows.length > 0;
  },
  /** Trae TODOS los códigos discontinuados de un proveedor de una — usar
   * esto antes de un loop, nunca `has` por cada ítem. */
  async listForSupplier(supplierId: string): Promise<DiscontinuedCode[]> {
    const db = await getDB();
    return db.getAllFromIndex("discontinuedCodes", "bySupplier", supplierId);
  },
  async mark(supplierId: string, supplierCode: string): Promise<void> {
    const db = await getDB();
    const existing = await db.getAllFromIndex("discontinuedCodes", "bySupplierCode", [supplierId, supplierCode]);
    if (existing.length > 0) return;
    await db.put("discontinuedCodes", {
      id: newId(),
      supplier_id: supplierId,
      supplier_code: supplierCode,
      created_at: nowISO(),
    });
  },
  async unmark(supplierId: string, supplierCode: string): Promise<void> {
    const db = await getDB();
    const existing = await db.getAllFromIndex("discontinuedCodes", "bySupplierCode", [supplierId, supplierCode]);
    await Promise.all(existing.map((e) => db.delete("discontinuedCodes", e.id)));
  },
};

export const settingsRepo = {
  async getThresholds(): Promise<{ safe_min: number; review_min: number }> {
    const db = await getDB();
    const record = await db.get("settings", "thresholds");
    return record ? { safe_min: record.safe_min, review_min: record.review_min } : { safe_min: 97, review_min: 50 };
  },
  async setThresholds(safeMin: number, reviewMin: number): Promise<void> {
    const db = await getDB();
    await db.put("settings", { id: "thresholds", safe_min: safeMin, review_min: reviewMin });
  },
};

export const supplierColumnConfigRepo = {
  async get(supplierId: string): Promise<SupplierColumnConfig | undefined> {
    const db = await getDB();
    const rows = await db.getAllFromIndex("supplierColumnConfig", "bySupplier", supplierId);
    return rows[0];
  },
  /** Guarda (o actualiza) el mapeo confirmado por el usuario para este proveedor. */
  async save(supplierId: string, mapping: Omit<SupplierColumnConfig, "id" | "supplier_id">): Promise<void> {
    const db = await getDB();
    const existing = await this.get(supplierId);
    await db.put("supplierColumnConfig", {
      id: existing?.id ?? newId(),
      supplier_id: supplierId,
      ...mapping,
    });
  },
};

export const suppliersRepo = {
  async list(): Promise<Supplier[]> {
    const db = await getDB();
    return db.getAll("suppliers");
  },
  async get(id: string): Promise<Supplier | undefined> {
    const db = await getDB();
    return db.get("suppliers", id);
  },
  async create(input: Omit<Supplier, "id" | "created_at" | "updated_at">): Promise<Supplier> {
    const db = await getDB();
    const supplier: Supplier = { ...input, id: newId(), created_at: nowISO(), updated_at: nowISO() };
    await db.put("suppliers", supplier);
    return supplier;
  },
};

export const productsRepo = {
  async list(): Promise<Product[]> {
    const db = await getDB();
    return db.getAll("products");
  },
  async getByCode(code: string): Promise<Product | undefined> {
    const db = await getDB();
    return db.getFromIndex("products", "byCode", code);
  },
  /** Inserta o actualiza por código (usado al cargar la exportación de precios actuales). */
  async upsertByCode(input: Omit<Product, "id" | "created_at" | "updated_at">): Promise<Product> {
    const db = await getDB();
    const existing = await db.getFromIndex("products", "byCode", input.code);
    const record: Product = existing
      ? { ...existing, ...input, updated_at: nowISO() }
      : { ...input, id: newId(), created_at: nowISO(), updated_at: nowISO() };
    await db.put("products", record);
    return record;
  },
  /** Importación masiva en una sola transacción para evitar un viaje a IndexedDB por producto. */
  async bulkUpsertByCode(inputs: Omit<Product, "id" | "created_at" | "updated_at">[]): Promise<Product[]> {
    if (inputs.length === 0) return [];

    const db = await getDB();
    const existing = await db.getAll("products");
    const byCode = new Map(existing.map((product) => [product.code, product]));
    const now = nowISO();

    const records = inputs.map((input) => {
      const old = byCode.get(input.code);
      return old
        ? { ...old, ...input, updated_at: now }
        : { ...input, id: newId(), created_at: now, updated_at: now };
    });

    const tx = db.transaction("products", "readwrite");
    await Promise.all(records.map((record) => tx.store.put(record)));
    await tx.done;
    return records;
  },
  async get(id: string): Promise<Product | undefined> {
    const db = await getDB();
    return db.get("products", id);
  },
  async getMany(ids: string[]): Promise<Product[]> {
    const db = await getDB();
    const results = await Promise.all(ids.map((id) => db.get("products", id)));
    return results.filter((p): p is Product => Boolean(p));
  },
  /** Búsqueda simple por código o descripción — usada en la búsqueda manual del panel de revisión. */
  async search(query: string, limit = 25): Promise<Product[]> {
    const db = await getDB();
    const all = await db.getAll("products");
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return all
      .filter((p) => p.active && (p.code.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)))
      .slice(0, limit);
  },
};

export const equivalencesRepo = {
  async listConfirmed(): Promise<Equivalence[]> {
    const db = await getDB();
    const all = await db.getAll("equivalences");
    return all.filter((e) => e.decision === "confirmed");
  },
  async findForSupplierCode(supplierId: string, supplierCode: string): Promise<Equivalence[]> {
    const db = await getDB();
    return db.getAllFromIndex("equivalences", "bySupplierCode", [supplierId, supplierCode]);
  },
  /** Trae TODAS las equivalencias de un proveedor de una sola consulta —
   * usar esto antes de un loop, nunca `findForSupplierCode` por cada ítem. */
  async listForSupplier(supplierId: string): Promise<Equivalence[]> {
    const db = await getDB();
    return db.getAllFromIndex("equivalences", "bySupplier", supplierId);
  },
  async confirm(supplierId: string, supplierCode: string, productId: string): Promise<void> {
    const db = await getDB();
    const existing = (await db.getAllFromIndex("equivalences", "bySupplierCode", [supplierId, supplierCode])).find(
      (e) => e.product_id === productId
    );
    const record: Equivalence = existing
      ? { ...existing, decision: "confirmed", updated_at: nowISO() }
      : {
          id: newId(),
          supplier_id: supplierId,
          supplier_code: supplierCode,
          product_id: productId,
          decision: "confirmed",
          origin: "manual",
          confidence: null,
          created_at: nowISO(),
          updated_at: nowISO(),
        };
    await db.put("equivalences", record);
  },
  async reject(supplierId: string, supplierCode: string, productId: string): Promise<void> {
    const db = await getDB();
    const existing = (await db.getAllFromIndex("equivalences", "bySupplierCode", [supplierId, supplierCode])).find(
      (e) => e.product_id === productId
    );
    const record: Equivalence = existing
      ? { ...existing, decision: "rejected", updated_at: nowISO() }
      : {
          id: newId(),
          supplier_id: supplierId,
          supplier_code: supplierCode,
          product_id: productId,
          decision: "rejected",
          origin: "manual",
          confidence: null,
          created_at: nowISO(),
          updated_at: nowISO(),
        };
    await db.put("equivalences", record);
  },
  async remove(id: string): Promise<void> {
    const db = await getDB();
    await db.delete("equivalences", id);
  },
};

export const priceListsRepo = {
  async list(): Promise<PriceList[]> {
    const db = await getDB();
    return db.getAll("priceLists");
  },
  async get(id: string): Promise<PriceList | undefined> {
    const db = await getDB();
    return db.get("priceLists", id);
  },
  async create(input: Omit<PriceList, "id" | "created_at">): Promise<PriceList> {
    const db = await getDB();
    const record: PriceList = { ...input, id: newId(), created_at: nowISO() };
    await db.put("priceLists", record);
    return record;
  },
  async updateStatus(id: string, status: PriceList["status"]): Promise<void> {
    const db = await getDB();
    const record = await db.get("priceLists", id);
    if (record) await db.put("priceLists", { ...record, status });
  },
};

export const priceListItemsRepo = {
  async listByPriceList(priceListId: string): Promise<PriceListItem[]> {
    const db = await getDB();
    return db.getAllFromIndex("priceListItems", "byPriceList", priceListId);
  },
  async bulkCreate(items: Omit<PriceListItem, "id" | "created_at">[]): Promise<PriceListItem[]> {
    const db = await getDB();
    const tx = db.transaction("priceListItems", "readwrite");
    const records: PriceListItem[] = items.map((it) => ({ ...it, id: newId(), created_at: nowISO() }));
    await Promise.all(records.map((r) => tx.store.put(r)));
    await tx.done;
    return records;
  },
  async update(item: PriceListItem): Promise<void> {
    const db = await getDB();
    await db.put("priceListItems", item);
  },
  async bulkUpdate(items: PriceListItem[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("priceListItems", "readwrite");
    await Promise.all(items.map((it) => tx.store.put(it)));
    await tx.done;
  },
};

export const comparisonSessionsRepo = {
  async list(): Promise<ComparisonSession[]> {
    const db = await getDB();
    const all = await db.getAll("comparisonSessions");
    return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async get(id: string): Promise<ComparisonSession | undefined> {
    const db = await getDB();
    return db.get("comparisonSessions", id);
  },
  async create(input: Omit<ComparisonSession, "id" | "created_at">): Promise<ComparisonSession> {
    const db = await getDB();
    const record: ComparisonSession = { ...input, id: newId(), created_at: nowISO() };
    await db.put("comparisonSessions", record);
    return record;
  },
  async update(session: ComparisonSession): Promise<void> {
    const db = await getDB();
    await db.put("comparisonSessions", session);
  },
  /** Borra la sesión, la lista que la originó, sus ítems y los cambios de precio asociados. */
  async remove(sessionId: string): Promise<void> {
    const db = await getDB();
    const session = await db.get("comparisonSessions", sessionId);
    if (!session) return;

    const items = await db.getAllFromIndex("priceListItems", "byPriceList", session.price_list_id);
    const changes = await db.getAllFromIndex("priceChanges", "bySession", sessionId);

    const tx = db.transaction(["comparisonSessions", "priceLists", "priceListItems", "priceChanges"], "readwrite");
    await Promise.all([
      tx.objectStore("comparisonSessions").delete(sessionId),
      tx.objectStore("priceLists").delete(session.price_list_id),
      ...items.map((it) => tx.objectStore("priceListItems").delete(it.id)),
      ...changes.map((c) => tx.objectStore("priceChanges").delete(c.id)),
    ]);
    await tx.done;
  },
};

export const priceChangesRepo = {
  async listBySession(sessionId: string): Promise<PriceChange[]> {
    const db = await getDB();
    return db.getAllFromIndex("priceChanges", "bySession", sessionId);
  },
  async bulkCreate(items: Omit<PriceChange, "id" | "created_at">[]): Promise<PriceChange[]> {
    const db = await getDB();
    const tx = db.transaction("priceChanges", "readwrite");
    const records: PriceChange[] = items.map((it) => ({ ...it, id: newId(), created_at: nowISO() }));
    await Promise.all(records.map((r) => tx.store.put(r)));
    await tx.done;
    return records;
  },
  async update(change: PriceChange): Promise<void> {
    const db = await getDB();
    await db.put("priceChanges", change);
  },
  async updateMany(changes: PriceChange[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("priceChanges", "readwrite");
    await Promise.all(changes.map((c) => tx.store.put(c)));
    await tx.done;
  },
};
