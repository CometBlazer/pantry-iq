// Calorie estimates. Densities are stored per 100 g / 100 ml / item (how labels print them);
// stock is tracked in base units, so convert with basisSize.

import { PRODUCTS_BY_ID, type Unit } from "./catalog";
import type { KcalEntry, PantryState } from "./types";

export function basisSize(unit: Unit): number {
  return unit === "item" ? 1 : 100;
}

export function basisLabel(unit: Unit): string {
  return unit === "item" ? "each" : `/100 ${unit}`;
}

export type KcalSource = KcalEntry["source"] | "typical";

/** kcal per 100 g / 100 ml / item for a product, falling back to the food database's typical value. */
export function kcalDensity(productId: string, kcal: PantryState["kcal"]): { per: number; source: KcalSource } {
  const entry = kcal[productId];
  if (entry) return entry;
  const p = PRODUCTS_BY_ID[productId];
  return { per: Math.round(p.kcalPerUnit * basisSize(p.unit)), source: "typical" };
}

/** kcal in `qty` base units of a product */
export function kcalFor(productId: string, qty: number, kcal: PantryState["kcal"]): number {
  const p = PRODUCTS_BY_ID[productId];
  return (qty * kcalDensity(productId, kcal).per) / basisSize(p.unit);
}

export function formatKcal(kcal: number): string {
  return `${Math.round(kcal).toLocaleString("en-GB")} kcal`;
}
