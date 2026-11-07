"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import { Ban, CheckCircle2, ShoppingCart, Sigma } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPence, formatQty, PRODUCTS_BY_ID } from "@/lib/catalog";
import { DEFAULT_SETTINGS, describeChoice, optimise, type OptimiserSettings } from "@/lib/optimizer";
import type { Action } from "@/lib/store";
import type { PantryState } from "@/lib/types";
import { cn } from "@/lib/utils";

const costConfig = { trueCost: { label: "True cost", color: "var(--chart-1)" } } satisfies ChartConfig;

export function ShoppingOptimiser({
  state,
  dispatch,
}: {
  state: PantryState;
  dispatch: (a: Action) => void;
}) {
  const [settings, setSettings] = useState<OptimiserSettings>(DEFAULT_SETTINGS);
  const [budgetText, setBudgetText] = useState("");
  const deferred = useDeferredValue(settings);
  const result = useMemo(() => optimise(state, deferred), [state, deferred]);
  const basket = result.optimised;

  const set = (patch: Partial<OptimiserSettings>) => setSettings((s) => ({ ...s, ...patch }));

  const habitual = result.strategies.find((s) => s.name.startsWith("Habitual"));
  const saving = habitual ? habitual.effectiveCost - basket.effectiveCost : 0;

  const chartData = result.strategies.map((s) => ({
    name: s.name.replace("PantryIQ optimised", "PantryIQ"),
    trueCost: Math.round(s.effectiveCost) / 100,
    optimised: s === basket,
  }));

  const buy = () => {
    dispatch({
      type: "buyBasket",
      items: basket.lines.map((l) => ({ productId: l.product.id, qty: l.option.qty, cost: l.option.cost })),
    });
    toast.success("Basket added to your pantry", {
      description: `${basket.lines.length} products · ${formatPence(basket.cost)}`,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-3">
            <Label>Plan for the next</Label>
            <div className="flex items-center gap-3">
              <Slider
                min={3}
                max={21}
                step={1}
                value={[settings.horizonDays]}
                onValueChange={(v) => set({ horizonDays: Array.isArray(v) ? v[0] : v })}
              />
              <span className="w-16 shrink-0 text-sm tabular-nums">{settings.horizonDays} days</span>
            </div>
          </div>
          <div className="space-y-3">
            <Label htmlFor="budget">Budget cap (optional)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">£</span>
              <Input
                id="budget"
                inputMode="decimal"
                placeholder="No limit"
                className="pl-6"
                value={budgetText}
                onChange={(e) => {
                  setBudgetText(e.target.value);
                  const v = parseFloat(e.target.value);
                  set({ budget: Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v * 100), 50000) : null });
                }}
              />
            </div>
          </div>
          <div className="space-y-3">
            <Label>Waste aversion</Label>
            <div className="flex items-center gap-3">
              <Slider
                min={0}
                max={4}
                step={0.25}
                value={[settings.wasteAversion]}
                onValueChange={(v) => set({ wasteAversion: Array.isArray(v) ? v[0] : v })}
              />
              <span className="w-16 shrink-0 text-sm tabular-nums">×{settings.wasteAversion.toFixed(2)}</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 md:pt-6">
            <Label htmlFor="five-a-day" className="leading-snug">
              Protect fruit &amp; veg
              <span className="block text-xs font-normal text-muted-foreground">Prioritise 5-a-day when budget is tight</span>
            </Label>
            <Switch
              id="five-a-day"
              checked={settings.protectFiveADay}
              onCheckedChange={(c) => set({ protectFiveADay: c })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="size-4" /> Optimised shopping list
            </CardTitle>
            <CardDescription>
              {basket.lines.length
                ? `${basket.lines.length} products · ${formatPence(basket.cost)} · covers ${Math.round(basket.coverage * 100)}% of what you'll need`
                : "Nothing to buy — you're stocked for this period."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {basket.lines.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Buy</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Why</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {basket.lines.map((l) => (
                    <TableRow key={l.product.id}>
                      <TableCell>
                        <div className="font-medium">{l.product.name}</div>
                        <div className="text-xs text-muted-foreground">
                          have {formatQty(l.plan.stock, l.product.unit)} · need {formatQty(l.plan.need, l.product.unit)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{describeChoice(l.option.choices)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPence(l.option.cost)}</TableCell>
                      <TableCell>
                        <div className="flex max-w-80 flex-wrap gap-1">
                          {l.reasons.map((r) => (
                            <Badge key={r} variant="outline" className="font-normal">
                              {r}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Never suggest ${l.product.name}`}
                          title="Never suggest this"
                          onClick={() => dispatch({ type: "toggleExclude", productId: l.product.id })}
                        >
                          <Ban />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
          {basket.lines.length > 0 && (
            <CardFooter className="flex-wrap justify-between gap-3">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                <span>
                  Spend <b className="text-foreground">{formatPence(basket.cost)}</b>
                </span>
                <span>
                  Likely waste <b className="text-foreground">{formatPence(basket.wasteValue)}</b>
                </span>
                <span>
                  ~{Math.round(basket.kcal / 1000)}k kcal · {Math.round(basket.protein)} g protein ·{" "}
                  {Math.round(basket.fiveADayPortions)} fruit &amp; veg portions
                </span>
              </div>
              <Button onClick={buy}>
                <CheckCircle2 /> I bought this
              </Button>
            </CardFooter>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Compare strategies</CardTitle>
              <CardDescription>
                True cost = spend + food wasted + emergency top-ups for anything you run out of − value of useful
                stock left over.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={costConfig} className="aspect-auto h-48 w-full">
                <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 48 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={104} />
                  <ChartTooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                    content={
                      <ChartTooltipContent
                        hideIndicator
                        formatter={(v) => (
                          <span>
                            True cost <span className="font-mono font-medium tabular-nums">£{Number(v).toFixed(2)}</span>
                          </span>
                        )}
                      />
                    }
                  />
                  <Bar dataKey="trueCost" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {chartData.map((d) => (
                      <Cell key={d.name} fill={d.optimised ? "var(--color-trueCost)" : "var(--muted-foreground)"} fillOpacity={d.optimised ? 1 : 0.35} />
                    ))}
                    <LabelList
                      dataKey="trueCost"
                      position="right"
                      className="fill-foreground text-xs tabular-nums"
                      formatter={(v) => `£${Number(v).toFixed(2)}`}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
              <Table className="mt-2 text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategy</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Waste</TableHead>
                    <TableHead className="text-right">Covers</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.strategies.map((s) => (
                    <TableRow key={s.name} className={cn(s === basket && "font-medium")}>
                      <TableCell title={s.description}>{s.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPence(s.cost)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPence(s.wasteValue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{Math.round(s.coverage * 100)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {saving > 50 && (
                <p className="mt-3 rounded-md bg-primary/10 p-3 text-sm text-primary">
                  PantryIQ saves about <b>{formatPence(saving)}</b> versus re-buying last week&apos;s shop — over{" "}
                  <b>{formatPence(saving * 52 * (7 / settings.horizonDays))}</b> a year.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sigma className="size-4" /> How it&apos;s solved
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>
                Each product&apos;s integer pack choices (n<sub>i,k</sub> ∈ ℤ≥0) are scored by simulating your household&apos;s
                consumption day by day, so expiry dates and pack sizes are modelled exactly.
              </p>
              <p>
                The basket minimises Σ cost + λ·waste + penalty·shortfall − carry-over, subject to Σ cost ≤ budget. This
                multiple-choice knapsack is solved to optimality by dynamic programming over the budget in pence.
              </p>
              <p>
                Already well stocked:{" "}
                {result.stocked.length ? result.stocked.map((p) => p.product.name).join(", ") : "nothing yet"}.
              </p>
              {state.household.excluded.length > 0 && (
                <p>
                  Excluded:{" "}
                  {state.household.excluded.map((id, i) => (
                    <button
                      key={id}
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={() => dispatch({ type: "toggleExclude", productId: id })}
                    >
                      {PRODUCTS_BY_ID[id]?.name ?? id}
                      {i < state.household.excluded.length - 1 ? ", " : ""}
                    </button>
                  ))}{" "}
                  (click to restore)
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
