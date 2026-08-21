import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  ComparisonSession,
  Equivalence,
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
  equivalences: { key: string; value: Equivalence; indexes: { bySupplierCode: [string, string] } };
  priceLists: { key: string; value: PriceList };
  priceListItems: { key: string; value: PriceListItem; indexes: { byPriceList: string } };
  comparisonSessions: { key: string; value: ComparisonSession };
  priceChanges: { key: string; value: PriceChange; indexes: { bySession: string } };
}

const DB_NAME = "pricecore";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<PriceCoreDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<PriceCoreDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PriceCoreDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("suppliers", { keyPath: "id" });

        const columnConfig = db.createObjectStore("supplierColumnConfig", { keyPath: "id" });
        columnConfig.createIndex("bySupplier", "supplier_id");

        const products = db.createObjectStore("products", { keyPath: "id" });
        products.createIndex("byCode", "code", { unique: true });

        const equivalences = db.createObjectStore("equivalences", { keyPath: "id" });
        equivalences.createIndex("bySupplierCode", ["supplier_id", "supplier_code"]);

        db.createObjectStore("priceLists", { keyPath: "id" });

        const items = db.createObjectStore("priceListItems", { keyPath: "id" });
        items.createIndex("byPriceList", "price_list_id");

        db.createObjectStore("comparisonSessions", { keyPath: "id" });

        const changes = db.createObjectStore("priceChanges", { keyPath: "id" });
        changes.createIndex("bySession", "comparison_session_id");
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
  async get(id: string): Promise<Product | undefined> {
    const db = await getDB();
    return db.get("products", id);
  },
  async getMany(ids: string[]): Promise<Product[]> {
    const db = await getDB();
    const results = await Promise.all(ids.map((id) => db.get("products", id)));
    return results.filter((p): p is Product => Boolean(p));
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
