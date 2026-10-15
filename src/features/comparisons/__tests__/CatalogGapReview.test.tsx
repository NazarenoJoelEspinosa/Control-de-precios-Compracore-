import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CatalogGapReview from "../CatalogGapReview";
import { suppliersRepo } from "@/lib/db";
import { applyPrefixMatches } from "@/lib/applyPrefixMatches";
import { confirmMatch } from "@/lib/reviewActions";
import type { ComparisonSession, Product, PriceListItem } from "@/types/database";

vi.mock("@/lib/reviewActions", () => ({ confirmMatch: vi.fn() }));
vi.mock("@/lib/db", () => ({ suppliersRepo: { update: vi.fn() } }));
vi.mock("@/lib/applyPrefixMatches", () => ({ applyPrefixMatches: vi.fn() }));
const session = { id: "session", supplier_id: "supplier" } as ComparisonSession;
const products = Array.from({ length: 154 }, (_, i) => ({ id: `p${i}`, code: `CAT${i}`, description: `LLAVE EMTOP ${i}`, brand: "EMTOP", unit: "U", currency: "ARS", current_price: 5000 } as Product));
const items = Array.from({ length: 42 }, (_, i) => ({ id: `i${i}`, supplier_code: `PROV${i}`, supplier_description: `LLAVE EMTOP ${i}`, supplier_brand: "EMTOP", supplier_unit: "U", supplier_currency: "ARS", parsed_price: 5500 } as PriceListItem));
let renderer: ReactTestRenderer;
let values: Map<string, string>;
let refresh: ReturnType<typeof vi.fn>;
let keyHandler: (event: Partial<KeyboardEvent>) => void;
function button(label: string) {
  return renderer.root.findAllByType("button").find(b => b.children.join("") === label)!;
}
function heading() { return renderer.root.findByType("h3").children.join(""); }
function input(placeholder: string) { return renderer.root.findAllByType("input").find(i => i.props.placeholder === placeholder)!; }
async function click(node: ReactTestInstance) { await act(async () => { await node.props.onClick(); }); }
function mount(override: Partial<Parameters<typeof CatalogGapReview>[0]> = {}) {
  act(() => { renderer = create(<CatalogGapReview session={session} products={products} items={items} onRefresh={refresh} onClose={() => {}} {...override} />); });
}
beforeEach(() => {
  vi.clearAllMocks(); values = new Map(); refresh = vi.fn().mockResolvedValue(undefined);
  vi.mocked(confirmMatch).mockResolvedValue(undefined);
  vi.mocked(suppliersRepo.update).mockResolvedValue({} as never);
  vi.mocked(applyPrefixMatches).mockResolvedValue({ linked: 1, review: 0, linkedProductIds: ["p0"] });
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal("window", { addEventListener: (_: string, handler: typeof keyHandler) => { keyHandler = handler; }, removeEventListener: () => {} });
});
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

