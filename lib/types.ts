// Core domain types. Dates are stored as integer "day numbers" (days since 1970-01-01 UTC)
// so the household simulation can be fast-forwarded deterministically.

export interface Lot {
  id: string;
  productId: string;
  /** Remaining quantity in base units */
  qty: number;
  purchasedDay: number;
  expiresDay: number;
  /** Pence paid per base unit — used to value waste */
  costPerUnit: number;
}

export interface Purchase {
  productId: string;
  qty: number;
  day: number;
  pricePaid: number;
  store: string;
}

export interface WasteEvent {
  productId: string;
  qty: number;
  value: number;
  day: number;
}

export interface Household {
  members: number;
  /** Per-product multiplier on consumption ("we eat more/less of this") */
  usageMultiplier: Record<string, number>;
  /** Products the household never wants recommended */
  excluded: string[];
}

export interface PantryState {
  today: number;
  household: Household;
  lots: Lot[];
  purchases: Purchase[];
  waste: WasteEvent[];
  receiptsScanned: number;
}

/** One line of a parsed receipt, after product matching */
export interface ReceiptLine {
  raw: string;
  count: number;
  linePrice: number | null;
  productId: string | null;
  matchScore: number;
  qty: number;
  alternatives: string[];
}

export interface ParsedReceipt {
  store: string;
  date: string | null;
  total: number | null;
  engine: "claude" | "rules" | "ocr";
  currency: "GBP" | "EUR" | "USD";
  /** Restaurant / takeaway bills are spend, not pantry stock */
  kind: "grocery" | "dining";
  lines: ReceiptLine[];
}

export const DAY_MS = 86_400_000;

export function dayFromDate(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

export function dateFromDay(day: number): Date {
  return new Date(day * DAY_MS);
}

export function formatDay(day: number): string {
  return dateFromDay(day).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
