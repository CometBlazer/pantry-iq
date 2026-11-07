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
  Sparkles,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPence, PRODUCTS_BY_ID } from "@/lib/catalog";
import { productOutlook, trackedProductIds } from "@/lib/forecast";
import { emptyState, loadState, reducer, saveState } from "@/lib/store";
import { dayFromDate, formatDay } from "@/lib/types";
import { ForecastView } from "./forecast-view";
import { PantryTable } from "./pantry-table";
import { ReceiptScanner } from "./receipt-scanner";
import { ShoppingOptimiser } from "./shopping-optimiser";

const MEMBER_ITEMS = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [String(n), `${n} ${n === 1 ? "person" : "people"}`]));

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  tone?: "warn";
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start gap-3">
        <div
          className={
            tone === "warn"
              ? "rounded-md bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400"
              : "rounded-md bg-primary/10 p-2 text-primary"
          }
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
          <div className="truncate text-xs text-muted-foreground">{hint}</div>
        </div>
      </CardContent>
    </Card>
  );
}

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
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading pantry…</div>;
  }

  const hasData = state.lots.length > 0 || state.purchases.length > 0;
  const realToday = dayFromDate(new Date());
  const pantryValue = outlooks.reduce((s, o) => s + o.stockValue, 0);
  const low = outlooks.filter((o) => o.status === "low" || o.status === "out");
  const expiring = outlooks.filter((o) => o.nextExpiryDay !== null && o.nextExpiryDay - state.today <= 2);
  const wasted = state.waste.reduce((s, w) => s + w.value, 0);
  const atRisk = outlooks.reduce((s, o) => s + o.projectedWasteValue, 0);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">PantryIQ</h1>
            <p className="text-xs text-muted-foreground">Know what you own. Predict what you need. Buy only that.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="h-8 gap-1.5 px-3 text-sm font-normal">
            <CalendarClock className="size-3.5" />
            {formatDay(state.today)}
            {state.today !== realToday && (
              <span className="text-muted-foreground">
                (+{state.today - realToday}d sim)
              </span>
            )}
          </Badge>
          <Button variant="outline" size="sm" disabled={!hasData} onClick={() => dispatch({ type: "advance", days: 1 })}>
            <FastForward /> 1 day
          </Button>
          <Button variant="outline" size="sm" disabled={!hasData} onClick={() => dispatch({ type: "advance", days: 7 })}>
            <FastForward /> 1 week
          </Button>
          <Select
            items={MEMBER_ITEMS}
            value={String(state.household.members)}
            onValueChange={(v) => dispatch({ type: "setMembers", members: Number(v) })}
          >
            <SelectTrigger size="sm" className="w-32">
              <Users className="size-3.5" />
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
            variant="ghost"
            size="sm"
            onClick={() => {
              dispatch({ type: "loadDemo", today: realToday });
              setTab("pantry");
            }}
          >
            <Sparkles /> Demo household
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reset"
            title="Reset everything"
            onClick={() => {
              dispatch({ type: "reset", today: realToday });
              setTab("scan");
            }}
          >
            <RotateCcw />
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Package} label="Pantry value" value={formatPence(pantryValue)} hint={`${outlooks.filter((o) => o.stock > 0).length} products in stock`} />
        <Stat
          icon={TriangleAlert}
          label="Running low / out"
          value={String(low.length)}
          hint={low.length ? low.slice(0, 3).map((o) => PRODUCTS_BY_ID[o.productId].name).join(", ") : "Nothing urgent"}
          tone={low.length ? "warn" : undefined}
        />
        <Stat
          icon={CalendarClock}
          label="Use within 2 days"
          value={String(expiring.length)}
          hint={atRisk > 0 ? `${formatPence(atRisk)} forecast to expire in 14 days` : "No waste forecast"}
          tone={expiring.length ? "warn" : undefined}
        />
        <Stat icon={PiggyBank} label="Wasted so far" value={formatPence(wasted)} hint={`${state.receiptsScanned} receipts scanned`} />
      </section>

      {!hasData && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Welcome to PantryIQ</CardTitle>
            <CardDescription>
              Scan a receipt below to start building your virtual pantry — or load a demo household with three weeks
              of shopping history to see forecasting and basket optimisation in action.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => {
                dispatch({ type: "loadDemo", today: realToday });
                setTab("pantry");
              }}
            >
              <Sparkles /> Load demo household
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList>
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
        <TabsContent value="scan" className="pt-2">
          <ReceiptScanner
            onAdd={(store, lines) => {
              dispatch({ type: "addReceipt", store, lines });
              setTab("pantry");
            }}
          />
        </TabsContent>
        <TabsContent value="pantry" className="pt-2">
          <PantryTable state={state} outlooks={outlooks} dispatch={dispatch} />
        </TabsContent>
        <TabsContent value="forecast" className="pt-2">
          <ForecastView state={state} />
        </TabsContent>
        <TabsContent value="shop" className="pt-2">
          <ShoppingOptimiser state={state} dispatch={dispatch} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
