import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Editor from "../PresentationConversionEditor";
import { productsRepo, equivalencesRepo } from "@/lib/db";
import { savePresentations } from "@/lib/savePresentations";
import type { Product, PriceListItem, ComparisonSession } from "@/types/database";
vi.mock("@/lib/db", () => ({ productsRepo: { listBySupplier: vi.fn() }, equivalencesRepo: { listForSupplier: vi.fn() } }));
vi.mock("@/lib/savePresentations", () => ({ savePresentations: vi.fn() }));
const product = { id: "p", code: "EMHU2E02", description: "ABRAZADERA", unit: "U", current_price: 212.58, currency: "ARS", active: true } as Product;
const item = { id: "i", supplier_code: "ET-EMHU2E02", supplier_description: "Abrazadera x 50uni EMTOP", supplier_unit: "", parsed_price: 10629.45, matched_product_id: "p" } as PriceListItem;
const session = { id: "s", supplier_id: "supplier" } as ComparisonSession;
let renderer: ReactTestRenderer;
let resolved: ReturnType<typeof vi.fn>;
let busy: ReturnType<typeof vi.fn>;
function field(label: string) { return renderer.root.findByProps({ "aria-label": label }); }
function text() { return JSON.stringify(renderer.toJSON()); }
function saveButton() { return renderer.root.findAllByType("button").find(b => b.children.join("") === "Guardar y seguir")!; }
async function mount(value = item) { await act(async () => { renderer = create(<Editor session={session} item={value} onResolved={resolved} onBusyChange={busy} saveLabel="Guardar y seguir" />); }); }
beforeEach(() => { vi.clearAllMocks(); resolved = vi.fn(); busy = vi.fn(); vi.mocked(productsRepo.listBySupplier).mockResolvedValue([product, { ...product, id: "p10", code: "PACK10", description: "Abrazadera x10", unit: "x10" }]); vi.mocked(equivalencesRepo.listForSupplier).mockResolvedValue([]); vi.mocked(savePresentations).mockResolvedValue(undefined); });
afterEach(() => { act(() => renderer?.unmount()); });
describe("enseñar presentaciones", () => {
  it("precarga el artículo identificado y las cantidades del texto, mostrando el cambio real", async () => {
    await mount(); expect(field("Cantidad proveedor EMHU2E02").props.value).toBe("50"); expect(field("Cantidad propia EMHU2E02").props.value).toBe("1");
    expect(text()).toContain("212,59"); expect(text()).toContain("0,01");
    await act(async () => { await saveButton().props.onClick(); });
    expect(savePresentations).toHaveBeenCalledWith(session, item, [{ product_id: "p", supplier_quantity: 50, own_quantity: 1 }]);
    expect(resolved).toHaveBeenCalledOnce(); expect(busy.mock.calls.map(c => c[0])).toEqual([true, false]);
  });
  it("permite agregar otra presentación del mismo artículo y hereda la cantidad proveedor", async () => {
    await mount(); const search = renderer.root.findByProps({ placeholder: "Buscar mi artículo por código o descripción…" });
    act(() => search.props.onChange({ target: { value: "PACK10" } }));
    const add = renderer.root.findAllByType("button").find(b => JSON.stringify(b.props.children).includes("PACK10"))!;
    act(() => add.props.onClick());
    expect(field("Cantidad proveedor PACK10").props.value).toBe("50"); expect(field("Cantidad propia PACK10").props.value).toBe("10");
    await act(async () => { await saveButton().props.onClick(); });
    expect(vi.mocked(savePresentations).mock.calls[0][2]).toHaveLength(2);
  });
  it("mantiene tres artículos con el mismo código y comparte la cantidad del proveedor", async () => {
    vi.mocked(productsRepo.listBySupplier).mockResolvedValue([100, 10, 1].map(q => ({ ...product, id: `p${q}`, code: "TOR", description: `Tornillo x${q}`, unit: `x${q}` })));
    await mount({ ...item, matched_product_id: null, supplier_description: "Tornillo x1000", supplier_unit: "x1000", match_state: "presentation_diff", candidate_product_ids: ["p100", "p10", "p1"] });
    expect(renderer.root.findAllByType("input").filter(i => i.props["aria-label"]?.startsWith("Cantidad propia TOR"))).toHaveLength(3);
    const supplierInputs = renderer.root.findAllByType("input").filter(i => i.props["aria-label"]?.startsWith("Cantidad proveedor TOR"));
    act(() => supplierInputs[0].props.onChange({ target: { value: "500" } }));
    expect(renderer.root.findAllByType("input").filter(i => i.props["aria-label"]?.startsWith("Cantidad proveedor TOR")).every(i => i.props.value === "500")).toBe(true);
    await act(async () => { await saveButton().props.onClick(); });
    expect(vi.mocked(savePresentations).mock.calls[0][2]).toEqual([100, 10, 1].map(q => ({ product_id: `p${q}`, supplier_quantity: 500, own_quantity: q })));
  });
  it("no deduce cantidades a partir de la diferencia de precio y conserva campos si falla el guardado", async () => {
    await mount({ ...item, supplier_description: "Abrazadera", supplier_unit: "" });
    expect(field("Cantidad proveedor EMHU2E02").props.value).toBe("");
    act(() => field("Cantidad proveedor EMHU2E02").props.onChange({ target: { value: "50" } }));
    vi.mocked(savePresentations).mockRejectedValueOnce(new Error("Sin conexión a la base"));
    await act(async () => { await saveButton().props.onClick(); });
    expect(field("Cantidad proveedor EMHU2E02").props.value).toBe("50"); expect(resolved).not.toHaveBeenCalled(); expect(renderer.root.findByProps({ role: "alert" }).children).toContain("Sin conexión a la base");
  });
});