describe("revisión continua del catálogo", () => {
  it("permite activar la regla desde la comparación únicamente para su proveedor", async () => {
    mount(); expect(button("Aplicar a esta comparación").props.disabled).toBe(true);
    const checkbox = renderer.root.findByProps({ type: "checkbox" });
    await act(async () => { await checkbox.props.onChange({ target: { checked: true } }); });
    expect(suppliersRepo.update).toHaveBeenCalledWith("supplier", { ignore_et_prefix: true });
    expect(refresh).toHaveBeenCalledOnce(); expect(applyPrefixMatches).not.toHaveBeenCalled();
  });
  it("aplica la regla a la comparación actual y conserva el siguiente artículo pendiente", async () => {
    mount({ ignoreEtPrefix: true });
    refresh.mockImplementation(async () => renderer.update(<CatalogGapReview session={session} products={products.slice(1)} items={items} onRefresh={refresh} onClose={() => {}} ignoreEtPrefix />));
    await click(button("Aplicar a esta comparación"));
    expect(applyPrefixMatches).toHaveBeenCalledWith("session");
    expect(heading()).toBe("LLAVE EMTOP 1");
    expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain("1 artículos vinculados");
  });
  it("deja un artículo para después, avanza y permite recuperarlo", async () => {
    mount(); await click(button("Dejar para después →")); expect(heading()).toBe("LLAVE EMTOP 1");
    await click(button("Para después")); expect(heading()).toBe("LLAVE EMTOP 0");
    await click(button("Volver a pendientes")); await click(button("Pendientes"));
    expect(heading()).toBe("LLAVE EMTOP 0"); expect(confirmMatch).not.toHaveBeenCalled();
  });
  it("vincula un artículo lejano y continúa con el siguiente sin desmontar la lista", async () => {
    mount(); const list = renderer.root.findAllByType("div").find(n => n.props.className?.startsWith("relative max-h-60"));
    const row = renderer.root.findAllByType("button").find(b => b.props.children?.[0]?.props?.children?.[0] === 100)!;
    await click(row); expect(heading()).toBe("LLAVE EMTOP 99");
    act(() => input("Código o palabras de la descripción…").props.onChange({ target: { value: "PROV5" } }));
    refresh.mockImplementation(async () => {
      renderer.update(<CatalogGapReview session={session} products={products.filter(p => p.id !== "p99")} items={items.filter(i => i.id !== "i5")} onRefresh={refresh} onClose={() => {}} />);
    });
    await click(button("Vincular y seguir"));
    expect(confirmMatch).toHaveBeenCalledWith(session, items[5], products[99].id);
    expect(refresh).toHaveBeenCalledOnce(); expect(heading()).toBe("LLAVE EMTOP 100");
    expect(renderer.root.findAllByType("div")).toContain(list);
  });
  it("recuerda posición, búsquedas por artículo y los dejados para después", async () => {
    mount(); await click(button("Dejar para después →"));
    act(() => input("Código o palabras de la descripción…").props.onChange({ target: { value: "PROV1" } }));
    act(() => renderer.unmount()); mount();
    expect(heading()).toBe("LLAVE EMTOP 1"); expect(input("Código o palabras de la descripción…").props.value).toBe("PROV1");
    await click(button("Para después")); expect(heading()).toBe("LLAVE EMTOP 0");
    act(() => renderer.unmount()); mount(); expect(heading()).toBe("LLAVE EMTOP 0");
  });
  it("muestra un error sin avanzar si falla el guardado y permite reintentar", async () => {
    mount(); vi.mocked(confirmMatch).mockRejectedValueOnce(new Error("Falló el guardado"));
    await click(button("Vincular y seguir")); expect(heading()).toBe("LLAVE EMTOP 0");
    expect(renderer.root.findByProps({ role: "alert" }).children).toContain("Falló el guardado");
    expect(refresh).not.toHaveBeenCalled(); await click(button("Vincular y seguir")); expect(heading()).toBe("LLAVE EMTOP 1");
  });
  it("bloquea doble guardado y navegación mientras se vincula", async () => {
    mount(); let release!: () => void;
    vi.mocked(confirmMatch).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = button("Vincular y seguir").props.onClick(); });
    expect(button("Siguiente →").props.disabled).toBe(true);
    await act(async () => { await button("Guardando…").props.onClick(); });
    expect(confirmMatch).toHaveBeenCalledOnce();
    await act(async () => { release(); await pending; }); expect(heading()).toBe("LLAVE EMTOP 1");
  });
  it("permite buscar por varias palabras y ver más de ocho coincidencias", async () => {
    mount(); act(() => input("Código o palabras de la descripción…").props.onChange({ target: { value: "LLAVE EMTOP" } }));
    expect(renderer.root.findAllByType("button").filter(b => b.children.join("") === "Vincular y seguir")).toHaveLength(20);
    await click(button("Mostrar más (20 de 42)"));
    expect(renderer.root.findAllByType("button").filter(b => b.children.join("") === "Vincular y seguir")).toHaveLength(40);
    act(() => input("Código o palabras de la descripción…").props.onChange({ target: { value: "NO EXISTE" } }));
    expect(button("Vincular y seguir")).toBeUndefined(); expect(button("Dejar para después →")).toBeDefined();
  });
  it("prioriza códigos con/sin ET- en comparaciones existentes aunque no se parezcan las descripciones", async () => {
    mount({ ignoreEtPrefix: true, products: [{ ...products[0], code: "ABC123", description: "Artículo propio" }], items: [{ ...items[0], supplier_code: "ET-ABC123", supplier_description: "Texto proveedor diferente" }] });
    expect(button("Vincular y seguir")).toBeDefined();
    expect(renderer.root.findAllByType("p").some(p => p.children.join("").includes("Mismo código con/sin ET-"))).toBe(true);
    await click(button("Vincular y seguir")); expect(confirmMatch).toHaveBeenCalledWith(session, expect.objectContaining({ supplier_code: "ET-ABC123" }), products[0].id);
  });
  it("no aplica la regla de otro proveedor cuando está desactivada", () => {
    mount({ products: [{ ...products[0], code: "ABC123", description: "AAAA" }], items: [{ ...items[0], supplier_code: "ET-ABC123", supplier_description: "ZZZZ", supplier_brand: "", supplier_unit: "" }] });
    expect(button("Vincular y seguir")).toBeUndefined();
    expect(renderer.root.findAllByType("p").some(p => p.children.join("").includes("Mismo código con/sin ET-"))).toBe(false);
  });
  it("encuentra un código sin prefijo al buscar su variante ET-", () => {
    mount({ ignoreEtPrefix: true, products: [{ ...products[0], code: "ET-ABC123" }], items: [{ ...items[0], supplier_code: "ABC123" }] });
    act(() => input("Código o palabras de la descripción…").props.onChange({ target: { value: "ET-ABC123" } }));
    expect(button("Vincular y seguir")).toBeDefined();
  });
  it("navega con teclado y maneja la última vinculación", async () => {
    mount({ products: products.slice(0, 2) });
    act(() => keyHandler({ altKey: true, key: "ArrowRight", preventDefault() {} })); expect(heading()).toBe("LLAVE EMTOP 1");
    await click(button("Vincular y seguir")); expect(heading()).toBe("LLAVE EMTOP 0");
    act(() => renderer.update(<CatalogGapReview session={session} products={[]} items={[]} onRefresh={refresh} onClose={() => {}} />));
    expect(button("Vincular y seguir")).toBeUndefined(); expect(renderer.root.findByType("section")).toBeDefined();
  });
});
