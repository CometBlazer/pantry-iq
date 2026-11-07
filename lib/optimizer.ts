// Shopping basket optimisation.
//
// Decision variables: n[i,k] ∈ ℤ≥0 — how many of pack k to buy for product i.
// For each product we enumerate every feasible integer pack combination and score it by
// simulating the household's consumption forward (so expiry and FIFO usage are exact):
//
//   objective_i(n) = cost_i(n)
//                  + λ_waste    · value of extra food that will expire unused
//                  + λ_short    · value of avoidable unmet demand within the horizon
//                  − γ_carry    · value of usable stock left over at the end of the horizon
//
// The basket problem  min Σ_i objective_i  s.t.  Σ_i cost_i ≤ budget  is a multiple-choice
// knapsack (a special case of mixed-integer programming), solved exactly by dynamic programming
// over the budget in pence.

import { formatQty, PRODUCTS_BY_ID, type PackOption, type Product } from "./catalog";
import { estimateRate, simulateProduct, trackedProductIds } from "./forecast";
import type { Lot, PantryState } from "./types";

export interface OptimiserSettings {
  horizonDays: number;
  /** Budget cap in pence, or null for unconstrained */
  budget: number | null;
  /** Weight on wasted value (λ_waste) */
  wasteAversion: number;
  /** Raise the shortfall penalty for fruit & veg (nutrition) */
  protectFiveADay: boolean;
}

export const DEFAULT_SETTINGS: OptimiserSettings = {
  horizonDays: 7,
  budget: null,
  wasteAversion: 1.5,
  protectFiveADay: true,
};

const CARRY_CREDIT = 0.6;
// Running out typically means an emergency top-up at convenience-store prices, plus the hassle
const SHORTFALL_PENALTY = 6;
const MAX_EXTENDED_DAYS = 120;
/** Convenience-store mark-up when a household has to top up something it ran out of */
const TOP_UP_PREMIUM = 1.3;

export interface PackChoice {
  pack: PackOption;
  count: number;
}

export interface Option {
  choices: PackChoice[];
  qty: number;
  cost: number;
  addedWasteQty: number;
  addedWasteValue: number;
  unmetQty: number;
  carryQty: number;
  objective: number;
}

export interface ProductPlan {
  product: Product;
  rate: number;
  stock: number;
  need: number;
  unavoidableUnmet: number;
  refUnitPrice: number;
  runOutDay: number | null;
  options: Option[];
  nothing: Option;
}

export interface BasketLine {
  product: Product;
  option: Option;
  plan: ProductPlan;
  reasons: string[];
}

export interface Basket {
  name: string;
  description: string;
  lines: BasketLine[];
  cost: number;
  wasteValue: number;
  /** Fraction of avoidable demand that the basket covers (0–1) */
  coverage: number;
  carryValue: number;
  /** Value of avoidable demand left uncovered, priced at convenience-store top-up rates */
  topUpCost: number;
  /** cost + waste + emergency top-ups − carry-over credit: the true economic cost */
  effectiveCost: number;
  kcal: number;
  protein: number;
  fiveADayPortions: number;
}

function cheapestUnitPrice(product: Product): number {
  return Math.min(...product.packs.map((p) => p.price / p.size));
}

function enumerateCombos(product: Product, target: number): PackChoice[][] {
  const packs = product.packs;
  const largest = Math.max(...packs.map((p) => p.size));
  const cap = target * 1.6 + largest; // don't consider absurdly large baskets
  const out: PackChoice[][] = [];
  const counts = new Array(packs.length).fill(0);

  const rec = (i: number, qty: number) => {
    if (i === packs.length) {
      if (qty > 0) out.push(packs.map((pack, k) => ({ pack, count: counts[k] })).filter((c) => c.count > 0));
      return;
    }
    for (let n = 0; n <= 12; n++) {
      const q = qty + n * packs[i].size;
      if (n > 0 && q > cap) break;
      counts[i] = n;
      rec(i + 1, q);
    }
    counts[i] = 0;
  };
  rec(0, 0);
  return out;
}

