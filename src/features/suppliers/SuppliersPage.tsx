import { useEffect, useState, type FormEvent } from "react";
import { suppliersRepo } from "@/lib/db";
import type { Supplier } from "@/types/database";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const list = await suppliersRepo.list();
    setSuppliers(list.sort((a, b) => a.name.localeCompare(b.name)));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="eyebrow">Configuración</p>
          <h1 className="font-display text-2xl font-semibold text-ink">Proveedores</h1>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600"
        >
          {showForm ? "Cancelar" : "Nuevo proveedor"}
        </button>
      </div>

      {showForm && (
        <SupplierForm
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {loading ? (
        <p className="text-sm text-steel-600">Cargando...</p>
      ) : suppliers.length === 0 ? (
        <p className="text-sm text-steel-600">Todavía no cargaste proveedores.</p>
      ) : (
        <div className="panel divide-y divide-steel-100">
          {suppliers.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">{s.name}</p>
                <p className="text-xs text-steel-600">
                  {s.default_currency} · {s.price_includes_vat ? `IVA incluido (${s.vat_rate}%)` : "Precio sin IVA"}
                </p>
              </div>
              <span className={`text-xs ${s.active ? "text-success-500" : "text-steel-300"}`}>
                {s.active ? "Activo" : "Inactivo"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SupplierForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"ARS" | "USD">("ARS");
  const [includesVat, setIncludesVat] = useState(false);
  const [vatRate, setVatRate] = useState(21);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await suppliersRepo.create({
        name,
        code: "",
        email: "",
        phone: "",
        active: true,
        default_currency: currency,
        price_includes_vat: includesVat,
        vat_rate: vatRate,
        notes: "",
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el proveedor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel mb-6 space-y-4 p-5">
      <div>
        <label className="mb-1 block text-sm font-medium text-steel-800">Nombre del proveedor</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-steel-800">Moneda de cotización</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as "ARS" | "USD")}
            className="w-full rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500"
          >
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-steel-800">¿El precio incluye IVA?</label>
          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-1.5 text-sm text-steel-800">
              <input type="radio" checked={includesVat} onChange={() => setIncludesVat(true)} /> Sí
            </label>
            <label className="flex items-center gap-1.5 text-sm text-steel-800">
              <input type="radio" checked={!includesVat} onChange={() => setIncludesVat(false)} /> No
            </label>
          </div>
        </div>
      </div>
      {!includesVat && (
        <div>
          <label className="mb-1 block text-sm font-medium text-steel-800">Alícuota de IVA (%)</label>
          <input
            type="number"
            step="0.5"
            value={vatRate}
            onChange={(e) => setVatRate(Number(e.target.value))}
            className="w-32 rounded border border-steel-200 px-3 py-2 text-sm focus:border-teal-500"
          />
        </div>
      )}
      {error && <p className="text-sm text-danger-500">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-60"
      >
        {saving ? "Guardando..." : "Guardar proveedor"}
      </button>
    </form>
  );
}
