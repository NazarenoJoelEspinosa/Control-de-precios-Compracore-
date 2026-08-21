import { useEffect, useState } from "react";
import { equivalencesRepo, getDB, productsRepo, suppliersRepo } from "@/lib/db";
import type { Equivalence, Product, Supplier } from "@/types/database";

interface Row extends Equivalence {
  supplier_name?: string;
  product_code?: string;
  product_description?: string;
}

export default function EquivalencesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const confirmed = await equivalencesRepo.listConfirmed();
    const suppliers = await suppliersRepo.list();
    const products = await productsRepo.list();
    const supplierById = new Map(suppliers.map((s: Supplier) => [s.id, s.name]));
    const productById = new Map(products.map((p: Product) => [p.id, p]));

    setRows(
      confirmed
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((e) => ({
          ...e,
          supplier_name: supplierById.get(e.supplier_id),
          product_code: productById.get(e.product_id)?.code,
          product_description: productById.get(e.product_id)?.description,
        }))
    );
    setLoading(false);
  }

  async function removeEquivalence(id: string) {
    if (!window.confirm("¿Eliminar esta equivalencia? La próxima vez que aparezca este código, el sistema volverá a pedir revisión manual.")) return;
    const db = await getDB();
    await db.delete("equivalences", id);
    load();
  }

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return `${r.supplier_code} ${r.product_code} ${r.product_description}`.toLowerCase().includes(q);
  });

  return (
    <div>
      <p className="eyebrow">Memoria del sistema</p>
      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Diccionario de equivalencias</h1>
      <p className="mb-6 text-sm text-steel-600">
        Relaciones confirmadas entre códigos de proveedor y productos internos. Se usan automáticamente en la
        próxima comparación con ese proveedor.
      </p>

      <input
        placeholder="Buscar por código o descripción..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500"
      />

      {loading ? (
        <p className="text-sm text-steel-600">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-steel-600">Todavía no hay equivalencias confirmadas.</p>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-steel-100 bg-steel-50 text-left text-xs font-medium text-steel-600">
              <tr>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2">Código proveedor</th>
                <th className="px-3 py-2">Producto interno</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2">Origen</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-steel-100">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-steel-50">
                  <td className="px-3 py-2 text-ink">{r.supplier_name}</td>
                  <td className="mono-num px-3 py-2 text-steel-600">{r.supplier_code}</td>
                  <td className="mono-num px-3 py-2 text-ink">{r.product_code}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-steel-600">{r.product_description}</td>
                  <td className="px-3 py-2 text-xs text-steel-600">
                    {r.origin === "manual" ? "Confirmado manualmente" : "Automático"}
                  </td>
                  <td className="px-3 py-2 text-xs text-steel-600">
                    {new Date(r.updated_at).toLocaleDateString("es-AR")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => removeEquivalence(r.id)}
                      className="text-xs text-danger-500 hover:underline"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
