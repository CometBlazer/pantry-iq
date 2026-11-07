"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import {
  CalendarClock,
  FastForward,
  LineChart,
  Package,
  PiggyBank,
  RotateCcw,
  ScanLine,
  ShoppingCart,
  Sigma,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPence, PRODUCTS_BY_ID } from "@/lib/catalog";
import { productOutlook, trackedProductIds } from "@/lib/forecast";
import { emptyState, loadState, reducer, saveState } from "@/lib/store";
import { dayFromDate, formatDay } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ForecastView } from "./forecast-view";
import { PantryTable } from "./pantry-table";
import { ReceiptScanner } from "./receipt-scanner";
import { ShoppingOptimiser } from "./shopping-optimiser";

const MEMBER_ITEMS = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [String(n), `${n} ${n === 1 ? "person" : "people"}`]));

function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Package className="size-4" />
      </div>
      <span className="text-heading-lg font-bold tracking-[-0.6px] text-primary">PantryIQ</span>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  attention,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  attention?: boolean;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            attention ? "bg-ink text-on-dark" : "bg-canvas text-ink",
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-mute">{label}</div>
          <div className="text-heading-xl tabular-nums text-ink">{value}</div>
          <div className="truncate text-body-sm text-mute">{hint}</div>
        </div>
      </CardContent>
    </Card>
  );
}

const HOW_IT_WORKS = [
  { icon: ScanLine, title: "Scan receipts", body: "Photograph a receipt — every line becomes stock with a price and a best-before date." },
  { icon: LineChart, title: "Forecast usage", body: "PantryIQ learns how fast you get through things and predicts run-outs and waste." },
  { icon: Sigma, title: "Buy only what you need", body: "An exact optimiser picks the cheapest pack sizes that cover the week ahead." },
];

