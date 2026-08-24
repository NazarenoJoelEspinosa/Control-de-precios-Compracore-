import { useEffect, useState } from "react";
import { settingsRepo } from "@/lib/db";

export default function SettingsPage() {
  const [safeMin, setSafeMin] = useState(97);
  const [reviewMin, setReviewMin] = useState(50);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    settingsRepo.getThresholds().then((t) => {
      setSafeMin(t.safe_min);
      setReviewMin(t.review_min);
      setLoading(false);
    });
  }, []);

  async function handleSave() {
    await settingsRepo.setThresholds(safeMin, reviewMin);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <p className="text-sm text-steel-600">Cargando...</p>;

  const invalid = reviewMin >= safeMin;

  return (
    <div className="mx-auto max-w-lg">
      <p className="eyebrow">Configuración</p>
      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Umbrales de matching</h1>
      <p className="mb-6 text-sm text-steel-600">
        Definen cuándo un producto se considera "coincidencia segura" (automático) y cuándo se manda a "revisar" en
        vez de descartarlo directamente como "no encontrado". Se aplican en la próxima comparación que proceses.
      </p>

      <div className="panel space-y-6 p-6">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-medium text-steel-800">Coincidencia segura (automático) desde</label>
            <span className="mono-num text-sm font-semibold text-success-500">{safeMin}%</span>
          </div>
          <input
            type="range"
            min={50}
            max={100}
            value={safeMin}
            onChange={(e) => setSafeMin(Number(e.target.value))}
            className="w-full accent-teal-500"
          />
          <p className="mt-1 text-xs text-steel-300">
            Por debajo de esto, aunque el sistema encuentre un candidato, siempre pide confirmación humana.
          </p>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-medium text-steel-800">Mandar a "revisar" (en vez de "no encontrado") desde</label>
            <span className="mono-num text-sm font-semibold text-amber-600">{reviewMin}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={95}
            value={reviewMin}
            onChange={(e) => setReviewMin(Number(e.target.value))}
            className="w-full accent-amber-400"
          />
          <p className="mt-1 text-xs text-steel-300">
            Por debajo de esto, ni siquiera se muestra un candidato — directamente "no encontrado" para buscar a mano.
          </p>
        </div>

        {invalid && (
          <p className="rounded bg-danger-50 px-3 py-2 text-xs text-danger-500">
            El umbral de "revisar" tiene que ser menor que el de "coincidencia segura".
          </p>
        )}

        <button
          disabled={invalid}
          onClick={handleSave}
          className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-40"
        >
          Guardar
        </button>
        {saved && <span className="ml-3 text-xs text-teal-600">Guardado.</span>}
      </div>
    </div>
  );
}
