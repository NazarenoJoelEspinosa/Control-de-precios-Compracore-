import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { priceListItemsRepo, priceListsRepo, productsRepo, supplierColumnConfigRepo, suppliersRepo, settingsRepo } from "@/lib/db";
import { runMatchingForPriceList } from "@/lib/runMatching";
import { parseSpreadsheetFile, type ParsedFile } from "@/lib/fileParsing";
import { suggestColumnMapping, type ColumnMapping } from "@/lib/columnMapping";
import type { Supplier } from "@/types/database";

const STEPS = ["Proveedor", "Lista nueva", "Confirmar columnas", "Procesar"] as const;

export default function NewComparisonWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState<string>("");
  const [catalogSize, setCatalogSize] = useState<number | null>(null);

  const [supplierFile, setSupplierFile] = useState<File | null>(null);
  const [supplierParsed, setSupplierParsed] = useState<ParsedFile | null>(null);

  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [mappingRemembered, setMappingRemembered] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  useEffect(() => {
    suppliersRepo.list().then((all) => setSuppliers(all.filter((s) => s.active)));
  }, []);

  useEffect(() => {
    if (!supplierId) {
      setCatalogSize(null);
      return;
    }
    // El tamaño relevante es el de LA CARPETA de este proveedor — el
    // matching nunca mira el catálogo de los demás, así que avisar sobre el
    // total general sería engañoso.
    productsRepo.listBySupplier(supplierId).then((list) => setCatalogSize(list.length));
  }, [supplierId]);

  async function handleSupplierFile(file: File) {
    setSupplierFile(file);
    const parsed = await parseSpreadsheetFile(file);
    setSupplierParsed(parsed);

    const suggested = suggestColumnMapping(parsed.headers);
    const appSettings = await settingsRepo.get();
    const saved = appSettings.remember_column_mapping === false ? undefined : await supplierColumnConfigRepo.get(supplierId);
    if (saved) {
      // Sólo usamos el mapeo guardado si las columnas que recuerda todavía
      // existen en este archivo — si el proveedor cambió el formato, mejor
      // volver a sugerir en vez de mapear a una columna que ya no está.
      const savedMapping: ColumnMapping = {
        code: saved.code_column ?? undefined,
        description: saved.description_column ?? undefined,
        price: saved.price_column ?? undefined,
        unit: saved.unit_column ?? undefined,
        brand: saved.brand_column ?? undefined,
        ean: saved.ean_column ?? undefined,
        currency: saved.currency_column ?? undefined,
      };
      const stillValid = [savedMapping.code, savedMapping.description, savedMapping.price].every(
        (col) => !col || parsed.headers.includes(col)
      );
      if (stillValid && savedMapping.code && savedMapping.description && savedMapping.price) {
        setMapping(savedMapping);
        setMappingRemembered(true);
        return;
      }
    }
    setMapping(suggested);
    setMappingRemembered(false);
  }

  async function runComparison() {
    if (!supplierId || !supplierFile || !supplierParsed) return;
    setProcessing(true);
    setProcessError(null);
    try {
      await supplierColumnConfigRepo.save(supplierId, {
        code_column: mapping.code ?? null,
        description_column: mapping.description ?? null,
        price_column: mapping.price ?? null,
        unit_column: mapping.unit ?? null,
        brand_column: mapping.brand ?? null,
        ean_column: mapping.ean ?? null,
        currency_column: mapping.currency ?? null,
      });

      const priceList = await priceListsRepo.create({
        supplier_id: supplierId,
        file_name: supplierFile.name,
        row_count: supplierParsed.rows.length,
        status: "mapped",
        column_mapping: mapping as Record<string, string>,
      });

      await priceListItemsRepo.bulkCreate(
        supplierParsed.rows.map((row) => ({
          price_list_id: priceList.id,
          supplier_code: String(row[mapping.code ?? ""] ?? "").trim(),
          supplier_description: String(row[mapping.description ?? ""] ?? "").trim(),
          supplier_unit: String(row[mapping.unit ?? ""] ?? "").trim(),
          supplier_brand: String(row[mapping.brand ?? ""] ?? "").trim(),
          raw_price: String(row[mapping.price ?? ""] ?? ""),
          parsed_price: null,
          parse_error: null,
          matched_product_id: null,
          match_level: null,
          match_score: null,
          match_state: "not_found" as const,
          raw_data: row,
        }))
      );

      const sessionId = await runMatchingForPriceList(priceList.id, supplierId);
      navigate(`/comparisons/${sessionId}`);
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : "Ocurrió un error al procesar.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">Asistente</p>
      <h1 className="mb-6 font-display text-2xl font-semibold text-ink">Nueva comparación</h1>

      {catalogSize === 0 && (
        <div className="mb-4 rounded border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-600">
          Todavía no cargaste el catálogo de este proveedor — sin eso, todo va a salir como "no encontrado".{" "}
          <Link to="/catalog" className="font-semibold underline">
            Cargarlo ahora
          </Link>
        </div>
      )}

      <ol className="mb-8 flex items-center gap-2">
        {STEPS.map((label, idx) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <div
              className={clsx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                idx <= step ? "bg-teal-500 text-white" : "bg-steel-100 text-steel-300"
              )}
            >
              {idx + 1}
            </div>
            <span className={clsx("hidden text-xs md:block", idx === step ? "text-ink font-medium" : "text-steel-300")}>
              {label}
            </span>
            {idx < STEPS.length - 1 && <div className="h-px flex-1 bg-steel-100" />}
          </li>
        ))}
      </ol>

      <div className="panel p-6">
        {step === 0 && (
          <StepSupplier suppliers={suppliers} value={supplierId} onChange={setSupplierId} onNext={() => setStep(1)} />
        )}

        {step === 1 && (
          <StepUpload
            file={supplierFile}
            onFile={handleSupplierFile}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
            nextDisabled={!supplierParsed}
          />
        )}

        {step === 2 && supplierParsed && (
          <StepMapping
            headers={supplierParsed.headers}
            mapping={mapping}
            remembered={mappingRemembered}
            onChange={(m) => {
              setMapping(m);
              setMappingRemembered(false); // si lo toca a mano, ya no es "el recordado tal cual"
            }}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            previewRows={supplierParsed.rows.slice(0, 6)}
          />
        )}

        {step === 3 && (
          <StepProcess
            processing={processing}
            error={processError}
            onBack={() => setStep(2)}
            onRun={runComparison}
            itemCount={supplierParsed?.rows.length ?? 0}
          />
        )}
      </div>
    </div>
  );
}

