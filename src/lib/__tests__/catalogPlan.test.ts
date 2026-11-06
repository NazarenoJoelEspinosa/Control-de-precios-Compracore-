import { expect, it } from "vitest";
import { planCatalog, type CatalogInput } from "../catalogSync";
import type { Product } from "@/types/database";

it("no traslada memoria si la descripción cambia de x1 a x2 aunque la columna unidad siga diciendo x1", () => {
  const old: Product = { id: "old", supplier_id: "s", code: "A", description: "Tornillo x1", unit: "x1", current_price: 10, currency: "ARS", brand: "", active: true, created_at: "", updated_at: "" };
  const next: CatalogInput = { ...old, description: "Tornillo x2" };
  const plan = planCatalog([old], [next], "complete");
  expect(plan.rows[0].previous).toBeUndefined();
  expect(plan.deactivate.map(p => p.id)).toEqual([old.id]);
});
