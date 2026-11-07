"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { AlertTriangle, Minus, PackageX, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { formatPence, formatQty, PRODUCTS_BY_ID } from "@/lib/catalog";
import { estimateRate, simulateProduct, trackedProductIds, type SimResult } from "@/lib/forecast";
import type { Action } from "@/lib/store";
import type { PantryState } from "@/lib/types";
import { formatDay } from "@/lib/types";

const stockConfig = { stock: { label: "In stock", color: "var(--chart-1)" } } satisfies ChartConfig;
const wasteConfig = { waste: { label: "Food expiring", color: "var(--chart-3)" } } satisfies ChartConfig;

export function ForecastView({ state, dispatch }: { state: PantryState; dispatch: (a: Action) => void }) {
  const [horizon, setHorizon] = useState(14);
  const today = state.today;

  const sims = useMemo(() => {
    const out: Record<string, SimResult & { rate: number }> = {};
    for (const id of trackedProductIds(state.lots, state.purchases)) {
      const lots = state.lots.filter((l) => l.productId === id);
      const rate = estimateRate(id, state.household, state.purchases).rate;
      out[id] = { ...simulateProduct(lots, rate, today, horizon), rate };
    }
    return out;
  }, [state, today, horizon]);

  const ids = Object.keys(sims);
  const atRisk = [...ids].sort(
    (a, b) => (sims[a].runOutDay ?? Infinity) - (sims[b].runOutDay ?? Infinity),
  );
  const [selected, setSelected] = useState<string | null>(null);
  // Default to the first product that has stock now but runs out within the horizon
  const current =
    selected && sims[selected]
      ? selected
      : (atRisk.find((id) => sims[id].runOutDay !== null && sims[id].runOutDay! > today + 1) ?? atRisk[0]);

  const product = current ? PRODUCTS_BY_ID[current] : null;
  const sim = current ? sims[current] : null;
  const startStock = current
    ? state.lots.filter((l) => l.productId === current).reduce((s, l) => s + l.qty, 0)
    : 0;
  const stockData = sim
    ? [{ label: formatDay(today), stock: startStock }, ...sim.series.map((d) => ({ label: formatDay(d.day + 1), stock: Math.round(d.stock * 10) / 10 }))]
    : [];

  const wasteData = Array.from({ length: horizon }, (_, d) => {
    const day = today + d;
    const value = ids.reduce((s, id) => s + (sims[id].series[d]?.wastedValue ?? 0), 0);
    return { label: formatDay(day), waste: Math.round(value) / 100 };
  });
  const totalWaste = ids.reduce((s, id) => s + sims[id].wastedValue, 0);

  type Event = { day: number; kind: "runout" | "waste"; productId: string; detail: string };
  const events: Event[] = [];
  for (const id of ids) {
    const s = sims[id];
    const p = PRODUCTS_BY_ID[id];
    if (s.runOutDay !== null) events.push({ day: s.runOutDay, kind: "runout", productId: id, detail: "Runs out" });
    for (const d of s.series) {
      if (d.wasted > 0)
        events.push({
          day: d.day,
          kind: "waste",
          productId: id,
          detail: `${formatQty(d.wasted, p.unit)}${p.unit === "item" ? " items" : ""} expires (${formatPence(d.wastedValue)})`,
        });
    }
  }
  events.sort((a, b) => a.day - b.day);

  const productItems = Object.fromEntries(atRisk.map((id) => [id, PRODUCTS_BY_ID[id].name]));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6">
          <div className="flex min-w-64 flex-1 items-center gap-4">
            <Label className="shrink-0">Forecast horizon</Label>
            <Slider
              min={3}
              max={28}
              step={1}
              value={[horizon]}
              onValueChange={(v) => setHorizon(Array.isArray(v) ? v[0] : v)}
              className="max-w-72"
            />
            <span className="w-16 text-sm tabular-nums">{horizon} days</span>
          </div>
          <div className="text-body-sm text-mute">
            Projected waste over this period:{" "}
            <span className="font-semibold text-foreground">{formatPence(totalWaste)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Stock projection</CardTitle>
            <CardDescription>
              {product && sim
                ? `${formatQty(sim.rate, product.unit)}${product.unit === "item" ? " items" : ""} used per day · ${
                    sim.runOutDay !== null ? `runs out ${formatDay(sim.runOutDay)}` : `lasts beyond ${horizon} days`
                  }`
                : "Add items to see projections"}
            </CardDescription>
            {current && product && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
                <Select items={productItems} value={current} onValueChange={(v) => setSelected(v as string)}>
                  <SelectTrigger size="sm" className="w-60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {atRisk.map((id) => (
                      <SelectItem key={id} value={id}>
                        {PRODUCTS_BY_ID[id].name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <UsageStepper
                  productId={current}
                  state={state}
                  dispatch={(a) => {
                    // Pin the chart to this product: changing usage re-ranks the default choice
                    setSelected(current);
                    dispatch(a);
                  }}
                />
              </div>
            )}
          </CardHeader>
          <CardContent>
            <ChartContainer config={stockConfig} className="aspect-auto h-64 w-full">
              <AreaChart data={stockData} margin={{ left: 4, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => (product ? formatQty(v, product.unit) : String(v))}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(v) => (
                        <span>
                          In stock{" "}
                          <span className="font-semibold tabular-nums text-ink">
                            {product ? formatQty(Number(v), product.unit) : String(v)}
                          </span>
                        </span>
                      )}
                    />
                  }
                />
                {sim?.runOutDay != null && (
                  <ReferenceLine
                    x={formatDay(sim.runOutDay)}
                    stroke="var(--color-error)"
                    strokeDasharray="4 4"
                    label={{ value: "Runs out", position: "insideTopRight", fill: "var(--color-mute)", fontSize: 11 }}
                  />
                )}
                <Area
                  dataKey="stock"
                  type="stepAfter"
                  stroke="var(--color-stock)"
                  strokeWidth={2}
                  fill="var(--color-stock)"
                  fillOpacity={0.15}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Food expiring unused</CardTitle>
            <CardDescription>
              Value of stock forecast to pass its date before your household gets to it, if you change nothing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={wasteConfig} className="aspect-auto h-64 w-full">
              <BarChart data={wasteData} margin={{ left: 4, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => `£${v.toFixed(2)}`} />
                <ChartTooltip
                  cursor={{ fill: "var(--color-secondary-bg)", opacity: 0.6 }}
                  content={
                    <ChartTooltipContent
                      formatter={(v) => (
                        <span>
                          Expiring{" "}
                          <span className="font-semibold tabular-nums text-ink">£{Number(v).toFixed(2)}</span>
                        </span>
                      )}
                    />
                  }
                />
                <Bar dataKey="waste" fill="var(--color-waste)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What happens next</CardTitle>
          <CardDescription>Simulated run-outs and expiries over the next {horizon} days.</CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-body-sm text-mute">Nothing runs out or expires in this window.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-hairline pl-5">
              {events.slice(0, 40).map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[27px] top-0.5 flex size-3.5 items-center justify-center rounded-full bg-card">
                    {e.kind === "runout" ? (
                      <PackageX className="size-3.5 text-error" />
                    ) : (
                      <AlertTriangle className="size-3.5 text-accent-purple" />
                    )}
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="w-24 shrink-0 text-xs text-mute tabular-nums">
                      {e.day === today ? "Today" : formatDay(e.day)}
                    </span>
                    <span className="font-semibold text-ink">{PRODUCTS_BY_ID[e.productId].name}</span>
                    <Badge variant="outline" className="font-normal">
                      {e.detail}
                    </Badge>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** "We use more / less of this" — scales the learned consumption rate */
function UsageStepper({
  productId,
  state,
  dispatch,
}: {
  productId: string;
  state: PantryState;
  dispatch: (a: Action) => void;
}) {
  const product = PRODUCTS_BY_ID[productId];
  const mult = state.household.usageMultiplier[productId] ?? 1;
  const rate = estimateRate(productId, state.household, state.purchases);
  const set = (m: number) => dispatch({ type: "setMultiplier", productId, multiplier: Math.min(3, Math.max(0.25, m)) });
  return (
    <div className="flex items-center gap-1 rounded-full bg-surface-card p-1">
      <Button variant="ghost" size="icon-xs" aria-label="We use less" disabled={mult <= 0.25} onClick={() => set(mult - 0.25)}>
        <Minus />
      </Button>
      <span className="min-w-28 text-center text-sm tabular-nums text-ink">
        {formatQty(rate.rate, product.unit)}
        {product.unit === "item" ? " items" : ""} / day
        {mult !== 1 && <span className="ml-1 text-xs text-mute">×{mult}</span>}
      </span>
      <Button variant="ghost" size="icon-xs" aria-label="We use more" disabled={mult >= 3} onClick={() => set(mult + 0.25)}>
        <Plus />
      </Button>
    </div>
  );
}
