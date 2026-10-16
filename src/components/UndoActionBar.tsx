import { useEffect, useState } from "react";
import { latestUndoAction, undoLastAction } from "@/lib/undoHistory";
import type { UndoAction } from "@/types/database";
export default function UndoActionBar() {
  const [last, setLast] = useState<UndoAction | null>(null), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () => { latestUndoAction().then(action => { if (active) setLast(action); }).catch(() => { if (active) setError("No se pudo cargar el historial de acciones."); }); };
    refresh(); window.addEventListener("pricecore:history", refresh);
    return () => { active = false; window.removeEventListener("pricecore:history", refresh); };
  }, []);
  async function undo() {
    if (!last || busy) return;
    setBusy(true); setError(""); setMessage("");
    try { const label = await undoLastAction(last.id); setMessage(`Se deshizo: ${label}.`); setLast(await latestUndoAction()); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo deshacer."); }
    finally { setBusy(false); }
  }
  if (!last && !message && !error) return null;
  return <aside aria-label="Última acción" className="mb-4 rounded border border-teal-500 bg-white p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{last ? `Última acción: ${last.label}` : "No quedan acciones para deshacer"}</p>{last && <p className="mt-1 text-xs text-steel-600">{new Date(last.created_at).toLocaleString("es-AR")} · Se conservan hasta 20 acciones en este navegador.</p>}</div>{last && <button disabled={busy} onClick={undo} className="rounded bg-teal-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Deshaciendo…" : "Deshacer última acción"}</button>}</div>
    {message && <p role="status" className="mt-2 text-xs text-teal-600">{message}</p>}{error && <p role="alert" className="mt-2 text-xs text-danger-500">{error}</p>}
  </aside>;
}
