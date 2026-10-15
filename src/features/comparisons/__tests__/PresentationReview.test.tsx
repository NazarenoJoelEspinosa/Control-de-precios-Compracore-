import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import PresentationReview from "../PresentationReview";
import type { ExportRow } from "@/lib/exportResults";
import type { ComparisonSession } from "@/types/database";
vi.mock("@/components/PresentationConversionEditor", () => ({ default: (props: { onResolved: () => Promise<void>; onBusyChange: (busy: boolean) => void }) => <button onClick={async () => { props.onBusyChange(true); try { await props.onResolved(); } finally { props.onBusyChange(false); } }}>Guardar y seguir</button> }));
const session = { id: "s" } as ComparisonSession;
const rows = Array.from({ length: 3 }, (_, i) => ({ product: { id: `p${i}`, code: `C${i}`, description: `Artículo ${i}`, current_price: 100, currency: "ARS" }, item: { id: `i${i}`, supplier_code: `C${i}`, supplier_description: `Artículo ${i} x50`, parsed_price: 5000, match_state: "safe", match_level: "exact_code", matched_product_id: `p${i}` }, change: { old_price: 100, new_price: 5000, final_new_price: null } } as ExportRow));
let renderer: ReactTestRenderer; let refresh: ReturnType<typeof vi.fn>; const storage = new Map<string, string>();
function button(label: string) { return renderer.root.findAllByType("button").find(b => b.children.join("") === label)!; }
function heading() { return renderer.root.findByType("h3").children.join(""); }
async function click(label: string) { await act(async () => { await button(label).props.onClick(); }); }
function mount(initialItemId?: string, data = rows) { act(() => { renderer = create(<PresentationReview session={session} rows={data} initialItemId={initialItemId} onRefresh={refresh} onClose={() => {}} />); }); }
beforeEach(() => { storage.clear(); refresh = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }); });
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
describe("revisión continua de presentaciones", () => {
  it("guarda y sigue sin desmontar la pantalla ni volver al primer artículo", async () => {
    mount(); await click("Siguiente →"); expect(heading()).toBe("Artículo 1");
    await click("Guardar y seguir"); expect(heading()).toBe("Artículo 2"); expect(refresh).toHaveBeenCalledOnce();
    await click("← Anterior"); expect(heading()).toBe("Artículo 0");
  });
  it("permite apartar, retomar y conservar la posición al volver", async () => {
    mount(); await click("Dejar para después →"); expect(heading()).toBe("Artículo 1"); await click("Para después"); expect(heading()).toBe("Artículo 0");
    act(() => renderer.unmount()); mount(); expect(heading()).toBe("Artículo 0"); await click("Volver a pendientes"); await click("Pendientes"); expect(heading()).toBe("Artículo 0");
  });
  it("abre directamente un artículo normal para enseñarlo y no duplica filas con varias presentaciones", () => {
    const normal = { ...rows[0], change: { ...rows[0].change!, new_price: 110 } };
    mount("i0", [normal, rows[1], rows[1]]); expect(heading()).toBe("Artículo 0");
    expect(renderer.root.findAllByProps({ "aria-current": "true" })).toHaveLength(1);
    expect(renderer.root.findAllByType("button").filter(b => b.props["aria-current"] !== undefined)).toHaveLength(1);
  });
  it("termina la ronda sin perder los apartados", async () => {
    mount(undefined, rows.slice(0, 1)); await click("Dejar para después →"); expect(renderer.root.findAllByType("h3")).toHaveLength(0);
    await click("Para después"); await click("Guardar y seguir"); expect(renderer.root.findAllByType("h3")).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain("No quedan presentaciones por revisar");
  });
});