export function PantryApp() {
  // Day 0 marks "not yet hydrated": dates and storage are browser-only, so load them after mount
  const [state, dispatch] = useReducer(reducer, null, () => emptyState(0));
  const ready = state.today !== 0;
  const [chosenTab, setTab] = useState<string | null>(null);
  const tab = chosenTab ?? (state.lots.length ? "pantry" : "scan");

  useEffect(() => {
    dispatch({ type: "hydrate", state: loadState() ?? emptyState(dayFromDate(new Date())) });
  }, []);

  useEffect(() => {
    if (ready) saveState(state);
  }, [state, ready]);

  const outlooks = useMemo(
    () =>
      trackedProductIds(state.lots, state.purchases).map((id) =>
        productOutlook(id, state.lots, state.household, state.purchases, state.today),
      ),
    [state],
  );

  if (!ready) {
    return <div className="flex flex-1 items-center justify-center text-body-sm text-mute">Loading pantry…</div>;
  }

  const hasData = state.lots.length > 0 || state.purchases.length > 0;
  const realToday = dayFromDate(new Date());
  const pantryValue = outlooks.reduce((s, o) => s + o.stockValue, 0);
  const low = outlooks.filter((o) => o.status === "low" || o.status === "out");
  const expiring = outlooks.filter((o) => o.nextExpiryDay !== null && o.nextExpiryDay - state.today <= 2);
  const wasted = state.waste.reduce((s, w) => s + w.value, 0);
  const atRisk = outlooks.reduce((s, o) => s + o.projectedWasteValue, 0);

  const loadDemo = () => {
    dispatch({ type: "loadDemo", today: realToday });
    setTab("pantry");
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* primary-nav: white, 64px, hairline rule; the red CTA stays visible at every width */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center gap-3 px-4 sm:px-6">
          <Wordmark />
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-1.5 rounded-full bg-surface-card px-4 py-2.5 text-sm font-semibold text-ink md:flex">
              <CalendarClock className="size-4" />
              {formatDay(state.today)}
              {state.today !== realToday && <span className="font-normal text-mute">+{state.today - realToday}d</span>}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={!hasData}
              onClick={() => dispatch({ type: "advance", days: 1 })}
            >
              <FastForward /> 1 day
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hidden rounded-full sm:inline-flex"
              disabled={!hasData}
              onClick={() => dispatch({ type: "advance", days: 7 })}
            >
              <FastForward /> 1 week
            </Button>
            <Select
              items={MEMBER_ITEMS}
              value={String(state.household.members)}
              onValueChange={(v) => dispatch({ type: "setMembers", members: Number(v) })}
            >
              <SelectTrigger size="sm" className="hidden w-36 rounded-full border-0 bg-surface-card lg:flex">
                <Users className="size-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MEMBER_ITEMS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              aria-label="Reset everything"
              title="Reset everything"
              onClick={() => {
                dispatch({ type: "reset", today: realToday });
                setTab("scan");
              }}
            >
              <RotateCcw />
            </Button>
            <Button variant="secondary" onClick={loadDemo}>
              Demo
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
        {!hasData && (
          <section className="grid gap-8 py-8 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-12">
            <div className="space-y-6">
              <h1 className="text-[36px] leading-[1.1] font-semibold tracking-[-1.2px] sm:text-display-lg md:text-[56px] xl:text-display-xl">
                Know what&apos;s in your cupboard before you shop
              </h1>
              <p className="max-w-lg text-body-md text-body">
                PantryIQ turns supermarket receipts into a live picture of what your household owns, predicts what
                you&apos;ll run out of, and works out the cheapest basket that wastes nothing.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" onClick={loadDemo}>
                  Load a demo household
                </Button>
                <Button size="lg" variant="secondary" onClick={() => setTab("scan")}>
                  Scan my own receipt
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {HOW_IT_WORKS.map((s) => (
                <div key={s.title} className="flex gap-4 rounded-lg bg-surface-card p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-canvas text-ink">
                    <s.icon className="size-4" />
                  </div>
                  <div>
                    <div className="text-body-md font-semibold text-ink">{s.title}</div>
                    <p className="text-body-sm text-mute">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {hasData && (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={Package}
              label="Pantry value"
              value={formatPence(pantryValue)}
              hint={`${outlooks.filter((o) => o.stock > 0).length} products in stock`}
            />
            <Stat
              icon={TriangleAlert}
              label="Running low or out"
              value={String(low.length)}
              hint={low.length ? low.slice(0, 3).map((o) => PRODUCTS_BY_ID[o.productId].name).join(", ") : "Nothing urgent"}
              attention={low.length > 0}
            />
            <Stat
              icon={CalendarClock}
              label="Use within 2 days"
              value={String(expiring.length)}
              hint={atRisk > 0 ? `${formatPence(atRisk)} forecast to expire in 14 days` : "No waste forecast"}
              attention={expiring.length > 0}
            />
            <Stat
              icon={PiggyBank}
              label="Wasted so far"
              value={formatPence(wasted)}
              hint={`${state.receiptsScanned} receipts scanned`}
            />
          </section>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="gap-6">
          <div className="-mx-4 overflow-x-auto overflow-y-hidden border-b border-hairline px-4 sm:mx-0 sm:px-0">
            <TabsList variant="line" className="h-12">
              <TabsTrigger value="scan">
                <ScanLine /> Scan
              </TabsTrigger>
              <TabsTrigger value="pantry" disabled={!hasData}>
                <Package /> Pantry
              </TabsTrigger>
              <TabsTrigger value="forecast" disabled={!hasData}>
                <LineChart /> Forecast
              </TabsTrigger>
              <TabsTrigger value="shop" disabled={!hasData}>
                <ShoppingCart /> Shopping list
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="scan">
            <ReceiptScanner
              onAdd={(store, lines) => {
                dispatch({ type: "addReceipt", store, lines });
                setTab("pantry");
              }}
            />
          </TabsContent>
          <TabsContent value="pantry">
            <PantryTable state={state} outlooks={outlooks} dispatch={dispatch} />
          </TabsContent>
          <TabsContent value="forecast">
            <ForecastView state={state} />
          </TabsContent>
          <TabsContent value="shop">
            <ShoppingOptimiser state={state} dispatch={dispatch} />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-section border-t border-hairline bg-canvas">
        <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 py-8 text-body-sm text-mute sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div className="space-y-3">
            <Wordmark />
            <p>Know what you own. Predict what you need. Buy only that.</p>
          </div>
          <div className="space-y-2">
            <div className="font-bold text-ink">How it works</div>
            <p>Receipt OCR + fuzzy product matching</p>
            <p>Consumption forecasting from your history</p>
            <p>Exact basket optimisation</p>
          </div>
          <div className="space-y-2">
            <div className="font-bold text-ink">Your data</div>
            <p>Stored only in this browser</p>
            <p>Receipt photos are sent to Claude for reading and not kept</p>
          </div>
          <div className="space-y-2">
            <div className="font-bold text-ink">Built for</div>
            <p>Lloyds — Solutions to the Cost of Living</p>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1280px] px-4 pb-8 text-xs text-mute sm:px-6">© 2026 PantryIQ</div>
      </footer>
    </div>
  );
}