function StepSupplier({
  suppliers,
  value,
  onChange,
  onNext,
}: {
  suppliers: Supplier[];
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="mb-1 font-display text-lg font-semibold text-ink">Paso 1 — Seleccionar proveedor</h2>
      <p className="mb-4 text-sm text-steel-600">¿De qué proveedor es la lista que vas a cargar?</p>
      {suppliers.length === 0 ? (
        <p className="text-sm text-steel-600">
          Todavía no cargaste proveedores. Andá a la sección Proveedores para crear uno primero.
        </p>
      ) : (
        <div className="space-y-2">
          {suppliers.map((s) => (
            <label
              key={s.id}
              className={clsx(
                "flex cursor-pointer items-center gap-3 rounded border px-3 py-2 text-sm",
                value === s.id ? "border-teal-500 bg-teal-50" : "border-steel-200"
              )}
            >
              <input type="radio" name="supplier" checked={value === s.id} onChange={() => onChange(s.id)} />
              {s.name}
            </label>
          ))}
        </div>
      )}
      <div className="mt-6 flex justify-end">
        <button
          disabled={!value}
          onClick={onNext}
          className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-40"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

function StepUpload({
  file,
  onFile,
  onBack,
  onNext,
  nextDisabled,
}: {
  file: File | null;
  onFile: (f: File) => void;
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div>
      <h2 className="mb-1 font-display text-lg font-semibold text-ink">Paso 2 — Cargar lista nueva del proveedor</h2>
      <p className="mb-4 text-sm text-steel-600">
        XLSX, XLS o CSV. Detectamos automáticamente el formato y la fila de encabezado.
      </p>
      <label className="flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-steel-200 px-6 py-10 text-center hover:border-teal-500">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <span className="text-sm font-medium text-ink">{file ? file.name : "Hacé click para elegir un archivo"}</span>
        <span className="mt-1 text-xs text-steel-300">XLSX, XLS o CSV</span>
      </label>
      <div className="mt-6 flex justify-between">
        <button onClick={onBack} className="rounded px-4 py-2 text-sm font-medium text-steel-600 hover:bg-steel-50">
          Atrás
        </button>
        <button
          disabled={nextDisabled}
          onClick={onNext}
          className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-40"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

const FIELD_LABELS: Record<keyof ColumnMapping, string> = {
  code: "Código",
  description: "Descripción",
  price: "Precio",
  unit: "Unidad",
  brand: "Marca",
  ean: "EAN",
  currency: "Moneda",
};

function StepMapping({
  headers,
  mapping,
  remembered,
  onChange,
  onBack,
  onNext,
  previewRows,
}: {
  headers: string[];
  mapping: ColumnMapping;
  remembered: boolean;
  onChange: (m: ColumnMapping) => void;
  onBack: () => void;
  onNext: () => void;
  previewRows: Record<string, unknown>[];
}) {
  const requiredOk = mapping.code && mapping.description && mapping.price;
  return (
    <div>
      <h2 className="mb-1 font-display text-lg font-semibold text-ink">Paso 3 — Confirmar columnas</h2>
      <p className="mb-4 text-sm text-steel-600">
        {remembered
          ? "Reconocimos este formato de este proveedor y ya completamos el mapeo que usaste la última vez. Revisá que siga siendo correcto."
          : "Detectamos esto automáticamente. Revisá y corregí si hace falta antes de procesar."}
      </p>
      <div className="space-y-3">
        {(Object.keys(FIELD_LABELS) as (keyof ColumnMapping)[]).map((field) => (
          <div key={field} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-sm font-medium text-steel-800">
              {FIELD_LABELS[field]}
              {(field === "code" || field === "description" || field === "price") && (
                <span className="text-danger-500"> *</span>
              )}
            </span>
            <select
              value={mapping[field] ?? ""}
              onChange={(e) => onChange({ ...mapping, [field]: e.target.value || undefined })}
              className="flex-1 rounded border border-steel-200 px-3 py-1.5 text-sm focus:border-teal-500"
            >
              <option value="">— no mapear —</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {!requiredOk && (
        <p className="mt-3 text-xs text-amber-600">Código, descripción y precio son obligatorios para continuar.</p>
      )}
      <div className="mt-6 overflow-hidden rounded border border-steel-100">
        <div className="border-b border-steel-100 bg-steel-50 px-3 py-2 text-xs font-semibold text-steel-700">Vista previa de la lista</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-xs"><thead className="border-b border-steel-100"><tr>
            {(["code","description","unit","price","brand"] as const).map(field=><th key={field} className="px-3 py-2 text-left font-medium text-steel-600">{FIELD_LABELS[field]}</th>)}
          </tr></thead><tbody className="divide-y divide-steel-100">
            {previewRows.map((row,i)=><tr key={i}><td className="px-3 py-2">{String(row[mapping.code ?? ""] ?? "")}</td><td className="px-3 py-2">{String(row[mapping.description ?? ""] ?? "")}</td><td className="px-3 py-2">{String(row[mapping.unit ?? ""] ?? "")}</td><td className="px-3 py-2">{String(row[mapping.price ?? ""] ?? "")}</td><td className="px-3 py-2">{String(row[mapping.brand ?? ""] ?? "")}</td></tr>)}
          </tbody></table>
        </div>
      </div>
      <div className="mt-6 flex justify-between">
        <button onClick={onBack} className="rounded px-4 py-2 text-sm font-medium text-steel-600 hover:bg-steel-50">
          Atrás
        </button>
        <button
          disabled={!requiredOk}
          onClick={onNext}
          className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-40"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

function StepProcess({
  processing,
  error,
  itemCount,
  onBack,
  onRun,
}: {
  processing: boolean;
  error: string | null;
  itemCount: number;
  onBack: () => void;
  onRun: () => void;
}) {
  return (
    <div>
      <h2 className="mb-1 font-display text-lg font-semibold text-ink">Paso 4 — Procesar</h2>
      <p className="mb-4 text-sm text-steel-600">
        Vamos a comparar <span className="mono-num font-medium text-ink">{itemCount}</span> productos contra tu
        catálogo guardado. Corre acá mismo, en tu navegador.
      </p>
      {error && <p className="mb-4 rounded bg-danger-50 px-3 py-2 text-sm text-danger-500">{error}</p>}
      <div className="flex justify-between">
        <button
          onClick={onBack}
          disabled={processing}
          className="rounded px-4 py-2 text-sm font-medium text-steel-600 hover:bg-steel-50 disabled:opacity-40"
        >
          Atrás
        </button>
        <button
          onClick={onRun}
          disabled={processing}
          className="rounded bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-60"
        >
          {processing ? "Procesando..." : "Procesar comparación"}
        </button>
      </div>
    </div>
  );
}
