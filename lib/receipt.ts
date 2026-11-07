// Receipt parsing helpers shared by the API route and the client.

import { PRODUCTS_BY_ID } from "./catalog";
import { inferQuantity, matchProduct } from "./matching";
import type { ReceiptLine } from "./types";

export interface RawItem {
  name: string;
  count: number;
  /** Line total in pence */
  linePrice: number | null;
}

export interface RawReceipt {
  store: string;
  date: string | null;
  total: number | null;
  items: RawItem[];
}

const SKIP = /\b(sub\s*total|total|balance|visa|mastercard|debit|credit|card|change|cash|vat|tender|contactless|auth|merchant|terminal|thank|receipt|tel|www|points|clubcard\s+points|nectar\s+points|items?\s+sold|savings?|bag\s+charge|carrier\s+bag)\b/i;
const DISCOUNT = /^(.*?)(-\s?£?\d+\.\d{2})\s*$/;
const PRICE_AT_END = /^(.*?)\s+£?(\d+\.\d{2})\s*[A-Z*]?\s*$/;
const COUNT_PREFIX = /^(\d+)\s*[x@*]\s*(.*)$/i;
const AT_PRICE = /(.*?)\s*@\s*£?\d+\.\d{2}/i;

/** Rule-based parser for plain-text receipts (offline fallback; Claude handles photos). */
export function parseReceiptText(text: string): RawReceipt {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: RawItem[] = [];
  let total: number | null = null;
  let date: string | null = null;
  const store = lines[0]?.replace(/[^A-Za-z' &]/g, "").trim() || "Unknown store";

  for (const line of lines.slice(1)) {
    const d = line.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
    if (d && !date) {
      const y = d[3].length === 2 ? `20${d[3]}` : d[3];
      date = `${y}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
    }
    if (/\btotal\b/i.test(line) && !/sub\s*total|savings/i.test(line)) {
      const m = line.match(/(\d+\.\d{2})/);
      if (m) total = Math.round(parseFloat(m[1]) * 100);
    }
    if (SKIP.test(line)) continue;

    // Promotions / loyalty price cuts apply to the previous item
    const disc = line.match(DISCOUNT);
    if (disc && items.length) {
      const amount = Math.round(parseFloat(disc[2].replace(/[£\s-]/g, "")) * 100);
      const prev = items[items.length - 1];
      if (prev.linePrice != null) prev.linePrice = Math.max(0, prev.linePrice - amount);
      continue;
    }

    const m = line.match(PRICE_AT_END);
    if (!m) continue;
    let name = m[1].trim();
    const linePrice = Math.round(parseFloat(m[2]) * 100);
    let count = 1;
    const c = name.match(COUNT_PREFIX);
    if (c) {
      count = parseInt(c[1], 10);
      name = c[2];
    }
    const at = name.match(AT_PRICE);
    if (at) name = at[1];
    name = name.replace(/\s{2,}/g, " ").trim();
    if (!/[a-z]/i.test(name)) continue;
    items.push({ name, count, linePrice });
  }
  return { store, date, total, items };
}

/** Resolve raw receipt items to catalogue products via fuzzy entity matching. */
export function resolveItems(items: RawItem[]): ReceiptLine[] {
  return items.map((item) => {
    const match = matchProduct(item.name);
    const product = match.product;
    return {
      raw: item.name,
      count: item.count,
      linePrice: item.linePrice,
      productId: product?.id ?? null,
      matchScore: match.score,
      qty: product ? inferQuantity(item.name, product, item.count, item.linePrice) : 0,
      alternatives: match.alternatives.map((a) => a.product.id),
    };
  });
}

export function requantify(line: ReceiptLine, productId: string | null): ReceiptLine {
  if (!productId) return { ...line, productId: null, qty: 0 };
  const product = PRODUCTS_BY_ID[productId];
  return { ...line, productId, qty: inferQuantity(line.raw, product, line.count, line.linePrice) };
}

export const SAMPLE_RECEIPTS: { label: string; text: string }[] = [
  {
    label: "Weekly big shop",
    text: `TESCO STORES LTD
Leeds Kirkstall Extra
02/11/2026 18:42
SEMI SKMD MILK 4PT          1.65
FR LGE EGGS 12PK            3.35
MAT CHEDDAR 400G            2.99
WMEAL BREAD 800G            1.35
BANANAS 5PK                 0.79
GALA APPLES 6PK             1.65
CARROTS 1KG                 0.59
WHITE POTATOES 2.5KG        1.59
BROWN ONIONS 1KG            0.89
SALAD TOMATOES 6PK          0.79
BABY SPINACH 200G           1.00
CHKN BRST FLLT 650G         4.99
CLUBCARD PRICE             -0.75
BEEF MINCE 5% 500G          3.75
FUSILLI PASTA 1KG           1.10
CHPD TOMATOES 4X400G        1.55
GREEK STYLE YOG 500G        1.25
PORRIDGE OATS 1KG           0.95
ORANGE JUICE 1L             1.25
TEA BAGS 80                 2.25
SUBTOTAL                   36.93
CLUBCARD SAVINGS            0.75
TOTAL                      36.18
VISA CONTACTLESS           36.18`,
  },
  {
    label: "Midweek top-up",
    text: `SAINSBURY'S LOCAL
05/11/2026 08:15
SEMI SKIMMED MILK 2PT       1.30
WHOLEMEAL BREAD 400G        0.85
3 x BANANAS @ 0.18          0.54
BABY SPINACH 100G           0.70
SALMON FILLETS 240G         4.25
BUTTER 250G                 2.19
TOTAL                       9.83
DEBIT CARD                  9.83`,
  },
  {
    label: "Cupboard restock",
    text: `ALDI STORES
28/10/2026
LONG GRAIN RICE 1KG         1.45
BAKED BEANS 4PK             1.80
FROZEN GARDEN PEAS 1KG      1.15
INSTANT COFFEE 100G         2.99
WHOLEGRAIN CEREAL 500G      1.65
TOILET ROLL 9PK             3.99
WASHING UP LIQ 450ML        0.95
TOTAL                      13.98`,
  },
];
