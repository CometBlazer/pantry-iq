// Consumption forecasting and stock simulation.
//
// Each product's daily consumption rate is a Bayesian-style blend of:
//   • a prior from the food database (per-person usage × household size × preference), and
//   • the rate implied by the household's own purchase history (qty bought ÷ days between shops).
// Stock is then simulated day by day, consuming the soonest-expiring lot first (FIFO by expiry)
// and writing off anything that passes its expiry date as waste.

import { PRODUCTS_BY_ID } from "./catalog";
import type { Household, Lot, Purchase } from "./types";

const PRIOR_WEIGHT = 2; // prior counts as this many observed shopping intervals

export interface RateEstimate {
  rate: number;
  prior: number;
  observed: number | null;
  intervals: number;
}

export function estimateRate(
  productId: string,
  household: Household,
  purchases: Purchase[],
): RateEstimate {
  const product = PRODUCTS_BY_ID[productId];
  const mult = household.usageMultiplier[productId] ?? 1;
  const prior = product.dailyUsePerPerson * household.members * mult;

  // Collapse purchases to one per shopping day
  const byDay = new Map<number, number>();
  for (const p of purchases) {
    if (p.productId !== productId) continue;
    byDay.set(p.day, (byDay.get(p.day) ?? 0) + p.qty);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  if (days.length < 2) return { rate: prior, prior, observed: null, intervals: 0 };

  // Quantity bought on all but the last shop was consumed over the span between first and last shop
  const span = days[days.length - 1] - days[0];
  if (span <= 0) return { rate: prior, prior, observed: null, intervals: 0 };
  let consumed = 0;
  for (let i = 0; i < days.length - 1; i++) consumed += byDay.get(days[i])!;
  const observed = consumed / span;
  const n = days.length - 1;
  const rate = (prior * PRIOR_WEIGHT + observed * n) / (PRIOR_WEIGHT + n);
  return { rate, prior, observed, intervals: n };
}

export interface SimDay {
  day: number;
  stock: number;
  consumed: number;
  wasted: number;
  wastedValue: number;
  unmet: number;
}

export interface SimResult {
  series: SimDay[];
  /** First day (absolute) on which demand could not be met, or null */
  runOutDay: number | null;
  wastedQty: number;
  wastedValue: number;
  consumedQty: number;
  unmetQty: number;
  remainingLots: Lot[];
}

/** Simulate one product's lots forward `days` days from `startDay`. */
export function simulateProduct(
  lots: Lot[],
  rate: number,
  startDay: number,
  days: number,
): SimResult {
  const working = lots
    .map((l) => ({ ...l }))
    .sort((a, b) => a.expiresDay - b.expiresDay);
  const series: SimDay[] = [];
  let runOutDay: number | null = null;
  let wastedQty = 0;
  let wastedValue = 0;
  let consumedQty = 0;
  let unmetQty = 0;

  for (let d = 0; d < days; d++) {
    const day = startDay + d;
    // Expire lots whose date has passed (anything still around on/after its expiry day)
    let wasted = 0;
    let wv = 0;
    for (const lot of working) {
      if (lot.qty > 0 && lot.expiresDay <= day) {
        wasted += lot.qty;
        wv += lot.qty * lot.costPerUnit;
        lot.qty = 0;
      }
    }
    // Consume
    let demand = rate;
    let consumed = 0;
    for (const lot of working) {
      if (demand <= 1e-9) break;
      if (lot.qty <= 0) continue;
      const take = Math.min(lot.qty, demand);
      lot.qty -= take;
      demand -= take;
      consumed += take;
    }
    const unmet = Math.max(0, demand);
    if (unmet > rate * 0.25 && runOutDay === null) runOutDay = day;
    wastedQty += wasted;
    wastedValue += wv;
    consumedQty += consumed;
    unmetQty += unmet;
    series.push({
      day,
      stock: working.reduce((s, l) => s + l.qty, 0),
      consumed,
      wasted,
      wastedValue: wv,
      unmet,
    });
  }

  return {
    series,
    runOutDay,
    wastedQty,
    wastedValue,
    consumedQty,
    unmetQty,
    remainingLots: working.filter((l) => l.qty > 1e-6),
  };
}

export function trackedProductIds(lots: Lot[], purchases: Purchase[]): string[] {
  const ids = new Set<string>();
  lots.forEach((l) => ids.add(l.productId));
  purchases.forEach((p) => ids.add(p.productId));
  return [...ids].filter((id) => PRODUCTS_BY_ID[id]);
}

export type StockStatus = "out" | "low" | "expiring" | "ok";

export interface ProductOutlook {
  productId: string;
  stock: number;
  rate: RateEstimate;
  daysOfCover: number;
  runOutDay: number | null;
  nextExpiryDay: number | null;
  projectedWasteQty: number;
  projectedWasteValue: number;
  status: StockStatus;
  stockValue: number;
}

export function productOutlook(
  productId: string,
  lots: Lot[],
  household: Household,
  purchases: Purchase[],
  today: number,
  horizon = 14,
): ProductOutlook {
  const mine = lots.filter((l) => l.productId === productId && l.qty > 0);
  const rate = estimateRate(productId, household, purchases);
  const sim = simulateProduct(mine, rate.rate, today, horizon);
  const stock = mine.reduce((s, l) => s + l.qty, 0);
  const nextExpiry = mine.length ? Math.min(...mine.map((l) => l.expiresDay)) : null;
  const daysOfCover = rate.rate > 0 ? stock / rate.rate : Infinity;
  let status: StockStatus = "ok";
  if (stock <= 1e-6) status = "out";
  else if (sim.runOutDay !== null && sim.runOutDay - today <= 3) status = "low";
  else if (nextExpiry !== null && nextExpiry - today <= 2) status = "expiring";
  return {
    productId,
    stock,
    rate,
    daysOfCover,
    runOutDay: sim.runOutDay,
    nextExpiryDay: nextExpiry,
    projectedWasteQty: sim.wastedQty,
    projectedWasteValue: sim.wastedValue,
    status,
    stockValue: mine.reduce((s, l) => s + l.qty * l.costPerUnit, 0),
  };
}