function evaluate(
  product: Product,
  choices: PackChoice[],
  existing: Lot[],
  rate: number,
  today: number,
  settings: OptimiserSettings,
  base: { unmet: number; consumed: number; wasteExtQty: number; wasteExtValue: number },
  unavoidableUnmet: number,
  refUnitPrice: number,
): Option {
  const qty = choices.reduce((s, c) => s + c.count * c.pack.size, 0);
  const cost = choices.reduce((s, c) => s + c.count * c.pack.price, 0);
  if (qty === 0) {
    const shortfall = Math.max(0, base.unmet - unavoidableUnmet);
    const penalty = shortfallWeight(product, settings) * shortfall * refUnitPrice;
    return {
      choices: [], qty: 0, cost: 0, addedWasteQty: 0, addedWasteValue: 0,
      unmetQty: base.unmet, carryQty: 0, objective: penalty,
    };
  }
  const newLot: Lot = {
    id: "new",
    productId: product.id,
    qty,
    purchasedDay: today,
    expiresDay: today + product.shelfLifeDays,
    costPerUnit: cost / qty,
  };
  const lots = [...existing, newLot];
  const H = settings.horizonDays;
  const inHorizon = simulateProduct(lots, rate, today, H);
  const extDays = Math.min(MAX_EXTENDED_DAYS, Math.max(H, product.shelfLifeDays + 1));
  const extended = simulateProduct(lots, rate, today, extDays);

  const addedWasteQty = Math.max(0, extended.wastedQty - base.wasteExtQty);
  const addedWasteValue = Math.max(0, extended.wastedValue - base.wasteExtValue);
  const consumedFromNew = Math.max(0, inHorizon.consumedQty - base.consumed);
  const carryQty = Math.max(0, qty - consumedFromNew - addedWasteQty);
  const shortfall = Math.max(0, inHorizon.unmetQty - unavoidableUnmet);

  const objective =
    cost +
    settings.wasteAversion * addedWasteValue +
    shortfallWeight(product, settings) * shortfall * refUnitPrice -
    CARRY_CREDIT * carryQty * refUnitPrice;

  return {
    choices, qty, cost, addedWasteQty, addedWasteValue,
    unmetQty: inHorizon.unmetQty, carryQty, objective,
  };
}

function shortfallWeight(product: Product, settings: OptimiserSettings): number {
  return SHORTFALL_PENALTY * (settings.protectFiveADay && product.fiveADay ? 2 : 1);
}

export function buildPlans(state: PantryState, settings: OptimiserSettings): ProductPlan[] {
  const { today, household, lots, purchases } = state;
  const H = settings.horizonDays;
  const ids = trackedProductIds(lots, purchases).filter((id) => !household.excluded.includes(id));

  return ids.map((id) => {
    const product = PRODUCTS_BY_ID[id];
    const existing = lots.filter((l) => l.productId === id && l.qty > 0);
    const rate = estimateRate(id, household, purchases).rate;
    const refUnitPrice = cheapestUnitPrice(product);

    const baseH = simulateProduct(existing, rate, today, H);
    const extDays = Math.min(MAX_EXTENDED_DAYS, Math.max(H, product.shelfLifeDays + 1));
    const baseExt = simulateProduct(existing, rate, today, extDays);

    // Unmet demand that no single shop today could prevent (fresh food expiring mid-horizon)
    const ideal: Lot = {
      id: "ideal", productId: id, qty: rate * H * 3 + 1, purchasedDay: today,
      expiresDay: today + product.shelfLifeDays, costPerUnit: 0,
    };
    const unavoidableUnmet = simulateProduct([...existing, ideal], rate, today, H).unmetQty;
    const need = Math.max(0, baseH.unmetQty - unavoidableUnmet);

    const base = {
      unmet: baseH.unmetQty,
      consumed: baseH.consumedQty,
      wasteExtQty: baseExt.wastedQty,
      wasteExtValue: baseExt.wastedValue,
    };
    const ev = (choices: PackChoice[]) =>
      evaluate(product, choices, existing, rate, today, settings, base, unavoidableUnmet, refUnitPrice);

    const nothing = ev([]);
    const options = need > rate * 0.05 ? enumerateCombos(product, need).map(ev) : [];

    return {
      product, rate, need, unavoidableUnmet, refUnitPrice, nothing, options,
      stock: existing.reduce((s, l) => s + l.qty, 0),
      runOutDay: baseH.runOutDay,
    };
  });
}

