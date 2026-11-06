import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { runCatalogLifecycleScenarios } from "./catalogLifecycle.scenarios";

it("renueva catálogo, conserva aprendizaje e historial y elimina sólo el proveedor indicado", async () => {
  const checks = await runCatalogLifecycleScenarios();
  expect(checks.length).toBeGreaterThanOrEqual(25);
});
