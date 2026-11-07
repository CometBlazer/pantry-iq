// Receipt parsing helpers shared by the API route and the client.
//
// The rule-based parser reads any "description … price" receipt layout:
//   UK grocery     "SEMI SKMD MILK 4PT        1.65"
//   multi-buy      "3 x BANANAS @ 0.18        0.54"
//   column style   "2  TACO DE ALAMBRE   1,95   3,90 €"   (qty · description · unit price · line total)
// With `ocr: true` it also tolerates Tesseract misreads and uses the receipt total as a checksum.

import { PRODUCTS_BY_ID } from "./catalog";
import { inferQuantity, matchProduct } from "./matching";
import type { ParsedReceipt, ReceiptLine } from "./types";

export type Currency = "GBP" | "EUR" | "USD";
export type ReceiptKind = "grocery" | "dining";

export interface RawItem {
  name: string;
  count: number;
  /** Line total in minor units (pence/cents), after any discount printed beneath it */
  linePrice: number | null;
  /** Unit price column, when the receipt prints one */
  unitPrice?: number | null;
  /** OCR only: other plausible readings of a garbled price (before discount) */
  priceCandidates?: number[];
  /** OCR only: discount applied to this line */
  discount?: number;
}

export interface RawReceipt {
  store: string;
  date: string | null;
  total: number | null;
  currency: Currency;
  kind: ReceiptKind;
  items: RawItem[];
}

// Summary / payment / header lines in English and Spanish — never line items
const SKIP =
  /\b(sub\s*-?total|total|balance|visa|mastercard|amex|debit|credit|card|change|cash|vat|tax|tender|contactless|auth|merchant|terminal|thank|receipt|tel|phone|www|points|clubcard\s+points|nectar\s+points|items?\s+sold|savings?|bag\s+charge|carrier\s+bag|iva|base|cuota|tarjeta|entregado|cambio|efectivo|importe\s+total|a\s+pagar|fecha|hora|mesa|sala|c\.?\s?i\.?\s?f|n\.?\s?i\.?\s?f|fact|factura|gracias|atendido|ticket|operaci[oó]n|propina|tip|gratuity|server|table)\b/i;
// Lines carrying the amount actually paid, used to find the receipt total
const TOTAL_LINE = /\b(total|tarjeta|entregado|importe|a\s+pagar|visa|mastercard|card|cash|efectivo|amount\s+due|balance\s+due)\b/i;
const NOT_TOTAL = /\b(sub\s*-?total|savings|cambio|change|iva|vat|base|cuota|points)\b/i;
const DINING = /\b(mesa|sala|table|covers?|comensales|server|servido|atendido|propina|tip|gratuity|llevar|take\s*away|takeaway|restaurant|restaurante|taquer[ií]a|tacos?|pizzer[ií]a|caf[eé]|bar|brasserie|bistro)\b/gi;
const TIME = /\b\d{1,2}:\d{2}(:\d{2})?\b/;

// Single-word keywords matched with one-letter tolerance in OCR mode ("TARJEIA" → tarjeta)
const SKIP_WORDS = ["subtotal", "total", "balance", "mastercard", "contactless", "change", "tender", "receipt", "points", "savings", "tarjeta", "entregado", "cambio", "efectivo", "factura", "simplificada", "gracias", "atendido", "ticket", "propina", "gratuity", "descripcion", "importe", "cuota", "fecha"];
const TOTAL_WORDS = ["total", "tarjeta", "entregado", "importe", "efectivo", "mastercard"];

