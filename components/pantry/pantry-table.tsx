"use client";

import { Check, Minus, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatPence, formatQty, PRODUCTS_BY_ID } from "@/lib/catalog";
import type { ProductOutlook, StockStatus } from "@/lib/forecast";
import type { Action } from "@/lib/store";
import type { PantryState } from "@/lib/types";
import { formatDay } from "@/lib/types";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<StockStatus, { label: string; className: string }> = {
  out: { label: "Out", className: "bg-error/10 text-error" },
  low: { label: "Running low", className: "bg-ink text-on-dark" },
  expiring: { label: "Use soon", className: "bg-accent-purple/10 text-accent-purple" },
  ok: { label: "Stocked", className: "bg-success-pale text-success-deep" },
};

function CoverBar({ days, horizon = 14 }: { days: number; horizon?: number }) {
  const pct = Math.min(100, (days / horizon) * 100);
  const color = days < 2 ? "bg-error" : days < 4 ? "bg-accent-purple" : "bg-charcoal";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary-bg">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 text-xs tabular-nums text-mute">
        {Number.isFinite(days) ? (days >= 60 ? "60+ d" : `${days.toFixed(1)} d`) : "—"}
      </span>
    </div>
  );
}

export function PantryTable({
  state,
  outlooks,
  dispatch,
}: {
  state: PantryState;
  outlooks: ProductOutlook[];
  dispatch: (a: Action) => void;
}) {
  const rows = [...outlooks].sort((a, b) => a.daysOfCover - b.daysOfCover);
  const today = state.today;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your virtual pantry</CardTitle>
        <CardDescription>
          Stock is drawn down automatically using each product&apos;s learned consumption rate. Items are
          used oldest-expiry first; anything past its date is logged as waste.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Usage / day</TableHead>
              <TableHead>Days of cover</TableHead>
              <TableHead>Next expiry</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((o) => {
              const p = PRODUCTS_BY_ID[o.productId];
              const mult = state.household.usageMultiplier[o.productId] ?? 1;
              const status = STATUS_META[o.status];
              return (
                <TableRow key={o.productId}>
                  <TableCell>
                    <div className="font-semibold text-ink">{p.name}</div>
                    <div className="text-xs text-mute">{p.category}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.stock > 0 ? `${formatQty(o.stock, p.unit)}${p.unit === "item" ? " items" : ""}` : "—"}
                    {o.stockValue > 0 && (
                      <div className="text-xs text-mute">{formatPence(o.stockValue)}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="We use less"
                        onClick={() =>
                          dispatch({ type: "setMultiplier", productId: o.productId, multiplier: Math.max(0.25, mult - 0.25) })
                        }
                      >
                        <Minus />
                      </Button>
                      <Tooltip>
                        <TooltipTrigger className="min-w-16 text-right tabular-nums">
                          {formatQty(o.rate.rate, p.unit)}
                          {o.rate.intervals > 0 && <span className="ml-1 text-success-deep">●</span>}
                        </TooltipTrigger>
                        <TooltipContent>
                          {o.rate.observed !== null
                            ? `Learned from ${o.rate.intervals} shopping interval${o.rate.intervals > 1 ? "s" : ""}: ${formatQty(o.rate.observed, p.unit)}/day observed, ${formatQty(o.rate.prior, p.unit)}/day typical`
                            : `Typical for ${state.household.members} people — will learn from your receipts`}
                          {mult !== 1 && ` · adjusted ×${mult}`}
                        </TooltipContent>
                      </Tooltip>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="We use more"
                        onClick={() =>
                          dispatch({ type: "setMultiplier", productId: o.productId, multiplier: Math.min(3, mult + 0.25) })
                        }
                      >
                        <Plus />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <CoverBar days={o.daysOfCover} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {o.nextExpiryDay !== null ? (
                      <span className={cn(o.nextExpiryDay - today <= 2 && "font-semibold text-accent-purple")}>
                        {formatDay(o.nextExpiryDay)}
                      </span>
                    ) : (
                      <span className="text-ash">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={status.className}>
                      {status.label}
                    </Badge>
                    {o.projectedWasteValue >= 10 && (
                      <div className="mt-1 text-xs font-medium text-accent-purple">
                        {formatPence(o.projectedWasteValue)} at risk
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {o.stock > 0 && (
                      <div className="flex justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Used it all"
                                onClick={() => dispatch({ type: "useUp", productId: o.productId })}
                              />
                            }
                          >
                            <Check />
                          </TooltipTrigger>
                          <TooltipContent>Used it all</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Threw it away"
                                onClick={() => dispatch({ type: "bin", productId: o.productId })}
                              />
                            }
                          >
                            <Trash2 />
                          </TooltipTrigger>
                          <TooltipContent>Threw it away (logs waste)</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
