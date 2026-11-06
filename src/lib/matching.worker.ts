import { selectCatalogCandidates, matchSelectedItems } from "./catalogMatching";
self.onmessage = event => {
  const { supplierId, items, deps, products, equivalences, discontinued, options } = event.data;
  const selection = selectCatalogCandidates(products, items, equivalences, discontinued, options);
  if (event.data.mode === "candidates") { self.postMessage({ candidatesByProduct: selection.candidatesByProduct }); return; }
  self.postMessage({ matches: matchSelectedItems(supplierId, items, deps, selection, options), candidatesByProduct: selection.candidatesByProduct });
};
