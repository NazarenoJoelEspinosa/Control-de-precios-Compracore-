/**
 * Tipos de dominio de PriceCore — versión local-first (sin backend).
 * Todo vive en IndexedDB, en el navegador. No hay owner_id ni RLS: es una
 * sola persona usando su propia máquina.
 */

export type MatchLevel = "exact_code" | "normalized_code" | "equivalence" | "code_family" | "description" | "none";
export type MatchState = "safe" | "review" | "not_found" | "new_product" | "presentation_diff" | "discontinued";
export type PriceListStatus = "uploaded" | "mapped" | "processing" | "processed" | "error";
export type PriceChangeStatus = "pending" | "approved" | "rejected" | "edited";
export type Currency = "ARS" | "USD";

export interface Supplier {
  id: string;
  name: string;
  code: string;
  email: string;
  phone: string;
  active: boolean;
  price_includes_vat: boolean;
  vat_rate: number;
  default_currency: Currency;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface SupplierColumnConfig {
  id: string;
  supplier_id: string;
  code_column: string | null;
  description_column: string | null;
  price_column: string | null;
  unit_column: string | null;
  brand_column: string | null;
  ean_column: string | null;
  currency_column: string | null;
}

export interface Product {
  id: string;
  /** Proveedor "dueño" de este producto — el catálogo es una carpeta por
   * proveedor, nunca compartido entre proveedores. Un mismo código puede
   * repetirse entre proveedores distintos sin chocar. */
  supplier_id: string;
  code: string;
  description: string;
  brand: string;
  unit: string;
  currency: Currency;
  current_price: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PriceList {
  id: string;
  supplier_id: string;
  file_name: string;
  row_count: number;
  status: PriceListStatus;
  column_mapping: Record<string, string> | null;
  created_at: string;
}

export interface PriceListItem {
  id: string;
  price_list_id: string;
  supplier_code: string;
  supplier_description: string;
  supplier_unit: string;
  supplier_brand: string;
  raw_price: string;
  parsed_price: number | null;
  parse_error: string | null;
  matched_product_id: string | null;
  match_level: MatchLevel | null;
  match_score: number | null;
  match_state: MatchState;
  raw_data: Record<string, unknown>;
  created_at: string;
}

export interface ComparisonSession {
  id: string;
  supplier_id: string;
  price_list_id: string;
  total_items: number;
  safe_matches: number;
  review_items: number;
  not_found_items: number;
  new_products: number;
  presentation_diff_items: number;
  discontinued_items: number;
  price_increases: number;
  price_decreases: number;
  price_unchanged: number;
  approved_changes: number;
  status: "open" | "closed";
  created_at: string;
}

export interface PriceChange {
  id: string;
  comparison_session_id: string;
  price_list_item_id: string;
  product_id: string;
  old_price: number;
  new_price: number;
  final_new_price: number | null;
  old_currency: Currency;
  new_currency: Currency;
  diff_absolute: number;
  diff_percent: number | null;
  status: PriceChangeStatus;
  decided_at: string | null;
  created_at: string;
}

export interface Equivalence {
  id: string;
  supplier_id: string;
  supplier_code: string;
  product_id: string;
  decision: "confirmed" | "rejected";
  origin: "manual" | "auto_exact_code" | "auto_normalized_code";
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

/** Código de proveedor confirmado como "no existe / no lo vendemos más" — se
 * recuerda para no volver a preguntar en la próxima lista de ese proveedor. */
export interface DiscontinuedCode {
  id: string;
  supplier_id: string;
  supplier_code: string;
  created_at: string;
}

export interface MatchingSettings {
  id: "thresholds";
  safe_min: number;
  review_min: number;
}
