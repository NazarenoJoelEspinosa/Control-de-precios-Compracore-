import clsx from "clsx";
import type { MatchState } from "@/types/database";

const STATE_CONFIG: Record<MatchState, { label: string; dot: string; bg: string; text: string }> = {
  safe: { label: "Coincidencia segura", dot: "bg-success-500", bg: "bg-success-50", text: "text-success-500" },
  review: { label: "Revisar", dot: "bg-amber-400", bg: "bg-amber-50", text: "text-amber-600" },
  not_found: { label: "No encontrado", dot: "bg-danger-500", bg: "bg-danger-50", text: "text-danger-500" },
  new_product: { label: "Nuevo producto", dot: "bg-info-500", bg: "bg-info-50", text: "text-info-500" },
  presentation_diff: { label: "Presentación distinta", dot: "bg-violet-500", bg: "bg-violet-50", text: "text-violet-500" },
  discontinued: { label: "Discontinuado", dot: "bg-steel-300", bg: "bg-steel-100", text: "text-steel-600" },
};

export function MatchStateBadge({ state }: { state: MatchState }) {
  const cfg = STATE_CONFIG[state];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium", cfg.bg, cfg.text)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", cfg.dot)} aria-hidden />
      {cfg.label}
    </span>
  );
}

export function PriceDeltaBadge({ percent }: { percent: number | null }) {
  if (percent === null) {
    return <span className="text-xs text-steel-300">—</span>;
  }
  if (percent > 0) {
    return <span className="mono-num text-sm font-medium text-danger-500">▲ {percent.toFixed(1)}%</span>;
  }
  if (percent < 0) {
    return <span className="mono-num text-sm font-medium text-success-500">▼ {Math.abs(percent).toFixed(1)}%</span>;
  }
  return <span className="mono-num text-sm text-steel-600">Sin cambios</span>;
}
