/**
 * Motor de matching por niveles.
 *
 * Nivel 1: código exacto
 * Nivel 2: código normalizado (sin guiones/espacios/mayúsculas)
 * Nivel 3: equivalencia histórica confirmada (tabla `equivalences`)
 * Nivel 4: descripción (fuzzy) — prefiltro por pg_trgm (SQL) + score fino acá
 *
 * Este archivo es puro TS (sin dependencias de React) para poder correr
 * tanto en la Edge Function (Deno) como en tests.
 */
import { normalizeCodeForMatch, normalizeText, tokenize, stemToken, trigrams, presentationAlert, codeFamilySimilarity } from "./normalize";

export type MatchLevel = "exact_code" | "normalized_code" | "equivalence" | "code_family" | "description" | "none";
export type MatchState = "safe" | "review" | "not_found" | "new_product" | "presentation_diff" | "discontinued";

export interface ProductForMatch {
  id: string;
  code: string;
  description: string;
  brand?: string;
  unit?: string;
  current_price: number;
  currency: string;
}

export interface IncomingItem {
  supplier_code: string;
  supplier_description: string;
  supplier_brand?: string;
  supplier_unit?: string;
}

export interface CandidateScore {
  product: ProductForMatch;
  score: number; // 0-100
}

/** Umbrales por defecto — configurables desde la pantalla de Configuración. */
export const DEFAULT_THRESHOLDS = {
  safeMin: 97, // con equivalencia/código o score de descripción muy alto
  reviewMin: 50, // por debajo de esto, directamente "no encontrado"
};

/**
 * Score de similitud por descripción, replicando la heurística de CompraCore:
 * tokens (con stemming) + trigramas + bonus de contención + bonus/penalización
 * numérica explícita (números iguales = bonus fuerte, distintos = penalización).
 *
 * `candidateTokens`/`candidateTrigrams` se precalculan una sola vez por
 * producto (ver `buildProductIndexEntry`) para no re-tokenizar en cada score.
 */
export function scoreDescription(
  queryText: string,
  candidateText: string,
  candidateTokenSet: Set<string>,
  candidateTrigramSet: Set<string>
): number {
  const queryTokens = new Set(tokenize(queryText));
  const queryGrams = trigrams(queryText);

  const queryStems = new Set([...queryTokens].map(stemToken));
  const itemStems = new Set([...candidateTokenSet].map(stemToken));
  const tokenOverlap = intersectionSize(queryStems, itemStems);
  const tokenBase = Math.max(unionSize(queryStems, itemStems), 1);
  const tokenScore = tokenOverlap / tokenBase;

  let containmentBonus = 0;
  if (queryStems.size && itemStems.size) {
    const qInItem = tokenOverlap / Math.max(queryStems.size, 1);
    const itemInQ = tokenOverlap / Math.max(itemStems.size, 1);
    containmentBonus = Math.max(qInItem, itemInQ) * 0.18;
  }

  const queryNums = new Set([...queryTokens].filter((t) => /^\d+$/.test(t)));
  const itemNums = new Set([...candidateTokenSet].filter((t) => /^\d+$/.test(t)));
  let numericBonus = 0;
  if (queryNums.size && itemNums.size) {
    const numOverlap = intersectionSize(queryNums, itemNums);
    const numTotal = Math.max(unionSize(queryNums, itemNums), 1);
    const numRatio = numOverlap / numTotal;
    if (numRatio === 1) numericBonus = 0.25;
    else if (numRatio >= 0.75) numericBonus = 0;
    else if (numRatio >= 0.5) numericBonus = -0.15;
    else numericBonus = -0.3;
  } else if (queryNums.size && !itemNums.size) {
    numericBonus = -0.1;
  }

  const gramOverlap = intersectionSize(queryGrams, candidateTrigramSet);
  const gramBase = Math.max(unionSize(queryGrams, candidateTrigramSet), 1);
  const trigramScore = gramOverlap / gramBase;

  // La comparación de secuencia completa (tabla letra a letra) es la parte
  // más cara de todo el cálculo. Si el texto no comparte ni una palabra ni
  // un trigrama, el resultado final va a ser bajo de cualquier manera —
  // no vale la pena pagar ese costo. Con catálogos grandes, la gran mayoría
  // de los pares ítem×producto no tienen ninguna relación, así que este
  // atajo es lo que hace que miles de ítems se procesen en segundos y no en
  // minutos.
  let seqScore = 0;
  if (tokenOverlap > 0 || gramOverlap > 0) {
    seqScore = sequenceRatio(normalizeText(queryText).toLowerCase().slice(0, 100), candidateText.toLowerCase().slice(0, 100));
  }

  const raw =
    tokenScore * 0.35 + trigramScore * 0.25 + seqScore * 0.15 + containmentBonus + numericBonus;

  // clamp a [0, 1] y pasar a escala 0-100
  return Math.max(0, Math.min(1, raw)) * 100;
}

