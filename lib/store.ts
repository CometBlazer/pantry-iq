// Household inventory state: a reducer persisted to localStorage.
// (Production would back this with PostgreSQL; the reducer actions map 1:1 onto table writes.)

import { CATALOG, PRODUCTS_BY_ID } from "./catalog";
import { estimateRate, simulateProduct, trackedProductIds } from "./forecast";
import { parseReceiptText, resolveItems, SAMPLE_RECEIPTS } from "./receipt";
import type { Lot, PantryState, ReceiptLine } from "./types";

export type Action =
  | { type: "addReceipt"; store: string; lines: ReceiptLine[] }
  | { type: "advance"; days: number }
  | { type: "setMembers"; members: number }
  | { type: "setMultiplier"; productId: string; multiplier: number }
  | { type: "toggleExclude"; productId: string }
  | { type: "useUp"; productId: string }
  | { type: "bin"; productId: string }
  | { type: "buyBasket"; items: { productId: string; qty: number; cost: number }[] }
  | { type: "loadDemo"; today: number }
  | { type: "reset"; today: number }
  | { type: "hydrate"; state: PantryState };

export function emptyState(today: number): PantryState {
  return {
    today,
    household: { members: 2, usageMultiplier: {}, excluded: [] },
    lots: [],
    purchases: [],
    waste: [],
    receiptsScanned: 0,
  };
}

let lotCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(lotCounter++).toString(36)}`;

function addStock(
  state: PantryState,
  items: { productId: string; qty: number; cost: number }[],
  store: string,
): PantryState {
  const lots: Lot[] = [...state.lots];
  const purchases = [...state.purchases];
  for (const it of items) {
    const product = PRODUCTS_BY_ID[it.productId];
    if (!product || it.qty <= 0) continue;
    const cheapest = Math.min(...product.packs.map((p) => p.price / p.size));
    lots.push({
      id: newId(),
      productId: it.productId,
      qty: it.qty,
      purchasedDay: state.today,
      expiresDay: state.today + product.shelfLifeDays,
      costPerUnit: it.cost > 0 ? it.cost / it.qty : cheapest,
    });
    purchases.push({ productId: it.productId, qty: it.qty, day: state.today, pricePaid: it.cost, store });
  }
  return { ...state, lots, purchases };
}

function advance(state: PantryState, days: number): PantryState {
  const ids = trackedProductIds(state.lots, state.purchases);
  let lots: Lot[] = state.lots.filter((l) => !ids.includes(l.productId));
  const waste = [...state.waste];
  for (const id of ids) {
    const mine = state.lots.filter((l) => l.productId === id);
    if (!mine.length) continue;
    const rate = estimateRate(id, state.household, state.purchases).rate;
    const sim = simulateProduct(mine, rate, state.today, days);
    for (const d of sim.series) {
      if (d.wasted > 0) waste.push({ productId: id, qty: d.wasted, value: d.wastedValue, day: d.day });
    }
    lots = lots.concat(sim.remainingLots);
  }
  return { ...state, today: state.today + days, lots, waste };
}

export function reducer(state: PantryState, action: Action): PantryState {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "addReceipt": {
      const items = action.lines
        .filter((l) => l.productId && l.qty > 0)
        .map((l) => ({ productId: l.productId!, qty: l.qty, cost: l.linePrice ?? 0 }));
      const next = addStock(state, items, action.store);
      return { ...next, receiptsScanned: state.receiptsScanned + 1 };
    }
    case "buyBasket":
      return addStock(state, action.items, "PantryIQ list");
    case "advance":
      return advance(state, action.days);
    case "setMembers":
      return { ...state, household: { ...state.household, members: action.members } };
    case "setMultiplier":
      return {
        ...state,
        household: {
          ...state.household,
          usageMultiplier: { ...state.household.usageMultiplier, [action.productId]: action.multiplier },
        },
      };
    case "toggleExclude": {
      const ex = state.household.excluded;
      return {
        ...state,
        household: {
          ...state.household,
          excluded: ex.includes(action.productId) ? ex.filter((x) => x !== action.productId) : [...ex, action.productId],
        },
      };
    }
    case "useUp":
      return { ...state, lots: state.lots.filter((l) => l.productId !== action.productId) };
    case "bin": {
      const binned = state.lots.filter((l) => l.productId === action.productId);
      return {
        ...state,
        lots: state.lots.filter((l) => l.productId !== action.productId),
        waste: [
          ...state.waste,
          ...binned.map((l) => ({ productId: l.productId, qty: l.qty, value: l.qty * l.costPerUnit, day: state.today })),
        ],
      };
    }
    case "reset":
      return emptyState(action.today);
    case "loadDemo":
      return buildDemo(action.today);
  }
}

/** A household with three weeks of receipt history, so forecasts have real data to learn from. */
function buildDemo(today: number): PantryState {
  const scan = (s: PantryState, idx: number) => {
    const raw = parseReceiptText(SAMPLE_RECEIPTS[idx].text);
    return reducer(s, { type: "addReceipt", store: raw.store, lines: resolveItems(raw.items) });
  };
  let s = emptyState(today - 18);
  s = reducer(s, { type: "setMembers", members: 2 });
  s = scan(s, 2); // cupboard restock
  s = scan(s, 0); // big shop
  s = advance(s, 4);
  s = scan(s, 1); // midweek top-up
  s = advance(s, 3);
  s = scan(s, 0);
  s = advance(s, 4);
  s = scan(s, 1);
  s = advance(s, 3);
  s = scan(s, 0);
  s = advance(s, 4);
  return s;
}

const KEY = "pantryiq-state-v1";

export function loadState(): PantryState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PantryState;
    if (typeof parsed.today !== "number" || !Array.isArray(parsed.lots)) return null;
    // Drop anything that no longer exists in the catalogue
    const known = new Set(CATALOG.map((p) => p.id));
    return {
      ...parsed,
      lots: parsed.lots.filter((l) => known.has(l.productId)),
      purchases: parsed.purchases.filter((p) => known.has(p.productId)),
    };
  } catch {
    return null;
  }
}

export function saveState(state: PantryState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full or unavailable — state stays in memory
  }
}
