import { useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { exportBackup, downloadBackup, readBackupFile, importBackup } from "@/lib/backup";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard" },
  { to: "/comparisons/new", label: "Nueva comparación" },
  { to: "/catalog", label: "Catálogo" },
  { to: "/history", label: "Historial" },
  { to: "/suppliers", label: "Proveedores" },
  { to: "/equivalences", label: "Diccionario" },
  { to: "/settings", label: "Configuración" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handleExport() {
    const payload = await exportBackup();
    downloadBackup(payload);
    setStatus("Backup descargado.");
    setTimeout(() => setStatus(null), 3000);
  }

  async function handleImportFile(file: File) {
    try {
      const payload = await readBackupFile(file);
      await importBackup(payload);
      setStatus("Backup importado. Recargando...");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "No se pudo importar el archivo.");
    }
  }

  return (
    <div className="min-h-screen bg-steel-50">
      <div className="flex">
        <aside className="sticky top-0 flex h-screen w-56 flex-col justify-between border-r border-steel-100 bg-white px-4 py-6">
          <div>
            <div className="mb-8 flex items-center gap-2 px-1">
              <div className="tag-cut h-6 w-6 bg-teal-500" />
              <span className="font-display text-lg font-semibold text-ink">PriceCore</span>
            </div>
            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    clsx(
                      "block rounded px-3 py-2 text-sm font-medium transition",
                      isActive ? "bg-teal-50 text-teal-600" : "text-steel-600 hover:bg-steel-50 hover:text-ink"
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="border-t border-steel-100 pt-4">
            <p className="mb-2 px-1 text-xs text-steel-300">
              Todo se guarda en este navegador. Hacé un backup de vez en cuando.
            </p>
            <button
              onClick={handleExport}
              className="w-full rounded px-3 py-2 text-left text-sm text-steel-600 hover:bg-steel-50 hover:text-ink"
            >
              ⭳ Exportar backup
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded px-3 py-2 text-left text-sm text-steel-600 hover:bg-steel-50 hover:text-ink"
            >
              ⭱ Importar backup
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
              }}
            />
            {status && <p className="mt-1 px-1 text-xs text-teal-600">{status}</p>}
          </div>
        </aside>
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
