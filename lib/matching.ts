// Product identification: entity resolution from noisy receipt text to catalogue products.
// Combines abbreviation expansion, character-trigram similarity and token overlap.

import { CATALOG, type Product } from "./catalog";

const ABBREVIATIONS: Record<string, string> = {
  skmd: "skimmed",
  skm: "skimmed",
  s: "semi",
  ss: "semi skimmed",
  mlk: "milk",
  wmeal: "wholemeal",
  whlml: "wholemeal",
  wholeml: "wholemeal",
  brd: "bread",
  chkn: "chicken",
  chk: "chicken",
  brst: "breast",
  fllt: "fillets",
  fil: "fillets",
  fr: "free range",
  frange: "free range",
  lge: "large",
  med: "medium",
  chdr: "cheddar",
  ched: "cheddar",
  mat: "mature",
  yog: "yoghurt",
  ygt: "yoghurt",
  grk: "greek",
  tom: "tomatoes",
  toms: "tomatoes",
  chpd: "chopped",
  chop: "chopped",
  pots: "potatoes",
  pot: "potatoes",
  onio: "onions",
  bnna: "bananas",
  ban: "bananas",
  bans: "bananas",
  appl: "apples",
  carr: "carrots",
  spin: "spinach",
  frz: "frozen",
  pea: "peas",
  bkd: "baked",
  bns: "beans",
  porr: "porridge",
  cof: "coffee",
  inst: "instant",
  oj: "orange juice",
  tlt: "toilet",
  wup: "washing up",
  liq: "liquid",
  mnce: "mince",
  bf: "beef",
};

const STOPWORDS = new Set([
  "tesco", "sainsburys", "asda", "aldi", "lidl", "morrisons", "waitrose", "coop",
  "finest", "essential", "essentials", "value", "british", "fresh", "pack", "pk", "x",
  "the", "and", "of", "by", "sam", "ocado", "m", "s",
]);

export function normalise(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[£$]?\d+(\.\d+)?\s*(kg|g|ml|l|ltr|litre|pt|pint|pints|pk|x)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] ?? t)
    .join(" ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return cleaned.join(" ");
}

function trigrams(s: string): Map<string, number> {
  const padded = `  ${s} `;
  const grams = new Map<string, number>();
  for (let i = 0; i < padded.length - 2; i++) {
    const g = padded.slice(i, i + 3);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of ta) {
    overlap += Math.min(n, tb.get(g) ?? 0);
    total += n;
  }
  for (const n of tb.values()) total += n;
  return (2 * overlap) / total;
}

function tokenScore(query: string, candidate: string): number {
  const q = query.split(" ");
  const c = candidate.split(" ");
  if (!q.length || !c.length) return 0;
  let hits = 0;
  for (const ct of c) {
    if (q.some((qt) => qt === ct || (qt.length >= 3 && ct.startsWith(qt)) || (ct.length >= 3 && qt.startsWith(ct)))) hits++;
  }
  return hits / c.length;
}

export interface MatchResult {
  product: Product | null;
  score: number;
  alternatives: { product: Product; score: number }[];
}

export function matchProduct(rawName: string): MatchResult {
  const q = normalise(rawName);
  const scored = CATALOG.map((product) => {
    const candidates = [product.name, ...product.aliases].map((c) => normalise(c));
    const best = Math.max(
      ...candidates.map((c) => 0.55 * dice(q, c) + 0.45 * tokenScore(q, c)),
    );
    return { product, score: best };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0];
  const confident = top && top.score >= 0.42;
  return {
    product: confident ? top.product : null,
    score: top?.score ?? 0,
    alternatives: scored.slice(0, 4),
  };
}

/** Pull a pack size out of receipt text like "4PT", "500G", "2.5KG", "6PK", "1L". */
export function parsePackSize(raw: string, product: Product): number | null {
  const text = raw.toLowerCase();
  const m = text.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|ltr|litre|pt|pint|pints|pk|pack|x)\b/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2];
  switch (product.unit) {
    case "g":
      if (u === "kg") return n * 1000;
      if (u === "g") return n;
      return null;
    case "ml":
      if (u === "l" || u === "ltr" || u === "litre") return n * 1000;
      if (u === "ml") return n;
      if (u === "pt" || u === "pint" || u === "pints") return n * 568;
      return null;
    case "item":
      if (u === "pk" || u === "pack" || u === "x") return n;
      return null;
  }
}

/** Best guess at base-unit quantity bought for one receipt line. */
export function inferQuantity(raw: string, product: Product, count: number, linePrice: number | null): number {
  const parsed = parsePackSize(raw, product);
  if (parsed) return parsed * count;
  // Otherwise pick the catalogue pack whose price is closest to the per-unit price paid
  if (linePrice != null && count > 0) {
    const unitPrice = linePrice / count;
    const pack = [...product.packs].sort(
      (a, b) => Math.abs(a.price - unitPrice) - Math.abs(b.price - unitPrice),
    )[0];
    return pack.size * count;
  }
  return product.packs[0].size * count;
}
