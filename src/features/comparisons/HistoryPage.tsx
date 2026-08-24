import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { comparisonSessionsRepo, priceListsRepo, suppliersRepo } from "@/lib/db";
import type { ComparisonSession } from "@/types/database";

interface Row extends ComparisonSession {
  supplier_name?: string;
  file_name?: string;
}

export default function HistoryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const sessions = await comparisonSessionsRepo.list();
    const suppliers = await suppliersRepo.list();
    const priceLists = await priceListsRepo.list();
    const supplierById = new Map(suppliers.map((s) => [s.id, s.name]));
    const listById = new Map(priceLists.map((l) => [l.id, l.file_name]));

    setRows(
      sessions.map((s) => ({
        ...s,
        supplier_name: supplierById.get(s.supplier_id),
        file_name: listById.get(s.price_list_id),
      }))
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar esta comparación? Se borra de forma permanente, junto con todos sus resultados.")) return;
    await comparisonSessionsRepo.remove(id);
    load();
  }

  return (
    <div>
      <p className="eyebrow">Registro</p>
      <h1 className="mb-6 font-display text-2xl font-semibold text-ink">Historial de comparaciones</h1>

      {loading ? (
        <p className="text-sm text-steel-600">Cargando...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-steel-600">Todavía no hay comparaciones registradas.</p>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-steel-100 bg-steel-50 text-left text-xs font-medium text-steel-600">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2">Archivo</th>
                <th className="px-3 py-2">Productos</th>
                <th className="px-3 py-2">Coincidencias</th>
                <th className="px-3 py-2">Revisión</th>
                <th className="px-3 py-2">No encontrados</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-steel-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-steel-50">
                  <td className="px-3 py-2">
                    <Link to={`/comparisons/${r.id}`} className="text-teal-600 hover:underline">
                      {new Date(r.created_at).toLocaleDateString("es-AR")}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink">{r.supplier_name ?? "—"}</td>
                  <td className="max-w-[160px] truncate px-3 py-2 text-steel-600">{r.file_name ?? "—"}</td>
                  <td className="mono-num px-3 py-2">{r.total_items}</td>
                  <td className="mono-num px-3 py-2 text-success-500">{r.safe_matches}</td>
                  <td className="mono-num px-3 py-2 text-amber-600">{r.review_items}</td>
                  <td className="mono-num px-3 py-2 text-danger-500">{r.not_found_items}</td>
                  <td className="px-3 py-2">
                    <span className={r.status === "open" ? "text-amber-600" : "text-success-500"}>
                      {r.status === "open" ? "Abierta" : "Cerrada"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => handleDelete(r.id)} className="text-xs text-danger-500 hover:underline">
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
