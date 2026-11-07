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

/** Products the user has grouped together to cook as one meal */
export interface Meal {
  id: string;
  name: string;
  productIds: string[];
  /** Pinned to the top of the pantry */
  starred?: boolean;
}

/** Calorie density: kcal per 100 g, per 100 ml, or per item (see lib/nutrition.ts) */
export interface KcalEntry {
  per: number;
  source: "gemini" | "manual";
}

export interface PantryState {
  today: number;
  household: Household;
  lots: Lot[];
  purchases: Purchase[];
  waste: WasteEvent[];
  receiptsScanned: number;
  meals: Meal[];
  kcal: Record<string, KcalEntry>;
  /** Products pinned to the top of the pantry */
  starred: string[];
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

/** day number <-> "YYYY-MM-DD" for <input type="date"> */
export function isoFromDay(day: number): string {
  return dateFromDay(day).toISOString().slice(0, 10);
}

export function dayFromIso(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : null;
}

export function formatDay(day: number): string {
  return dateFromDay(day).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