/** Similar a difflib.SequenceMatcher.ratio() — implementación liviana (LCS-based). */
function sequenceRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const lcs = dp[m][n];
  return (2 * lcs) / (m + n);
}

function intersectionSize<T>(a: Set<T>, b: Set<T>): number {
  let count = 0;
  for (const x of a) if (b.has(x)) count++;
  return count;
}
function unionSize<T>(a: Set<T>, b: Set<T>): number {
  return new Set([...a, ...b]).size;
}

/** Precalcula tokens/trigramas de un producto — llamar una vez por producto, no por comparación. */
export interface ProductIndexEntry {
  product: ProductForMatch;
  text: string;
  tokenSet: Set<string>;
  trigramSet: Set<string>;
  normalizedCode: string;
}
export function buildProductIndexEntry(product: ProductForMatch): ProductIndexEntry {
  const text = [product.description, product.brand ?? "", product.unit ?? ""].filter(Boolean).join(" ");
  return {
    product,
    text,
    tokenSet: new Set(tokenize(text)),
    trigramSet: trigrams(text),
    normalizedCode: normalizeCodeForMatch(product.code),
  };
}

export interface MatchResult {
  matchedProductId: string | null;
  matchLevel: MatchLevel;
  matchScore: number | null;
  matchState: MatchState;
  presentationReason: string;
  candidates: CandidateScore[]; // top candidatos por si el usuario quiere elegir otro
}

export interface MatchDeps {
  /** productos indexados por código exacto (UPPER) */
  byExactCode: Map<string, ProductForMatch>;
  /** productos indexados por código normalizado */
  byNormalizedCode: Map<string, ProductForMatch>;
  /** equivalencias confirmadas: `${supplierId}::${supplierCode}` -> productId */
  confirmedEquivalences: Map<string, string>;
  /** equivalencias rechazadas, para excluirlas de sugerencias */
  rejectedEquivalences: Set<string>;
  /** productos completos por id, para armar candidatos de nivel 4 */
  productsById: Map<string, ProductForMatch>;
  /**
   * Catálogo ya tokenizado — se calcula UNA sola vez por corrida (no por
   * ítem) con `buildProductIndexEntry`, porque tokenizar es la parte cara
   * del matching y con listas grandes (miles de ítems x miles de
   * productos) recalcularlo por cada ítem es lo que vuelve todo lento.
   */
  descriptionIndex: ProductIndexEntry[];
}

