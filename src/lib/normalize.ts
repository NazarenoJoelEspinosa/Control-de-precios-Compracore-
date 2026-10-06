/**
 * Normalización de texto, parsing numérico (formato argentino) y
 * tokenización — portado del motor de CompraCore (Python) a TypeScript.
 *
 * Estas funciones son puras y sin dependencias de UI/Supabase, así que se
 * pueden usar tanto en el frontend (preview del mapeo de columnas) como en
 * la Edge Function de matching (Deno también corre TS estándar).
 */

// Abreviaturas frecuentes en listas de ferretería/seguridad industrial.
const ABBREV_MAP: Record<string, string> = {
  lgo: "largo",
  liv: "liviano",
  gde: "grande",
  med: "mediano",
  pte: "parte",
  prot: "protector",
  desc: "descartable",
  ref: "reforzado",
  nac: "nacional",
  imp: "importado",
  c: "con",
  p: "para",
  x: "por",
};

export function stripAccents(text: string): string {
  return (text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/** Minúsculas, sin acentos, sin puntuación separadora — para comparar headers/tokens. */
export function canonicalHeader(text: unknown): string {
  let value = stripAccents(normalizeText(text)).toLowerCase();
  for (const ch of ".:,;/\\-_()[]{}*") {
    value = value.split(ch).join(" ");
  }
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeCodeForMatch(code: unknown): string {
  const c = stripAccents(normalizeText(code)).toUpperCase();
  return c.replace(/[^A-Z0-9]/g, "");
}

/**
 * Similitud de "familia de código": detecta cuando dos códigos son el MISMO
 * código base con un sufijo de cantidad agregado al final
 * ("TOR8X1X100" vs "TOR8X1X1000") — el código NO es idéntico, pero es
 * evidentemente el mismo producto en otra presentación.
 *
 * A propósito es estricto, no un simple "se parecen": exige que el código
 * más corto sea EXACTAMENTE el prefijo del más largo, y que lo que sobra al
 * final sea sólo dígitos (una cantidad). Una versión más laxa (con ratio de
 * prefijo compartido, sin exigir que uno sea prefijo real del otro) generaba
 * falsos positivos graves con códigos secuenciales no relacionados
 * (ej. "T0001" vs "T0002", o dos códigos de igual longitud que difieren en
 * un dígito del medio) — dos productos totalmente distintos que por
 * casualidad arrancan parecido NO son la misma familia, y tratarlos como tal
 * inflaba la cola de revisión con artículos que no tenían nada que ver entre
 * sí.
 *
 * Devuelve un ratio 0-1 (longitud del código corto sobre el largo) o 0 si no
 * hay relación de familia.
 */
export function codeFamilySimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  // Base compartida demasiado corta: muy fácil que coincida por azar entre
  // productos que no tienen nada que ver.
  if (minLen < 5) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (!longer.startsWith(shorter)) return 0;
  const suffix = longer.slice(shorter.length);
  if (suffix && !/^\d+$/.test(suffix)) return 0;
  return minLen / maxLen;
}

export function tokenize(text: unknown): string[] {
  let clean = canonicalHeader(text);
  // separar números pegados a letras: "30cmxpar" -> "30 cm x par"
  clean = clean.replace(/(\d+)([a-z])/g, "$1 $2");
  clean = clean.replace(/([a-z])(\d+)/g, "$1 $2");
  const tokens = clean.split(" ").filter(Boolean);
  return tokens.map((t) => ABBREV_MAP[t] ?? t);
}

/** Stemming simple para español: plurales (guantes->guante, filtros->filtro). */
export function stemToken(tok: string): string {
  if (tok.length > 4 && tok.endsWith("es")) return tok.slice(0, -2);
  if (tok.length > 3 && tok.endsWith("s")) return tok.slice(0, -1);
  return tok;
}

export function trigrams(text: unknown): Set<string> {
  const clean = canonicalHeader(text).replace(/\s+/g, " ");
  const padded = `  ${clean} `;
  if (padded.length < 3) {
    return padded.trim() ? new Set([padded.trim()]) : new Set();
  }
  const grams = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

// ----------------------------------------------------------------------------
// Parsing de precios: soporta formato argentino (10.500,50), formato US
// (10,500.50), símbolos de moneda, negativos.
// ----------------------------------------------------------------------------
export class InvalidPriceError extends Error {}

export function parseDecimal(value: unknown): number {
  if (value === null || value === undefined) throw new InvalidPriceError("Precio vacío");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidPriceError("Precio no finito");
    return roundTo2(value);
  }
  // Admitir símbolos conocidos, nunca rescatar dígitos de textos como «Consultar 123».
  let s = String(value).trim().toUpperCase();
  for (const token of ["AR$", "ARS", "USD", "U$S", "$"]) s = s.split(token).join("");
  s = s.replace(/\s+/g, "");
  if (/^-?[.,]\d+$/.test(s)) return roundTo2(Number(s.replace(",", ".")));
  if (!/^-?\d[\d.,]*$/.test(s)) throw new InvalidPriceError(`Precio inválido: ${value}`);
  const comma = s.includes(","), dot = s.includes(".");
  if (comma && dot) {
    const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const group = decimal === "," ? "." : ",";
    const pieces = s.split(decimal);
    if (pieces.length !== 2 || !/^\d+$/.test(pieces[1]) || !validGroupedInteger(pieces[0], group)) {
      throw new InvalidPriceError(`Separadores inválidos: ${value}`);
    }
    s = pieces[0].split(group).join("") + "." + pieces[1];
  } else if (comma) {
    const pieces = s.split(",");
    if (pieces.length === 2 && /^\d+$/.test(pieces[1])) {
      // En listas argentinas una coma decimal puede tener más de dos decimales.
      s = pieces[0] + "." + pieces[1];
    } else if (pieces.length > 2 && validGroupedInteger(s, ",")) s = pieces.join("");
    else throw new InvalidPriceError(`Separadores inválidos: ${value}`);
  } else if (dot) {
    const pieces = s.split(".");
    if (pieces.length > 2 || pieces[1].length === 3) {
      if (!validGroupedInteger(s, ".")) throw new InvalidPriceError(`Separadores inválidos: ${value}`);
      s = pieces.join("");
    } else if (!/^\d+$/.test(pieces[1])) throw new InvalidPriceError(`Precio inválido: ${value}`);
  }
  const num = Number(s);
  if (!Number.isFinite(num)) throw new InvalidPriceError(`Precio inválido: ${value}`);
  return roundTo2(num);
}

function validGroupedInteger(value: string, separator: string): boolean {
  const groups = value.replace(/^-/, "").split(separator);
  return groups.length === 1 ? /^\d+$/.test(groups[0]) :
    /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every(g => /^\d{3}$/.test(g));
}

function roundTo2(n: number): number {
  // Desplazar el exponente evita que 18.455 * 100 quede por debajo de 1845.5.
  if (Number.isInteger(n)) return n;
  const [mantissa, exponent = "0"] = n.toString().split("e");
  return Number(`${Math.round(Number(`${mantissa}e${Number(exponent) + 2}`))}e-2`);
}

export function isValidPrice(val: unknown): boolean {
  try {
    return parseDecimal(val) > 0;
  } catch {
    return false;
  }
}

export function formatPrice(value: number, currency: "ARS" | "USD" = "ARS"): string {
  return `${currency} ${value.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function percentageChange(oldPrice: number, newPrice: number): number | null {
  if (oldPrice === 0) return null;
  return roundTo2(((newPrice - oldPrice) / oldPrice) * 100);
}

// ----------------------------------------------------------------------------
// Detección de presentación (caja/pack/bolsa, cantidad, medida)
// ----------------------------------------------------------------------------
export interface PresentationInfo {
  label: string;
  kind: string;
  count: number | null;
  measure: string;
}

const KIND_MAP: [string, string][] = [
  ["caja", "Caja"], ["pack", "Pack"], ["bolsa", "Bolsa"], ["blister", "Blister"],
  ["rollo", "Rollo"], ["juego", "Juego"], ["kit", "Kit"], ["display", "Display"],
  ["estuche", "Estuche"], ["resma", "Resma"], ["par", "Par"], ["docena", "Docena"],
  ["unidad", "Unidad"], ["un", "Unidad"], ["u", "Unidad"],
];

export function extractPresentation(description: string, unit = ""): PresentationInfo {
  const text = canonicalHeader(`${description} ${unit}`);
  if (!text) return { label: "", kind: "", count: null, measure: "" };

  const tokens = new Set(text.split(" "));
  let kind = "";
  for (const [key, label] of KIND_MAP) {
    if (tokens.has(key)) {
      kind = label;
      break;
    }
  }

  let count: number | null = null;
  // Nota: `canonicalHeader` ya convirtió "/" en espacio, por eso "c/500" llega
  // acá como "c 500" — el patrón de "c" tiene que buscar espacio, no "/".
  const patterns = [
    /\bx\s*(\d{1,5})\b/,
    /\bc\s+(\d{1,5})\b/,
    /\bpor\s*(\d{1,5})\b/,
    /\b(\d{1,5})\s*(u|un|uni|unidad|unidades|pzas|pza|piezas|pcs|pc)\b/,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      count = parseInt(m[1], 10);
      break;
    }
  }
  if (count === null && tokens.has("docena")) count = 12;

  let measure = "";
  const m2 = text.match(/\b(\d+(?:[.,]\d+)?)\s*(kg|kgr|gr|g|lt|lts|l|ml|cc|m|mts|mtr|mm|cm)\b/);
  if (m2) measure = `${m2[1].replace(",", ".")} ${m2[2]}`;

  const pieces: string[] = [];
  if (kind) pieces.push(kind);
  if (count !== null) pieces.push(`x${count}`);
  if (measure) pieces.push(measure);
  const label = pieces.join(" ").trim() || text.slice(0, 60);

  return { label, kind, count, measure };
}

export interface PresentationAlert {
  oldLabel: string;
  newLabel: string;
  reason: string; // "" si no hay alerta
}

export function presentationAlert(
  oldDescription: string,
  oldUnit: string,
  newDescription: string,
  newUnit: string
): PresentationAlert {
  const oldInfo = extractPresentation(oldDescription, oldUnit);
  const newInfo = extractPresentation(newDescription, newUnit);
  if (!oldInfo.label && !newInfo.label) {
    return { oldLabel: "", newLabel: "", reason: "" };
  }
  if (oldInfo.count !== null && newInfo.count !== null && oldInfo.count !== newInfo.count) {
    return { oldLabel: oldInfo.label, newLabel: newInfo.label, reason: "Cantidad/presentación distinta" };
  }
  if (oldInfo.kind && newInfo.kind && oldInfo.kind !== newInfo.kind) {
    return { oldLabel: oldInfo.label, newLabel: newInfo.label, reason: "Tipo de presentación distinto" };
  }
  if (oldInfo.measure && newInfo.measure && oldInfo.measure !== newInfo.measure) {
    return { oldLabel: oldInfo.label, newLabel: newInfo.label, reason: "Medida/presentación distinta" };
  }
  if (oldInfo.label !== newInfo.label) {
    return { oldLabel: oldInfo.label, newLabel: newInfo.label, reason: "Revisar presentación" };
  }
  return { oldLabel: oldInfo.label, newLabel: newInfo.label, reason: "" };
}