/** Exact multiple-choice knapsack: minimise Σ objective subject to Σ cost ≤ budget. */
function solve(plans: ProductPlan[], budget: number | null): Option[] {
  const menus = plans.map((p) => {
    // Keep only Pareto-efficient options (no other option is both cheaper and better)
    const all = [p.nothing, ...p.options].sort((a, b) => a.cost - b.cost || a.objective - b.objective);
    const frontier: Option[] = [];
    for (const o of all) {
      if (!frontier.length || o.objective < frontier[frontier.length - 1].objective - 1e-9) frontier.push(o);
    }
    return frontier;
  });

  if (budget === null) {
    return menus.map((m) => m.reduce((best, o) => (o.objective < best.objective ? o : best)));
  }

  const B = Math.max(0, Math.floor(budget));
  const INF = Number.POSITIVE_INFINITY;
  let dp = new Float64Array(B + 1).fill(0);
  const picks: Int16Array[] = [];
  for (const menu of menus) {
    const next = new Float64Array(B + 1).fill(INF);
    const pick = new Int16Array(B + 1).fill(-1);
    for (let b = 0; b <= B; b++) {
      for (let k = 0; k < menu.length; k++) {
        const c = menu[k].cost;
        if (c > b) break; // menu sorted by cost
        const v = dp[b - c] + menu[k].objective;
        if (v < next[b]) {
          next[b] = v;
          pick[b] = k;
        }
      }
    }
    picks.push(pick);
    dp = next;
  }
  // Reconstruct
  const chosen: Option[] = new Array(menus.length);
  let b = B;
  for (let i = menus.length - 1; i >= 0; i--) {
    const k = picks[i][b];
    const o = menus[i][k];
    chosen[i] = o;
    b -= o.cost;
  }
  return chosen;
}

function describeChoice(c: PackChoice[]): string {
  return c.map((x) => `${x.count} × ${x.pack.label}`).join(" + ");
}

function reasonsFor(plan: ProductPlan, option: Option, today: number, settings: OptimiserSettings): string[] {
  const r: string[] = [];
  const p = plan.product;
  if (plan.stock <= 0) r.push("Out of stock");
  else if (plan.runOutDay !== null) {
    const d = Math.max(0, plan.runOutDay - today);
    r.push(d === 0 ? "Runs out today" : `Runs out in ${d} day${d === 1 ? "" : "s"}`);
  }
  if (p.shelfLifeDays < settings.horizonDays) r.push(`Keeps ~${p.shelfLifeDays} days — top up again later`);
  const unitCosts = option.choices.map((c) => c.pack.price / c.pack.size);
  const worst = Math.max(...p.packs.map((x) => x.price / x.size));
  const best = Math.min(...unitCosts);
  if (option.choices.length && worst > best * 1.15)
    r.push(`${Math.round((1 - best / worst) * 100)}% cheaper per unit than the smallest pack`);
  if (option.addedWasteValue >= 15)
    r.push(`~${formatQty(option.addedWasteQty, p.unit)}${p.unit === "item" ? " items" : ""} may expire — accepted as cheapest overall`);
  return r;
}

function summarise(
  name: string,
  description: string,
  plans: ProductPlan[],
  options: Option[],
  today: number,
  settings: OptimiserSettings,
): Basket {
  let cost = 0, wasteValue = 0, carryValue = 0, needValue = 0, shortValue = 0;
  let kcal = 0, protein = 0, fiveADay = 0;
  const lines: BasketLine[] = [];
  plans.forEach((plan, i) => {
    const o = options[i];
    cost += o.cost;
    wasteValue += o.addedWasteValue;
    carryValue += CARRY_CREDIT * o.carryQty * plan.refUnitPrice;
    needValue += plan.need * plan.refUnitPrice;
    shortValue += Math.min(plan.need, Math.max(0, o.unmetQty - plan.unavoidableUnmet)) * plan.refUnitPrice;
    const p = plan.product;
    kcal += o.qty * p.kcalPerUnit;
    protein += o.qty * p.proteinPerUnit;
    if (p.fiveADay) fiveADay += p.unit === "item" ? o.qty : p.unit === "g" ? o.qty / 80 : o.qty / 150;
    if (o.qty > 0) lines.push({ product: p, option: o, plan, reasons: reasonsFor(plan, o, today, settings) });
  });
  return {
    name, description, lines, cost, wasteValue, carryValue,
    coverage: needValue > 0 ? 1 - shortValue / needValue : 1,
    topUpCost: TOP_UP_PREMIUM * shortValue,
    effectiveCost: cost + wasteValue + TOP_UP_PREMIUM * shortValue - carryValue,
    kcal, protein, fiveADayPortions: fiveADay,
  };
}

