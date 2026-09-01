import { matchItem, type IncomingItem, type MatchDeps } from "./matching";
import { DEFAULT_THRESHOLDS } from "./matching";

type WorkerRequest = {
  supplierId: string;
  items: IncomingItem[];
  deps: MatchDeps;
  thresholds: typeof DEFAULT_THRESHOLDS;
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { supplierId, items, deps, thresholds } = event.data;
  const results = items.map((item) => matchItem(supplierId, item, deps, thresholds));
  self.postMessage(results);
};
