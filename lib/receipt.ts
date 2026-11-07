// Receipt parsing helpers shared by the API route and the client.

import { PRODUCTS_BY_ID } from "./catalog";
import { inferQuantity, matchProduct } from "./matching";
import type { ReceiptLine } from "./types";

export interface RawItem {
  name: string;
  count: number;
  /** Line total in pence (after any discount printed beneath it) */
  linePrice: number | null;
  /** OCR only: other plausible readings of a garbled price (pence, before discount) */
  priceCandidates?: number[];
  /** OCR only: discount (pence) applied to this line */
  discount?: number;
}

export interface RawReceipt {
  store: string;
  date: string | null;
  total: number | null;
  items: RawItem[];
}

const SKIP = /\b(sub\s*total|total|balance|visa|mastercard|debit|credit|card|change|cash|vat|tender|contactless|auth|merchant|terminal|thank|receipt|tel|www|points|clubcard\s+points|nectar\s+points|items?\s+sold|savings?|bag\s+charge|carrier\s+bag)\b/i;
const DISCOUNT = /^(.*?)(-\s?£?\d+\.\d{2})\s*$/;
// OCR often reads the minus sign as "=", "~" or a dash variant
const OCR_DISCOUNT = /^(.*?)\s[-=~–—]\s?£?(\d+\.\d{2})\s*$/;
const PRICE_AT_END = /^(.*?)\s+£?(\d+\.\d{2})(?:\s+[A-Z*])?\s*$/;
// OCR: last token starting and ending with a digit (decimal point may be misread as a digit or symbol)
const OCR_PRICE_AT_END = /^(.*?)\s+[£$€]?(\d[\d.,¥$%:;'’`]*\d)(?:\s+[A-Z*])?\s*$/;
const COUNT_PREFIX = /^(\d+)\s*[x@*]\s*(.*)$/i;
const AT_PRICE = /(.*?)\s*@\s*£?\d+\.\d{2}/i;

/**
 * Possible readings (pence) of an OCR'd price token, most likely first.
 * "1.65" → [165]; "1¥35" → [135]; "2499" → [299, 2499] (dot read as "4");
 * "31935" → [335, 3135, 31935] (dot read as "19").
 */
export function decodeOcrPrice(token: string): number[] {
  const exact = token.match(/^(\d+)[.,](\d{2})$/);
  if (exact) return [parseInt(exact[1], 10) * 100 + parseInt(exact[2], 10)];
  const digits = token.replace(/\D/g, "");
  if (digits.length < 3) return [];
  const pence = parseInt(digits.slice(-2), 10);
  const out: number[] = [];
  // The decimal point may have become 2, 1 or 0 extra characters — prefer the smallest (grocery) price
  for (const drop of [4, 3, 2]) {
    const pounds = digits.slice(0, -drop);
    if (!pounds) continue;
    const v = parseInt(pounds, 10) * 100 + pence;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Rule-based parser for plain-text receipts (offline fallback; Claude handles photos when configured).
 * With `ocr: true` it also tolerates OCR misreads of prices and discount signs.
 */
export function parseReceiptText(text: string, opts: { ocr?: boolean } = {}): RawReceipt {
  const ocr = !!opts.ocr;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: RawItem[] = [];
  let total: number | null = null;
  let date: string | null = null;
  const store = lines[0]?.replace(/[^A-Za-z' &]/g, "").trim() || "Unknown store";

  for (const rawLine of lines.slice(1)) {
    // Tidy common OCR slips in prices: "1,65" / "1 .65" / "1. 65" → "1.65"
    const line = rawLine
      .replace(/(\d)\s*,\s*(\d{2})(?!\d)/g, "$1.$2")
      .replace(/(\d)\s+\.\s*(\d{2})(?!\d)/g, "$1.$2")
      .replace(/(\d)\.\s+(\d{2})(?!\d)/g, "$1.$2");
    const d = line.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
    // Ignore impossible dates (OCR can turn "02/11" into "92/11")
    if (d && !date && +d[1] >= 1 && +d[1] <= 31 && +d[2] >= 1 && +d[2] <= 12) {
      const y = d[3].length === 2 ? `20${d[3]}` : d[3];
      date = `${y}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
    }
    if (/\btotal\b/i.test(line) && !/sub\s*total|savings/i.test(line)) {
      const m = line.match(/(\d+\.\d{2})/);
      if (m) total = Math.round(parseFloat(m[1]) * 100);
    }
    if (SKIP.test(line)) continue;

    // Promotions / loyalty price cuts apply to the previous item
    const disc = line.match(ocr ? OCR_DISCOUNT : DISCOUNT);
    if (disc && items.length) {
      const amount = Math.round(parseFloat(disc[2].replace(/[£\s=~–—-]/g, "")) * 100);
      const prev = items[items.length - 1];
      if (ocr) prev.discount = (prev.discount ?? 0) + amount;
      if (prev.linePrice != null) prev.linePrice = Math.max(0, prev.linePrice - amount);
      continue;
    }

    let name: string;
    let linePrice: number;
    let priceCandidates: number[] | undefined;
    const m = line.match(PRICE_AT_END);
    if (m) {
      name = m[1].trim();
      linePrice = Math.round(parseFloat(m[2]) * 100);
      if (ocr) priceCandidates = [linePrice];
    } else {
      const o = ocr ? line.match(OCR_PRICE_AT_END) : null;
      const candidates = o ? decodeOcrPrice(o[2]) : [];
      if (!o || !candidates.length) continue;
      name = o[1].trim();
      linePrice = candidates[0];
      priceCandidates = candidates;
    }
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
    items.push({ name, count, linePrice, priceCandidates });
  }
  return { store, date, total, items };
}

/**
 * OCR price repair: choose the reading closest to what this product actually costs.
 * If every reading is implausible (e.g. "0.95" read as "9.95"), keep the pence and pick the
 * pounds digit that best fits the catalogue price.
 */
function plausiblePrice(item: RawItem, packPrices: number[]): number | null {
  const cands = item.priceCandidates;
  if (!cands?.length) return item.linePrice;
  const expected = packPrices.map((p) => p * item.count);
  const fit = (v: number) => Math.min(...expected.map((e) => Math.abs(Math.log(Math.max(v, 1) / e))));
  let best = cands.reduce((a, b) => (fit(b) < fit(a) ? b : a));
  if (fit(best) > Math.log(1.7)) {
    const pence = best % 100;
    const repaired = Array.from({ length: 30 }, (_, pounds) => pounds * 100 + pence).reduce((a, b) =>
      fit(b) < fit(a) ? b : a,
    );
    if (fit(repaired) < Math.log(1.25)) best = repaired;
  }
  return Math.max(0, best - (item.discount ?? 0));
}

/** Resolve raw receipt items to catalogue products via fuzzy entity matching. */
export function resolveItems(items: RawItem[]): ReceiptLine[] {
  return items.map((item) => {
    const match = matchProduct(item.name);
    const product = match.product;
    const linePrice = product ? plausiblePrice(item, product.packs.map((p) => p.price)) : item.linePrice;
    return {
      raw: item.name,
      count: item.count,
      linePrice,
      productId: product?.id ?? null,
      matchScore: match.score,
      qty: product ? inferQuantity(item.name, product, item.count, linePrice) : 0,
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