function editDistanceAtMost1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Does the line contain one of `words`, allowing a single OCR letter slip in words of 5+ letters? */
function hasFuzzyWord(line: string, words: string[]): boolean {
  const tokens = line.toLowerCase().split(/[^a-záéíóúñ]+/).filter((t) => t.length >= 5);
  return tokens.some((t) => words.some((w) => w.length >= 5 && editDistanceAtMost1(t, w)));
}
const COUNT_X = /^(\d{1,2})\s*[x@*]\s*(.*)$/i;
const AT_PRICE = /(.*?)\s*@\s*[£$€]?\d+[.,]\d{2}.*$/i;
// A clean price token: 1.65 / 1,65 / £1.65 / 12,75€
const PRICE_TOKEN = /^[£$€]?(\d{1,4})[.,](\d{2})[£$€¢]?$/;
// Trailing junk after the last price: currency marks (OCR reads € as ¢), VAT codes, stray punctuation
const TRAILING_JUNK = /^([€£$¢¥]+|EUR|GBP|USD|[A-Z]|[*°'`´.,|:;~-]+)$/i;

/**
 * Possible readings (minor units) of an OCR'd price token, most likely first.
 * "1.65" → [165]; "1¥35" → [135]; "2499" → [299, 2499] (dot read as "4");
 * "31935" → [335, 3135, 31935] (dot read as "19"); "100" → [100] ("1,00" with the comma lost).
 */
export function decodeOcrPrice(token: string): number[] {
  const t = token.replace(/^[£$€]|[£$€¢]+$/g, "");
  const exact = t.match(/^(\d+)[.,](\d{2})$/);
  if (exact) return [parseInt(exact[1], 10) * 100 + parseInt(exact[2], 10)];
  // digits with misread punctuation in between ("1¥35", "1°00", "2'99"), but no letters
  if (!/^\d[^A-Za-z\s]*\d$/.test(t)) return [];
  const digits = t.replace(/\D/g, "");
  if (digits.length < 3) return [];
  const pence = parseInt(digits.slice(-2), 10);
  const out: number[] = [];
  // The decimal point may have become 2, 1 or 0 extra characters — prefer the smallest price
  for (const drop of [4, 3, 2]) {
    const pounds = digits.slice(0, -drop);
    if (!pounds) continue;
    const v = parseInt(pounds, 10) * 100 + pence;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function parsePriceToken(tok: string, ocr: boolean): number[] {
  const m = tok.match(PRICE_TOKEN);
  if (m) return [parseInt(m[1], 10) * 100 + parseInt(m[2], 10)];
  return ocr ? decodeOcrPrice(tok) : [];
}

function detectCurrency(text: string): Currency {
  const eur = (text.match(/€|\bEUR\b|\d[.,]\d{2}\s*¢/g) ?? []).length;
  const usd = (text.match(/\$/g) ?? []).length;
  const gbp = (text.match(/£|\bGBP\b/g) ?? []).length;
  if (eur > gbp && eur >= usd) return "EUR";
  if (usd > gbp) return "USD";
  return "GBP";
}

// Digits Tesseract commonly confuses on thermal receipts
const CONFUSABLE: Record<string, string[]> = {
  "0": ["8", "6", "9"],
  "1": ["7"],
  "3": ["8", "5"],
  "5": ["6", "3", "9"],
  "6": ["5", "8", "0"],
  "7": ["1"],
  "8": ["9", "3", "6", "0"],
  "9": ["8", "5", "0"],
};

function oneDigitVariants(v: number): number[] {
  const s = String(v).padStart(3, "0");
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    for (const r of CONFUSABLE[s[i]] ?? []) out.push(parseInt(s.slice(0, i) + r + s.slice(i + 1), 10));
  }
  return out;
}

/**
 * Checksum repair: when the items don't add up to the amount paid, find a single OCR digit slip
 * (e.g. 1,95 read as 1,85) in one line total that makes them add up exactly.
 */
function reconcileWithTotal(items: RawItem[], totals: number[]): number | null {
  const priced = items.filter((i) => i.linePrice != null);
  if (!priced.length || !totals.length) return totals[0] ?? null;
  const sum = priced.reduce((s, i) => s + i.linePrice!, 0);
  if (totals.includes(sum)) return sum;
  for (const target of totals) {
    const fixes: { item: RawItem; value: number; unitOk: boolean }[] = [];
    for (const item of priced) {
      const value = item.linePrice! + (target - sum);
      if (value < 0) continue;
      const unitOk = item.unitPrice != null && item.unitPrice * item.count === value;
      if (unitOk || oneDigitVariants(item.linePrice!).includes(value)) fixes.push({ item, value, unitOk });
    }
    // Prefer a fix the unit-price column confirms; otherwise accept only an unambiguous one
    const confirmed = fixes.filter((f) => f.unitOk);
    const pick = confirmed.length === 1 ? confirmed[0] : fixes.length === 1 ? fixes[0] : null;
    if (pick) {
      pick.item.linePrice = pick.value;
      if (pick.item.unitPrice != null && pick.item.count > 0 && !pick.unitOk) {
        pick.item.unitPrice = Math.round(pick.value / pick.item.count);
      }
      pick.item.priceCandidates = [pick.value + (pick.item.discount ?? 0)];
      return target;
    }
  }
  return totals[0];
}

/**
 * Rule-based parser for plain-text receipts (offline fallback; Claude handles photos when configured).
 * With `ocr: true` it also tolerates OCR misreads of prices, quantities and discount signs.
 */
export function parseReceiptText(text: string, opts: { ocr?: boolean } = {}): RawReceipt {
  const ocr = !!opts.ocr;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: RawItem[] = [];
  const totalCandidates: number[] = [];
  let date: string | null = null;

  // Store name: first line that is mostly letters (OCR can emit noise above the logo)
  const storeIdx = Math.max(0, lines.findIndex((l) => (l.match(/[A-Za-z]/g)?.length ?? 0) >= 3 && /^[A-Za-z0-9 '&.,-]+$/.test(l)));
  const store = lines[storeIdx]?.replace(/[^A-Za-z0-9' &]/g, "").trim() || "Unknown store";

  for (const rawLine of lines.slice(storeIdx + 1)) {
    // Tidy price punctuation: "1,65" / "1 .65" / "1. 65" → "1.65"; "1,95€" → "1,95 €"
    const line = rawLine
      .replace(/(\d)\s*,\s*(\d{2})(?!\d)/g, "$1.$2")
      .replace(/(\d)\s+\.\s*(\d{2})(?!\d)/g, "$1.$2")
      .replace(/(\d)\.\s+(\d{2})(?!\d)/g, "$1.$2")
      .replace(/(\d)([€£$¢])/g, "$1 $2");

    const d = line.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
    // Ignore impossible dates (OCR can turn "02/11" into "92/11")
    if (d && !date && +d[1] >= 1 && +d[1] <= 31 && +d[2] >= 1 && +d[2] <= 12) {
      const y = d[3].length === 2 ? `20${d[3]}` : d[3];
      date = `${y}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
    }

    // Collect every amount on "paid" lines as candidate receipt totals
    const isTotalLine = TOTAL_LINE.test(line) || (ocr && hasFuzzyWord(line, TOTAL_WORDS));
    if (isTotalLine && !NOT_TOTAL.test(line.replace(TOTAL_LINE, ""))) {
      for (const tok of line.split(/\s+/)) {
        const v = parsePriceToken(tok, false)[0];
        if (v != null && v > 0) totalCandidates.push(v);
      }
    } else if (/\btotal\b/i.test(line) && !/sub\s*-?total|savings/i.test(line)) {
      const m = line.match(/(\d+\.\d{2})/);
      if (m) totalCandidates.push(Math.round(parseFloat(m[1]) * 100));
    }
    if (SKIP.test(line) || TIME.test(line) || (ocr && hasFuzzyWord(line, SKIP_WORDS))) continue;

    // Split into tokens and peel prices / junk off the right-hand end
    const tokens = line.split(/\s+/);
    while (tokens.length && TRAILING_JUNK.test(tokens[tokens.length - 1])) tokens.pop();

    // Discount / promotion lines: "-0.75" (OCR may read "-" as "=" or "~")
    const signed = ocr ? /^[-=~–—][£$€]?(\d+)[.,](\d{2})$/ : /^-[£$€]?(\d+)[.,](\d{2})$/;
    const sign = ocr ? /^[-=~–—]$/ : /^-$/;
    const last = tokens[tokens.length - 1] ?? "";
    let disc = last.match(signed);
    if (!disc && tokens.length >= 2 && sign.test(tokens[tokens.length - 2])) {
      disc = last.match(/^[£$€]?(\d+)[.,](\d{2})$/);
    }
    if (disc && items.length) {
      let amount = parseInt(disc[1], 10) * 100 + parseInt(disc[2], 10);
      const prev = items[items.length - 1];
      // A discount can't exceed the item it applies to: "-0.75" misread as "-9.75" → try one-digit fixes
      if (ocr && prev.linePrice != null && amount >= prev.linePrice) {
        const fix = oneDigitVariants(amount).filter((v) => v > 0 && v < prev.linePrice!);
        if (fix.length === 1) amount = fix[0];
      }
      if (ocr) prev.discount = (prev.discount ?? 0) + amount;
      if (prev.linePrice != null) prev.linePrice = Math.max(0, prev.linePrice - amount);
      continue;
    }

    const prices: number[][] = [];
    const priceTokens: string[] = [];
    while (tokens.length > 1 && prices.length < 2) {
      const tok = tokens[tokens.length - 1];
      const cands = parsePriceToken(tok, ocr);
      if (!cands.length) break;
      prices.unshift(cands);
      priceTokens.unshift(tok);
      tokens.pop();
      while (tokens.length && TRAILING_JUNK.test(tokens[tokens.length - 1])) tokens.pop();
    }
    if (!prices.length) continue;

    // Drop leading OCR debris ("|", "©", "-") from the paper edge
    while (tokens.length > 1 && /^[^A-Za-z0-9]+$/.test(tokens[0])) tokens.shift();

    // Leading quantity column ("2  TACO…"); OCR reads "1" as I, l or |
    let count = 1;
    let nameTokens = tokens;
    const lead = tokens[0]?.replace(/["°'`.]+$/, "");
    if (tokens.length > 1 && /^(\d{1,2}|[Il|])$/.test(lead) && /[A-Za-z]{2,}/.test(tokens[1])) {
      count = /^\d+$/.test(lead) ? parseInt(lead, 10) : 1;
      nameTokens = tokens.slice(1);
    }
    let name = nameTokens.join(" ");
    const cx = name.match(COUNT_X);
    if (cx) {
      count = parseInt(cx[1], 10);
      name = cx[2];
    }
    const at = name.match(AT_PRICE);
    if (at) name = at[1];
    name = name.replace(/[^A-Za-z0-9%&'./ -]/g, " ").replace(/\s{2,}/g, " ").trim();
    // Real descriptions have a word of 3+ letters
    if (!/[A-Za-z]{3,}/.test(name) || count < 1 || count > 50) continue;

    const lineCands = prices[prices.length - 1];
    let linePrice = lineCands[0];
    let unitPrice: number | null = null;
    if (prices.length === 2) {
      // Two columns: unit price × qty should equal the line total. Use that to fix OCR slips;
      // if no reading agrees, the first number wasn't a price (e.g. a pack size) — keep it in the name.
      const pairs = prices[0].flatMap((u) => lineCands.map((c) => [u, c] as const));
      const exact = pairs.find(([u, c]) => u * count === c);
      const near = ocr
        ? pairs.find(([u, c]) => oneDigitVariants(u).some((v) => v * count === c) || oneDigitVariants(c).includes(u * count))
        : undefined;
      if (exact) {
        [unitPrice, linePrice] = exact;
      } else if (near) {
        // One column has a digit slip; trust the line total, derive the unit price
        linePrice = near[1];
        unitPrice = Math.round(linePrice / count);
      } else {
        name = `${name} ${priceTokens[0]}`.trim();
      }
    }
    items.push({
      name,
      count,
      linePrice,
      unitPrice,
      priceCandidates: ocr ? lineCands : undefined,
    });
  }

  const total = ocr
    ? reconcileWithTotal(items, [...new Set(totalCandidates)].sort(
        (a, b) => totalCandidates.filter((x) => x === b).length - totalCandidates.filter((x) => x === a).length,
      ))
    : (totalCandidates.at(-1) ?? null);

  const diningHits = new Set((text.match(DINING) ?? []).map((w) => w.toLowerCase())).size;
  return {
    store,
    date,
    total,
    currency: detectCurrency(text),
    kind: diningHits >= 2 ? "dining" : "grocery",
    items,
  };
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

/**
 * Final shape for the UI. Restaurant / takeaway bills are already-eaten food, so nothing is
 * pre-selected for the pantry (the user can still map a line by hand).
 */
export function toParsedReceipt(raw: RawReceipt, engine: ParsedReceipt["engine"]): ParsedReceipt {
  const lines = resolveItems(raw.items).map((l) =>
    raw.kind === "dining" ? { ...l, productId: null, qty: 0 } : l,
  );
  return {
    store: raw.store,
    date: raw.date,
    total: raw.total,
    currency: raw.currency,
    kind: raw.kind,
    engine,
    lines,
  };
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
SUBTOTAL                   33.73
CLUBCARD SAVINGS            0.75
TOTAL                      32.98
VISA CONTACTLESS           32.98`,
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
