import { useEffect, useState } from "react";
import { settingsRepo } from "@/lib/db";

export default function SettingsPage() {
  const [safeMin, setSafeMin] = useState(97);
  const [reviewMin, setReviewMin] = useState(50);
  const [maxCandidates, setMaxCandidates] = useState(250);
  const [codeFamily, setCodeFamily] = useState(true);
  const [description, setDescription] = useState(true);
  const [remember, setRemember] = useState(true);
  const [autoExact, setAutoExact] = useState(true);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    settingsRepo.get().then(settings => {
      setSafeMin(settings.safe_min); setReviewMin(settings.review_min);
      setMaxCandidates(settings.max_candidates ?? 250);
      setCodeFamily(settings.enable_code_family ?? true);
      setDescription(settings.enable_description ?? true);
      setRemember(settings.remember_column_mapping ?? true);
      setAutoExact(settings.auto_confirm_exact ?? true);
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);
  const invalid = reviewMin >= safeMin;
  async function save() {
    if (invalid) return;
    setError(""); setSaved(false); setSaving(true);
    try {
      await settingsRepo.save({ safe_min: safeMin, review_min: reviewMin, max_candidates: maxCandidates,
        enable_code_family: codeFamily, enable_description: description,
        remember_column_mapping: remember, auto_confirm_exact: autoExact });
      setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  }
  if (loading) return <p className="text-sm text-steel-600">Cargando configuración…</p>;
  return <div className="mx-auto max-w-3xl">
    <p className="eyebrow">Cómo trabaja CompraCore</p>
    <h1 className="font-display text-2xl font-semibold">Configuración</h1>
    <p className="mb-6 mt-2 text-sm text-steel-600">Los cambios se aplican a las próximas comparaciones. Los códigos coincidentes siempre identifican el producto sin sugerencias adicionales.</p>
    <div className="space-y-4">
      <section className="panel p-5">
        <h2 className="font-display font-semibold">Similitud y cantidad de candidatos</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <Slider label="Identificación por descripción desde" value={safeMin} min={50} max={100} suffix="%" onChange={setSafeMin} />
          <Slider label="Enviar a revisión desde" value={reviewMin} min={0} max={95} suffix="%" onChange={setReviewMin} />
          <Slider label="Máximo de candidatos por descripción" value={maxCandidates} min={1} max={500} suffix="" onChange={setMaxCandidates} />
        </div>
        {invalid && <p className="mt-4 rounded bg-danger-50 p-3 text-xs text-danger-500">El umbral de revisión debe ser menor que el de identificación.</p>}
      </section>
      <section className="panel p-5">
        <h2 className="font-display font-semibold">Búsqueda y aprobación</h2>
        <div className="mt-4 space-y-3">
          <Toggle checked={codeFamily} onChange={setCodeFamily} label="Buscar familias de código" help="Busca códigos parecidos cuando no existe coincidencia exacta, normalizada ni una equivalencia aprendida." />
          <Toggle checked={description} onChange={setDescription} label="Buscar por descripción" help="Usa descripción, marca y unidad cuando el código no alcanza. Desactivar esta opción evita las sugerencias por texto." />
          <Toggle checked={autoExact} onChange={setAutoExact} label="Aprobar precios de códigos coincidentes" help="Decide si los precios válidos de códigos exactos y normalizados se aprueban solos o quedan pendientes. La identificación del producto sigue siendo automática." />
        </div>
      </section>
      <section className="panel p-5">
        <h2 className="font-display font-semibold">Importación</h2>
        <div className="mt-4"><Toggle checked={remember} onChange={setRemember} label="Recordar columnas por proveedor" help="Reutiliza la selección de columnas de la última lista cuando el formato sigue siendo válido." /></div>
        <p className="mt-4 text-xs text-steel-600">La moneda se toma de la columna mapeada o del proveedor. Monedas diferentes bloquean el precio. No se calcula IVA.</p>
      </section>
      {error && <p role="alert" className="text-sm text-danger-500">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        <span role="status" className="text-xs text-teal-600">{saved ? "Configuración guardada" : ""}</span>
        <button disabled={invalid || saving} onClick={save} className="rounded bg-teal-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar configuración"}</button>
      </div>
    </div>
  </div>;
}
function Slider({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
  return <label className="block"><span className="mb-1 flex justify-between text-sm"><span>{label}</span><b className="mono-num">{value}{suffix}</b></span><input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-teal-500" /></label>;
}
function Toggle({ checked, onChange, label, help }: { checked: boolean; onChange: (value: boolean) => void; label: string; help: string }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded border border-steel-100 p-3 hover:bg-steel-50"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-1" /><span><span className="block text-sm font-medium">{label}</span><span className="text-xs text-steel-600">{help}</span></span></label>;
}
