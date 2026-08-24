import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { comparisonSessionsRepo } from "@/lib/db";
import type { ComparisonSession } from "@/types/database";

interface Totals {
  analyzed: number;
  safe: number;
  review: number;
  notFound: number;
  increases: number;
  decreases: number;
  unchanged: number;
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<ComparisonSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    comparisonSessionsRepo.list().then((all) => {
      setSessions(all.slice(0, 10));
      setLoading(false);
    });
  }, []);

  const totals: Totals = sessions.reduce(
    (acc, s) => ({
      analyzed: acc.analyzed + s.total_items,
      safe: acc.safe + s.safe_matches,
      review: acc.review + s.review_items,
      notFound: acc.notFound + s.not_found_items,
      increases: acc.increases + s.price_increases,
      decreases: acc.decreases + s.price_decreases,
      unchanged: acc.unchanged + s.price_unchanged,
    }),
    { analyzed: 0, safe: 0, review: 0, notFound: 0, increases: 0, decreases: 0, unchanged: 0 }
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="eyebrow">Resumen</p>
          <h1 className="font-display text-2xl font-semibold text-ink">Dashboard</h1>
        </div>
        <Link
          to="/comparisons/new"
          className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600"
        >
          Nueva comparación
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-steel-600">Cargando...</p>
      ) : sessions.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="font-display text-lg font-semibold text-ink">Todavía no hay comparaciones</p>
          <p className="mt-1 text-sm text-steel-600">
            Cargá una lista de precios de un proveedor para empezar.
          </p>
          <Link
            to="/comparisons/new"
            className="mt-4 inline-block rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600"
          >
            Nueva comparación
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Productos analizados" value={totals.analyzed} />
            <StatCard label="Coincidencias automáticas" value={totals.safe} tone="text-success-500" />
            <StatCard label="Para revisar" value={totals.review} tone="text-amber-600" />
            <StatCard label="No encontrados" value={totals.notFound} tone="text-danger-500" />
            <StatCard label="Subieron" value={totals.increases} tone="text-danger-500" />
            <StatCard label="Bajaron" value={totals.decreases} tone="text-success-500" />
            <StatCard label="Sin cambios" value={totals.unchanged} />
          </div>

          <div className="mt-8">
            <p className="eyebrow mb-3">Comparaciones recientes</p>
            <div className="panel divide-y divide-steel-100">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-steel-50">
                  <Link to={`/comparisons/${s.id}`} className="flex flex-1 items-center gap-6">
                    <span className="text-ink">{new Date(s.created_at).toLocaleDateString("es-AR")}</span>
                    <span className="text-steel-600">{s.total_items} productos</span>
                    <span className="text-steel-600">{s.review_items} para revisar</span>
                    <span className={s.status === "open" ? "text-amber-600" : "text-success-500"}>
                      {s.status === "open" ? "Abierta" : "Cerrada"}
                    </span>
                  </Link>
                  <button
                    onClick={async () => {
                      if (!window.confirm("¿Eliminar esta comparación?")) return;
                      await comparisonSessionsRepo.remove(s.id);
                      setSessions((prev) => prev.filter((x) => x.id !== s.id));
                    }}
                    className="ml-3 text-xs text-danger-500 hover:underline"
                  >
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs font-medium text-steel-600">{label}</p>
      <p className={`mono-num mt-1 text-2xl font-semibold ${tone ?? "text-ink"}`}>
        {value.toLocaleString("es-AR")}
      </p>
    </div>
  );
}
