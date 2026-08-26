import { useEffect, useMemo, useState } from "react";
import { equivalencesRepo, getDB, productsRepo, suppliersRepo } from "@/lib/db";
import type { DiscontinuedCode, Equivalence, Product, Supplier } from "@/types/database";

interface EquivRow extends Equivalence {
  product_code?: string;
  product_description?: string;
}

export default function EquivalencesPage() {
  const [rows, setRows] = useState<EquivRow[]>([]);
  const [discRows, setDiscRows] = useState<DiscontinuedCode[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openSuppliers, setOpenSuppliers] = useState<Set<string>>(new Set());

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const confirmed = await equivalencesRepo.listConfirmed();
    const supplierList = await suppliersRepo.list();
    const products = await productsRepo.list();
    const productById = new Map(products.map((p: Product) => [p.id, p]));

    setSuppliers(supplierList);
    setRows(
      confirmed.map((e) => ({
        ...e,
        product_code: productById.get(e.product_id)?.code,
        product_description: productById.get(e.product_id)?.description,
      }))
    );

    const db = await getDB();
    setDiscRows(await db.getAll("discontinuedCodes"));
    setLoading(false);
  }

  async function removeEquivalence(id: string) {
    if (!window.confirm("¿Eliminar esta equivalencia? La próxima vez que aparezca este código, el sistema volverá a pedir revisión manual.")) return;
    const db = await getDB();
    await db.delete("equivalences", id);
    load();
  }

  async function removeDiscontinued(id: string) {
    if (!window.confirm("¿Reactivar este código? La próxima lista de este proveedor lo va a volver a evaluar normalmente.")) return;
    const db = await getDB();
    await db.delete("discontinuedCodes", id);
    load();
  }

  const q = search.toLowerCase();
  const matchesSearch = (r: EquivRow) =>
    !q || `${r.supplier_code} ${r.product_code} ${r.product_description}`.toLowerCase().includes(q);

  const groups = useMemo(() => {
    const bySupplier = new Map<string, { supplier: Supplier; equivalences: EquivRow[]; discontinued: DiscontinuedCode[] }>();
    for (const s of suppliers) {
      bySupplier.set(s.id, { supplier: s, equivalences: [], discontinued: [] });
    }
    for (const r of rows) {
      if (!matchesSearch(r)) continue;
      bySupplier.get(r.supplier_id)?.equivalences.push(r);
    }
    for (const d of discRows) {
      if (q && !d.supplier_code.toLowerCase().includes(q)) continue;
      bySupplier.get(d.supplier_id)?.discontinued.push(d);
    }
    return [...bySupplier.values()]
      .filter((g) => g.equivalences.length > 0 || g.discontinued.length > 0)
      .sort((a, b) => a.supplier.name.localeCompare(b.supplier.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, discRows, suppliers, search]);

  function toggle(supplierId: string) {
    setOpenSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) next.delete(supplierId);
      else next.add(supplierId);
      return next;
    });
  }

  return (
    <div>
      <p className="eyebrow">Memoria del sistema</p>
      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Diccionario de equivalencias</h1>
      <p className="mb-6 text-sm text-steel-600">
        Relaciones confirmadas entre códigos de proveedor y productos internos, agrupadas por proveedor. Un mismo
        producto puede tener varias equivalencias (una por cada presentación distinta que vende el proveedor).
      </p>

      <input
        placeholder="Buscar por código o descripción..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500"
      />

      {loading ? (
        <p className="text-sm text-steel-600">Cargando...</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-steel-600">Todavía no hay nada guardado acá.</p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = openSuppliers.has(g.supplier.id) || search.length > 0;
            const total = g.equivalences.length + g.discontinued.length;
            return (
              <div key={g.supplier.id} className="panel overflow-hidden">
                <button
                  onClick={() => toggle(g.supplier.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-steel-50"
                >
                  <span className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
                    <span className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                    {g.supplier.name}
                  </span>
                  <span className="text-xs text-steel-300">
                    {g.equivalences.length} equivalencia{g.equivalences.length !== 1 ? "s" : ""}
                    {g.discontinued.length > 0 && ` · ${g.discontinued.length} discontinuado${g.discontinued.length !== 1 ? "s" : ""}`}
                  </span>
                </button>

                {isOpen && total > 0 && (
                  <div className="border-t border-steel-100">
                    {g.equivalences.length > 0 && (
                      <table className="w-full text-sm">
                        <thead className="border-b border-steel-100 bg-steel-50 text-left text-xs font-medium text-steel-600">
                          <tr>
                            <th className="px-4 py-2">Código proveedor</th>
                            <th className="px-4 py-2">Producto interno</th>
                            <th className="px-4 py-2">Descripción</th>
                            <th className="px-4 py-2">Origen</th>
                            <th className="px-4 py-2">Fecha</th>
                            <th className="px-4 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-steel-100">
                          {g.equivalences.map((r) => (
                            <tr key={r.id} className="hover:bg-steel-50">
                              <td className="mono-num px-4 py-2 text-steel-600">{r.supplier_code}</td>
                              <td className="mono-num px-4 py-2 text-ink">{r.product_code}</td>
                              <td className="max-w-xs truncate px-4 py-2 text-steel-600">{r.product_description}</td>
                              <td className="px-4 py-2 text-xs text-steel-600">
                                {r.origin === "manual" ? "Manual" : "Automático"}
                              </td>
                              <td className="px-4 py-2 text-xs text-steel-600">
                                {new Date(r.updated_at).toLocaleDateString("es-AR")}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <button onClick={() => removeEquivalence(r.id)} className="text-xs text-danger-500 hover:underline">
                                  Eliminar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {g.discontinued.length > 0 && (
                      <div className={g.equivalences.length > 0 ? "border-t border-steel-100" : ""}>
                        <p className="px-4 pt-3 text-xs font-medium text-steel-300">Discontinuados</p>
                        <table className="w-full text-sm">
                          <tbody className="divide-y divide-steel-100">
                            {g.discontinued.map((d) => (
                              <tr key={d.id} className="hover:bg-steel-50">
                                <td className="mono-num px-4 py-2 text-steel-600">{d.supplier_code}</td>
                                <td className="px-4 py-2 text-xs text-steel-600">
                                  {new Date(d.created_at).toLocaleDateString("es-AR")}
                                </td>
                                <td className="px-4 py-2 text-right">
                                  <button onClick={() => removeDiscontinued(d.id)} className="text-xs text-teal-600 hover:underline">
                                    Reactivar
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
