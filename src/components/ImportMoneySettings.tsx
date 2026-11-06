import { formatPrice } from "@/lib/normalize";
import { currencyChoice, importPrice, inspectImportMoney, type ImportMoneyOptions } from "@/lib/importMoney";
import type { ColumnMapping } from "@/lib/columnMapping";
import type { Currency } from "@/types/database";

export default function ImportMoneySettings({ rows, mapping, value, onChange }: {
  rows: Record<string, unknown>[]; mapping: ColumnMapping; value: ImportMoneyOptions; onChange: (v: ImportMoneyOptions) => void;
}) {
  const inspection = inspectImportMoney(rows, mapping, value);
  const examples = rows.filter(r => String(r[mapping.code ?? ""] ?? "").trim()).slice(0, 3);
  return <fieldset className="space-y-3 rounded border border-steel-200 p-3 text-sm">
    <legend className="px-1 font-semibold">Cómo leer los precios de esta lista</legend>
    <label className="block">Separadores de números<select aria-label="Separadores de números" className="field-control mt-1 w-full" value={value.numberFormat} onChange={e => onChange({ ...value, numberFormat: e.target.value as ImportMoneyOptions["numberFormat"] })}>
      <option value="auto">Detectar automáticamente</option><option value="comma_decimal">Coma decimal: 1.234,56</option><option value="dot_decimal">Punto decimal: 1,234.56</option>
    </select></label>
    <p className="text-xs text-steel-600">Los números nativos de Excel conservan su valor. Esta elección se aplica a precios guardados como texto.</p>
    {inspection.needsFormat && <p role="alert" className="text-amber-600">Hay importes como 1.500 o 1,500 que pueden significar 1500 o 1,5. Elegí el formato de esta lista para continuar.</p>}
    {inspection.conflicts.map(message => <p role="alert" className="text-danger-500" key={message}>{message}</p>)}
    {inspection.questions.map(label => <label className="block" key={label}>¿Qué moneda significa «{label}»?<select aria-label={`Moneda para ${label}`} className="field-control mt-1 w-full" value={currencyChoice(value, label) ?? ""} onChange={e => { const choices = { ...value.currencyChoices, [label]: e.target.value as Currency }; if (!e.target.value) delete choices[label]; onChange({ ...value, currencyChoices: choices }); }}><option value="">Elegir moneda</option><option value="ARS">ARS — Pesos</option><option value="USD">USD — Dólares</option></select></label>)}
    {mapping.price && <div className="space-y-1 text-xs"><p className="font-semibold">Vista previa del importe</p>{examples.map((r, i) => {
      const raw = r[mapping.price!]; let parsed: string;
      try { parsed = formatPrice(importPrice(raw, value)).replace(/^ARS /, ""); } catch (e) { parsed = e instanceof Error ? e.message : "Precio inválido"; }
      return <p key={i}>{String(raw ?? "")} → {parsed}</p>;
    })}</div>}
  </fieldset>;
}
