import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { runCatalogOrientationScenarios } from "./catalogOrientation.scenarios";

it("el motor y la revisión parten del catálogo propio, con una lista de proveedor mayor", async () => {
  const result = await runCatalogOrientationScenarios();
  expect(result.checks).toHaveLength(7);
});