export function matchItem(
  supplierId: string,
  item: IncomingItem,
  deps: MatchDeps,
  thresholds = DEFAULT_THRESHOLDS
): MatchResult {
  const code = normalizeText(item.supplier_code).toUpperCase();
  const equivKey = `${supplierId}::${item.supplier_code}`;

  // Nivel 1: código exacto
  const exact = deps.byExactCode.get(code);
  if (exact) {
    return buildResult(exact, "exact_code", 100, item, thresholds, []);
  }

  // Nivel 2: código normalizado
  const normalized = deps.byNormalizedCode.get(normalizeCodeForMatch(code));
  if (normalized) {
    return buildResult(normalized, "normalized_code", 95, item, thresholds, []);
  }

  // Nivel 3: equivalencia histórica confirmada
  const equivProductId = deps.confirmedEquivalences.get(equivKey);
  if (equivProductId) {
    const product = deps.productsById.get(equivProductId);
    if (product) {
      return buildResult(product, "equivalence", 98, item, thresholds, []);
    }
  }

  // Nivel 4a: "familia de código" — el código del proveedor no es idéntico,
  // pero comparte una base fuerte con un producto interno (ej: mismo código
  // con un sufijo de cantidad distinto: "TOR8X1X100" vs "TOR8X1X1000"), Y la
  // presentación en la descripción efectivamente difiere. Esto es más
  // confiable que un match por descripción genérico porque el código ya nos
  // dice "es la misma familia de producto" — el usuario puede terminar
  // asociando VARIOS códigos de proveedor (uno por presentación) al mismo
  // producto interno.
  const normalizedItemCode = normalizeCodeForMatch(item.supplier_code);
  let bestFamily: { product: ProductForMatch; similarity: number } | null = null;
  if (normalizedItemCode.length >= 3) {
    for (const entry of deps.descriptionIndex) {
      const sim = codeFamilySimilarity(normalizedItemCode, entry.normalizedCode);
      if (sim >= 0.6 && (!bestFamily || sim > bestFamily.similarity)) {
        bestFamily = { product: entry.product, similarity: sim };
      }
    }
  }
  if (bestFamily) {
    const alert = presentationAlert(
      bestFamily.product.description,
      bestFamily.product.unit ?? "",
      item.supplier_description,
      item.supplier_unit ?? ""
    );
    if (alert.reason) {
      return buildResult(
        bestFamily.product,
        "code_family",
        Math.round(70 + bestFamily.similarity * 25),
        item,
        thresholds,
        []
      );
    }
    // Código muy parecido pero sin diferencia de presentación detectada:
    // no lo forzamos acá, dejamos que el matching por descripción decida —
    // puede ser exactamente el mismo producto con un código apenas distinto.
  }

  // Nivel 4b: descripción (fuzzy), excluyendo productos rechazados para este código
  const queryText = [item.supplier_description, item.supplier_brand ?? "", item.supplier_unit ?? ""]
    .filter(Boolean)
    .join(" ");
  const scored: CandidateScore[] = deps.descriptionIndex
    .filter((entry) => !deps.rejectedEquivalences.has(`${equivKey}::${entry.product.id}`))
    .map((entry) => {
      const score = scoreDescription(queryText, entry.text, entry.tokenSet, entry.trigramSet);
      return { product: entry.product, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (scored.length === 0) {
    return {
      matchedProductId: null,
      matchLevel: "none",
      matchScore: null,
      matchState: "not_found",
      presentationReason: "",
      candidates: [],
    };
  }

  const best = scored[0];
  if (best.score < thresholds.reviewMin) {
    // Por debajo del umbral de revisión, ni siquiera mostramos el candidato:
    // es preferible "no encontrado" (manda a búsqueda manual) que un
    // candidato de baja confianza que distraiga la revisión.
    return {
      matchedProductId: null,
      matchLevel: "none",
      matchScore: null,
      matchState: "not_found",
      presentationReason: "",
      candidates: scored,
    };
  }
  return buildResult(best.product, "description", best.score, item, thresholds, scored.slice(1));
}

function buildResult(
  product: ProductForMatch,
  level: MatchLevel,
  score: number,
  item: IncomingItem,
  thresholds: typeof DEFAULT_THRESHOLDS,
  otherCandidates: CandidateScore[]
): MatchResult {
  // Un código exacto/normalizado o una equivalencia ya confirmada por una
  // persona es la señal más fuerte que existe — es el mismo producto, punto.
  // No tiene sentido volver a dudar por una heurística de texto sobre la
  // presentación (que puede tener falsos positivos). Esa heurística sólo se
  // aplica cuando el match viene de descripción o de "familia de código",
  // que son señales más débiles y sí necesitan ese chequeo extra.
  const strongCodeSignal = level === "exact_code" || level === "normalized_code" || level === "equivalence";

  let state: MatchState;
  let presentationReason = "";

  if (!strongCodeSignal) {
    const alert = presentationAlert(
      product.description,
      product.unit ?? "",
      item.supplier_description,
      item.supplier_unit ?? ""
    );
    presentationReason = alert.reason;
  }

  if (presentationReason) {
    state = "presentation_diff";
  } else if (strongCodeSignal || score >= thresholds.safeMin) {
    state = "safe";
  } else {
    state = "review";
  }

  return {
    matchedProductId: product.id,
    matchLevel: level,
    matchScore: score,
    matchState: state,
    presentationReason,
    candidates: [{ product, score }, ...otherCandidates],
  };
}