function simpleStrategy(plan: ProductPlan, pick: "largest" | "smallest"): Option {
  if (plan.need <= plan.rate * 0.05) return plan.nothing;
  const packs = [...plan.product.packs].sort((a, b) => a.size - b.size);
  const pack = pick === "largest" ? packs[packs.length - 1] : packs[0];
  const count = Math.max(1, Math.ceil(plan.need / pack.size));
  return (
    plan.options.find((o) => o.choices.length === 1 && o.choices[0].pack === pack && o.choices[0].count === count) ??
    plan.options.find((o) => o.choices.length === 1 && o.choices[0].pack === pack) ??
    plan.nothing
  );
}

export interface OptimisationResult {
  optimised: Basket;
  strategies: Basket[];
  stocked: ProductPlan[];
  plans: ProductPlan[];
}

export function optimise(state: PantryState, settings: OptimiserSettings): OptimisationResult {
  const plans = buildPlans(state, settings);
  const today = state.today;

  const optimal = solve(plans, settings.budget);
  const optimised = summarise(
    "PantryIQ optimised",
    settings.budget !== null ? "Exact MIP solution within your budget" : "Exact MIP solution, minimising cost + waste",
    plans, optimal, today, settings,
  );

  // Habitual: re-buy last week's shopping, regardless of what's already in the cupboard
  const habitual = plans.map((plan) => {
    const bought = state.purchases
      .filter((p) => p.day > today - 7 && p.productId === plan.product.id && p.store !== "PantryIQ list")
      .reduce((s, p) => s + p.qty, 0);
    if (bought <= 0) return plan.nothing;
    const combos = enumerateCombos(plan.product, bought);
    const best = combos.sort(
      (a, b) =>
        Math.abs(a.reduce((s, c) => s + c.count * c.pack.size, 0) - bought) -
        Math.abs(b.reduce((s, c) => s + c.count * c.pack.size, 0) - bought),
    )[0];
    return rescore(state, plan, best, settings);
  });

  const strategies = [
    optimised,
    summarise("Habitual re-buy", "Repeat the last 7 days of receipts without checking the cupboard", plans, habitual, today, settings),
    summarise("Bulk buyer", "Largest packs for anything running low", plans, plans.map((p) => simpleStrategy(p, "largest")), today, settings),
    summarise("Small & often", "Smallest packs for anything running low", plans, plans.map((p) => simpleStrategy(p, "smallest")), today, settings),
  ];

  return {
    optimised,
    strategies,
    stocked: plans.filter((p) => p.options.length === 0),
    plans,
  };
}

function rescore(state: PantryState, plan: ProductPlan, choices: PackChoice[], settings: OptimiserSettings): Option {
  const product = plan.product;
  const existing = state.lots.filter((l) => l.productId === product.id && l.qty > 0);
  const H = settings.horizonDays;
  const baseH = simulateProduct(existing, plan.rate, state.today, H);
  const extDays = Math.min(MAX_EXTENDED_DAYS, Math.max(H, product.shelfLifeDays + 1));
  const baseExt = simulateProduct(existing, plan.rate, state.today, extDays);
  return evaluate(
    product, choices, existing, plan.rate, state.today, settings,
    { unmet: baseH.unmetQty, consumed: baseH.consumedQty, wasteExtQty: baseExt.wastedQty, wasteExtValue: baseExt.wastedValue },
    plan.unavoidableUnmet, plan.refUnitPrice,
  );
}

export { describeChoice };
