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
  it("mantiene independientes las cantidades de tres artículos aunque compartan código", async () => {
    vi.mocked(productsRepo.listBySupplier).mockResolvedValue([100, 10, 1].map(q => ({ ...product, id: `p${q}`, code: "TOR", description: `Tornillo x${q}`, unit: `x${q}` })));
    await mount({ ...item, matched_product_id: null, supplier_description: "Tornillo x1000", supplier_unit: "x1000", match_state: "presentation_diff", candidate_product_ids: ["p100", "p10", "p1"] });
    expect(renderer.root.findAllByType("input").filter(i => i.props["aria-label"]?.startsWith("Cantidad propia TOR"))).toHaveLength(3);
    const supplierInputs = renderer.root.findAllByType("input").filter(i => i.props["aria-label"]?.startsWith("Cantidad proveedor TOR"));
    act(() => supplierInputs[0].props.onChange({ target: { value: "500" } }));
    const supplierValues = () => renderer.root.findAllByType("input").filter(i => i.props["aria-label"]?.startsWith("Cantidad proveedor TOR")).map(i => i.props.value);
    expect(supplierValues()).toEqual(["500", "1000", "1000"]);
    const ownInputs = renderer.root.findAllByType("input").filter(i => i.props["aria-label"]?.startsWith("Cantidad propia TOR"));
    act(() => ownInputs[2].props.onChange({ target: { value: "2" } }));
    expect(renderer.root.findAllByType("input").filter(i => i.props["aria-label"]?.startsWith("Cantidad propia TOR")).map(i => i.props.value)).toEqual(["100", "10", "2"]);
    act(() => supplierInputs[1].props.onChange({ target: { value: "250" } }));
    expect(supplierValues()).toEqual(["500", "250", "1000"]);
    await act(async () => { await saveButton().props.onClick(); });
    expect(vi.mocked(savePresentations).mock.calls[0][2]).toEqual([
      { product_id: "p100", supplier_quantity: 500, own_quantity: 100 },
      { product_id: "p10", supplier_quantity: 250, own_quantity: 10 },
      { product_id: "p1", supplier_quantity: 1000, own_quantity: 2 },
    ]);
  });
  it("edita kilo y unidad por separado, recalcula cada precio y guarda ambas relaciones", async () => {
    vi.mocked(productsRepo.listBySupplier).mockResolvedValue([
      { ...product, id: "kg", code: "DOG25540", description: "BRONCE EN VARILLA X KG", current_price: 68786 },
      { ...product, id: "unit", code: "DOG25540XU", description: "BRONCE EN VARILLA X U", current_price: 982.66 },
    ]);
    const value = { ...item, parsed_price: 69208, matched_product_id: "kg", matched_presentations: [
      { product_id: "kg", supplier_quantity: 1, own_quantity: 1 },
      { product_id: "unit", supplier_quantity: 70, own_quantity: 1 },
    ] };
    await mount(value);
    expect(text()).toContain("988,69");
    act(() => field("Cantidad proveedor DOG25540XU").props.onChange({ target: { value: "35" } }));
    expect(field("Cantidad proveedor DOG25540").props.value).toBe("1");
    expect(text()).toContain("1.977,37");
    act(() => field("Cantidad proveedor DOG25540").props.onChange({ target: { value: "2" } }));
    expect(field("Cantidad proveedor DOG25540XU").props.value).toBe("35");
    expect(text()).toContain("34.604,00");
    act(() => field("Cantidad propia DOG25540XU").props.onChange({ target: { value: "2" } }));
    expect(field("Cantidad propia DOG25540").props.value).toBe("1");
    act(() => field("Cantidad proveedor DOG25540").props.onChange({ target: { value: "" } }));
    expect(field("Cantidad proveedor DOG25540XU").props.value).toBe("35");
    act(() => field("Cantidad proveedor DOG25540").props.onChange({ target: { value: "2" } }));
    await act(async () => { await saveButton().props.onClick(); });
    expect(savePresentations).toHaveBeenCalledWith(session, value, [
      { product_id: "kg", supplier_quantity: 2, own_quantity: 1 },
      { product_id: "unit", supplier_quantity: 35, own_quantity: 2 },
    ]);
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
