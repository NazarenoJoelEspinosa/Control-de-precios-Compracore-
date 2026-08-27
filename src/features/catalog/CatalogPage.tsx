import { useEffect, useState, type FormEvent } from "react";
import { getDB, productsRepo } from "@/lib/db";
import { parseSpreadsheetFile, type ParsedFile } from "@/lib/fileParsing";
import { suggestColumnMapping, type ColumnMapping } from "@/lib/columnMapping";
import { formatPrice, parseDecimal } from "@/lib/normalize";
import type { Product } from "@/types/database";

export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  async function load() {
    const all = await productsRepo.list();
    setProducts(all.sort((a, b) => a.description.localeCompare(b.description)));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = products.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.code.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="eyebrow">Tu catálogo</p>
          <h1 className="font-display text-2xl font-semibold text-ink">Productos y precios actuales</h1>
          <p className="mt-1 text-sm text-steel-600">
            Esto es lo que ya tenés cargado — se guarda en este navegador y las comparaciones lo usan
            automáticamente, sin volver a pedírtelo.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="rounded border border-steel-200 px-4 py-2 text-sm font-medium text-steel-600 hover:bg-steel-50"
          >
            {showAdd ? "Cancelar" : "Agregar producto"}
          </button>
          <button
            onClick={() => setShowImport((v) => !v)}
            className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600"
          >
            {showImport ? "Cancelar" : "Importar desde archivo"}
          </button>
        </div>
      </div>

      {showAdd && (
        <AddProductForm
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}

      {showImport && (
        <ImportCatalogForm
          onDone={() => {
            setShowImport(false);
            load();
          }}
        />
      )}

      {editing && (
        <EditProductForm
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <input
        placeholder="Buscar por código o descripción..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500"
      />

      {loading ? (
        <p className="text-sm text-steel-600">Cargando...</p>
      ) : products.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="font-display text-lg font-semibold text-ink">Todavía no cargaste tu catálogo</p>
          <p className="mt-1 text-sm text-steel-600">
            Importá el archivo con tus productos y precios actuales, o agregalos uno por uno.
          </p>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-steel-100 bg-steel-50 text-left text-xs font-medium text-steel-600">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2">Precio</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-steel-100">
              {filtered.slice(0, 300).map((p) => (
                <tr key={p.id} className="hover:bg-steel-50">
                  <td className="mono-num px-3 py-2 text-steel-600">{p.code}</td>
                  <td className="px-3 py-2 text-ink">{p.description}</td>
                  <td className="mono-num px-3 py-2 text-ink">{formatPrice(p.current_price, p.currency)}</td>
                  <td className="px-3 py-2">
                    <span className={p.active ? "text-success-500" : "text-steel-300"}>
                      {p.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(p)} className="text-xs text-teal-600 hover:underline">
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 300 && (
            <p className="px-4 py-2 text-center text-xs text-steel-300">
              Mostrando los primeros 300 de {filtered.length} resultados — refiná la búsqueda para ver el resto.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AddProductForm({ onSaved }: { onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("");
  const [currency, setCurrency] = useState<"ARS" | "USD">("ARS");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await productsRepo.upsertByCode({
        code: code.trim(),
        description: description.trim(),
        brand: "",
        unit,
        currency,
        current_price: Number(price.replace(",", ".")) || 0,
        active: true,
      });
      setCode("");
      setDescription("");
      setPrice("");
      setUnit("");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel mb-6 grid grid-cols-2 gap-4 p-5 md:grid-cols-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-steel-800">Código</label>
        <input required value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500" />
      </div>
      <div className="col-span-2">
        <label className="mb-1 block text-xs font-medium text-steel-800">Descripción</label>
        <input required value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-steel-800">Unidad</label>
        <input value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-steel-800">Precio</label>
        <input required value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-steel-800">Moneda</label>
        <select value={currency} onChange={(e) => setCurrency(e.target.value as "ARS" | "USD")} className="w-full rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500">
          <option value="ARS">ARS</option>
          <option value="USD">USD</option>
        </select>
      </div>
      <div className="flex items-end">
        <button type="submit" disabled={saving} className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-60">
          {saving ? "Guardando..." : "Agregar"}
        </button>
      </div>
      {error && <p className="col-span-full text-sm text-danger-500">{error}</p>}
    </form>
  );
}

function EditProductForm({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState(product.description);
  const [price, setPrice] = useState(String(product.current_price));
  const [unit, setUnit] = useState(product.unit);
  const [active, setActive] = useState(product.active);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const db = await getDB();
    await db.put("products", {
      ...product,
      description: description.trim(),
      unit,
      current_price: Number(price.replace(",", ".")) || 0,
      active,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20" onClick={onClose}>
      <form onSubmit={handleSubmit} className="panel w-full max-w-md space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
        <p className="mono-num text-xs text-steel-300">{product.code}</p>
        <div>
          <label className="mb-1 block text-xs font-medium text-steel-800">Descripción</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-steel-800">Unidad</label>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-steel-800">Precio</label>
            <input value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-steel-800">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Activo (participa en el matching)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm text-steel-600 hover:bg-steel-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-60">
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function parsePriceForImport(value: unknown): number {
  try {
    return parseDecimal(value);
  } catch {
    return 0;
  }
}

function ImportCatalogForm({ onDone }: { onDone: () => void }) {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    const p = await parseSpreadsheetFile(file);
    setParsed(p);
    setMapping(suggestColumnMapping(p.headers));
  }

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    setError(null);
    try {
      const products = parsed.rows.flatMap((row) => {
        const code = String(row[mapping.code ?? ""] ?? "").trim();
        if (!code) return [];

        return [{
          code,
          description: String(row[mapping.description ?? ""] ?? "").trim(),
          brand: String(row[mapping.brand ?? ""] ?? "").trim(),
          unit: String(row[mapping.unit ?? ""] ?? "").trim(),
          currency: "ARS" as const,
          current_price: parsePriceForImport(row[mapping.price ?? ""]),
          active: true,
        }];
      });

      await productsRepo.bulkUpsertByCode(products);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar el archivo.");
    } finally {
      setImporting(false);
    }
  }

  const requiredOk = mapping.code && mapping.description && mapping.price;

  return (
    <div className="panel mb-6 space-y-4 p-5">
      <p className="text-sm text-steel-600">
        Subí la exportación de tu sistema (código, descripción, precio). Los productos que ya existan por código se
        actualizan; los que no existan se agregan.
      </p>
      {!parsed ? (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-steel-200 px-6 py-8 text-center hover:border-teal-500">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <span className="text-sm font-medium text-ink">Hacé click para elegir un archivo</span>
        </label>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(["code", "description", "price", "unit"] as const).map((field) => (
              <div key={field}>
                <label className="mb-1 block text-xs font-medium text-steel-800">
                  {{ code: "Código", description: "Descripción", price: "Precio", unit: "Unidad" }[field]}
                  {field !== "unit" && <span className="text-danger-500"> *</span>}
                </label>
                <select
                  value={mapping[field] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || undefined })}
                  className="w-full rounded border border-steel-200 px-2 py-1.5 text-sm focus:border-teal-500"
                >
                  <option value="">— no mapear —</option>
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-danger-500">{error}</p>}
          <button
            disabled={!requiredOk || importing}
            onClick={handleImport}
            className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-40"
          >
            {importing ? "Importando..." : `Importar ${parsed.rows.length} productos`}
          </button>
        </>
      )}
    </div>
  );
}
