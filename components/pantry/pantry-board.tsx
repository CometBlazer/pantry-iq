"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  CalendarDays,
  Check,
  CookingPot,
  Eye,
  Flame,
  GripVertical,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Star,
  Trash2,
  Unlink,
  UtensilsCrossed,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatPence, formatQty, PRODUCTS_BY_ID, type Product } from "@/lib/catalog";
import type { ProductOutlook, StockStatus } from "@/lib/forecast";
import { basisLabel, formatKcal, kcalDensity, kcalFor, type KcalSource } from "@/lib/nutrition";
import type { Action, MealTarget } from "@/lib/store";
import type { Lot, Meal, PantryState } from "@/lib/types";
import { dateFromDay, dayFromDate } from "@/lib/types";
import { cn } from "@/lib/utils";

type Status = StockStatus | "expired";

const STATUS_META: Record<Status, { label: string; className: string }> = {
  expired: { label: "Expired", className: "bg-error text-on-dark" },
  out: { label: "Out", className: "bg-error/10 text-error" },
  low: { label: "Running low", className: "bg-ink text-on-dark" },
  expiring: { label: "Use soon", className: "bg-accent-purple/10 text-accent-purple" },
  ok: { label: "Stocked", className: "bg-success-pale text-success-deep" },
};

type Mode = "view" | "edit";

interface Row {
  o: ProductOutlook;
  p: Product;
  /** Batches in stock, soonest expiry first */
  lots: Lot[];
  status: Status;
  /** Nothing usable in the kitchen: out of stock or every batch past its date */
  unavailable: boolean;
  /** kcal in the usable (unexpired) stock */
  kcal: number;
  density: { per: number; source: KcalSource };
}

type Entry =
  | { kind: "item"; row: Row; starred: boolean }
  | { kind: "meal"; meal: Meal; rows: Row[]; starred: boolean };

const sortKey = (r: Row) => r.o.nextExpiryDay ?? Number.POSITIVE_INFINITY;
const byExpiry = (a: Row, b: Row) => sortKey(a) - sortKey(b) || a.p.name.localeCompare(b.p.name);

function usePersistent<T extends string | boolean>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // private mode — keep it in memory
    }
  };
  return [value, set] as const;
}

// ── dates ───────────────────────────────────────────────────────────────────

/** Day numbers are UTC; the calendar works in local dates */
const localDate = (day: number) => {
  const d = dateFromDay(day);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

function shortDate(day: number, today: number): string {
  const d = dateFromDay(day);
  const sameYear = d.getUTCFullYear() === dateFromDay(today).getUTCFullYear();
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? { weekday: "short" } : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** "Today", "In 3 days" for the coming week, otherwise the date */
function expiryText(day: number, today: number): string {
  const d = day - today;
  if (d < 0) return `Expired ${shortDate(day, today)}`;
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d <= 7) return `In ${d} days`;
  return shortDate(day, today);
}

const expiryTone = (day: number, today: number) =>
  day < today ? "text-error" : day - today <= 2 ? "text-accent-purple" : "text-ink";

// ── small pieces ────────────────────────────────────────────────────────────

/** Input that commits on blur / Enter, so typing doesn't reshuffle the list */
function useDraft(value: string, onCommit: (v: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    value: draft ?? value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: () => {
      if (draft !== null && draft !== value) onCommit(draft);
      setDraft(null);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") e.currentTarget.blur();
      if (e.key === "Escape") {
        setDraft(null);
        e.currentTarget.blur();
      }
    },
  };
}

function KcalField({ row, dispatch }: { row: Row; dispatch: (a: Action) => void }) {
  const id = row.o.productId;
  const field = useDraft(String(row.density.per), (v) => {
    const n = Number(v);
    // Pure fat is ~900 kcal/100 g; anything above that (or a huge per-item value) is a typo
    const max = row.p.unit === "item" ? 5000 : 900;
    if (v.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= max)
      dispatch({ type: "setKcal", entries: { [id]: { per: Math.round(n), source: "manual" } } });
  });
  return (
    <InputGroup className="h-9 w-full rounded-lg border-hairline bg-canvas md:w-40">
      <InputGroupInput
        {...field}
        type="number"
        inputMode="numeric"
        min={0}
        aria-label={`Calories in ${row.p.name}, kcal ${basisLabel(row.p.unit)}`}
        className="h-full px-2.5 text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <InputGroupAddon align="inline-end" className="gap-1 pr-1">
        <InputGroupText className="text-xs whitespace-nowrap text-mute">kcal {basisLabel(row.p.unit)}</InputGroupText>
        {row.density.source === "manual" ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-6"
            aria-label="Reset to estimate"
            title="Reset to estimate"
            onClick={() => dispatch({ type: "setKcal", entries: { [id]: null } })}
          >
            <RotateCcw />
          </Button>
        ) : (
          <span className="size-6" />
        )}
      </InputGroupAddon>
    </InputGroup>
  );
}

function ExpiryPicker({
  lots,
  product,
  today,
  dispatch,
}: {
  lots: Lot[];
  product: Product;
  today: number;
  dispatch: (a: Action) => void;
}) {
  const [open, setOpen] = useState(false);
  const [batch, setBatch] = useState(0);
  const lot = lots[Math.min(batch, lots.length - 1)];
  const set = (day: number) => {
    dispatch({ type: "setExpiry", lotId: lot.id, day });
    if (lots.length === 1) setOpen(false);
  };
  const first = lots[0].expiresDay;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-lg border border-hairline bg-canvas px-2.5 text-left text-sm font-semibold transition-colors hover:border-ash focus-visible:outline-2 focus-visible:outline-focus-outer data-[popup-open]:border-ink md:w-44",
              expiryTone(first, today),
            )}
            aria-label={`Change expiry of ${product.name}`}
          />
        }
      >
        <CalendarDays className="size-4 shrink-0 text-mute" />
        <span className="truncate">{expiryText(first, today)}</span>
        {lots.length > 1 && <span className="ml-auto text-xs font-normal text-mute">+{lots.length - 1}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto gap-0 p-0">
        <div className="border-b border-hairline-soft px-3 py-2.5">
          <div className="text-sm font-semibold text-ink">{product.name}</div>
          <div className="text-xs text-mute">Best before</div>
        </div>
        {lots.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b border-hairline-soft p-2" role="group" aria-label="Batch">
            {lots.map((l, i) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={l === lot}
                onClick={() => setBatch(i)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  l === lot ? "bg-ink text-on-dark" : "bg-surface-card text-ink hover:bg-secondary-bg",
                )}
              >
                {formatQty(l.qty, product.unit)} · {shortDate(l.expiresDay, today)}
              </button>
            ))}
          </div>
        )}
        <Calendar
          mode="single"
          required
          selected={localDate(lot.expiresDay)}
          onSelect={(d) => set(dayFromDate(d))}
          defaultMonth={localDate(lot.expiresDay)}
          today={localDate(today)}
          weekStartsOn={1}
          className="p-3 [--cell-size:--spacing(9)]"
        />
        <div className="flex gap-1.5 border-t border-hairline-soft p-2">
          {(
            [
              ["Today", 0],
              ["+3 days", 3],
              ["+1 week", 7],
            ] as const
          ).map(([label, n]) => (
            <Button key={label} variant="secondary" size="xs" className="flex-1" onClick={() => set(today + n)}>
              {label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StarButton({
  starred,
  label,
  editable,
  onToggle,
}: {
  starred: boolean;
  label: string;
  editable: boolean;
  onToggle: () => void;
}) {
  const icon = <Star className={cn("size-4", starred ? "fill-primary text-primary" : "text-stone")} />;
  if (!editable) {
    return <span className="flex size-7 shrink-0 items-center justify-center">{starred && icon}</span>;
  }
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={starred ? `Unpin ${label}` : `Pin ${label} to the top`}
      title={starred ? "Unpin" : "Pin to top"}
      onClick={onToggle}
      className="flex size-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-card focus-visible:outline-2 focus-visible:outline-focus-outer [&:hover_svg]:text-primary"
    >
      {icon}
    </button>
  );
}

// ── rows ────────────────────────────────────────────────────────────────────

const COLS = {
  stock: "md:w-24 md:text-right",
  kcal: "md:w-40",
  expiry: "md:w-44",
  status: "hidden md:block md:w-28",
  actions: "md:w-[4.5rem]",
};

function ColumnHeader({ mode }: { mode: Mode }) {
  return (
    <div className="hidden items-center gap-4 px-[19px] pb-2 text-xs font-semibold text-mute md:flex">
      {mode === "edit" && <div className="w-7 shrink-0" />}
      <div className="w-7 shrink-0" />
      <div className="min-w-0 flex-1">Item</div>
      <div className={COLS.stock}>In stock</div>
      <div className={COLS.kcal}>Calories</div>
      <div className={COLS.expiry}>Expires</div>
      <div className={COLS.status}>Status</div>
      {mode === "edit" && <div className={COLS.actions} />}
    </div>
  );
}

function ItemRow({
  row,
  mode,
  state,
  dispatch,
  highlight,
  inMeal,
}: {
  row: Row;
  mode: Mode;
  state: PantryState;
  dispatch: (a: Action) => void;
  highlight: boolean;
  inMeal: boolean;
}) {
  const { o, p, lots, status } = row;
  const id = o.productId;
  const edit = mode === "edit";
  const {
    setNodeRef: setDragNode,
    setActivatorNodeRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({ id: `p:${id}`, disabled: !edit });
  const { setNodeRef: setDropNode } = useDroppable({ id: `p:${id}`, disabled: !edit });
  const meta = STATUS_META[status];
  const statusBadge = <Badge className={meta.className}>{meta.label}</Badge>;

  return (
    <div
      ref={(node) => {
        setDragNode(node);
        setDropNode(node);
      }}
      className={cn(
        "relative flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-3 py-2.5 transition-[background-color,box-shadow,opacity] md:flex-nowrap",
        row.unavailable && !edit && "opacity-55",
        isDragging && "opacity-30",
        highlight && "bg-surface-card ring-2 ring-focus-outer",
      )}
    >
      {highlight && (
        <span className="absolute -top-2.5 right-3 rounded-full bg-focus-outer px-2 py-0.5 text-xs font-semibold text-on-dark">
          Make a meal
        </span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {edit && (
          <button
            ref={setActivatorNodeRef}
            {...listeners}
            {...attributes}
            aria-label={`Drag ${p.name} into a meal`}
            className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-ash hover:bg-surface-card hover:text-ink focus-visible:outline-2 focus-visible:outline-focus-outer active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        )}
        {inMeal ? (
          <span className="size-7 shrink-0" />
        ) : (
          <StarButton
            starred={state.starred.includes(id)}
            label={p.name}
            editable={edit}
            onToggle={() => dispatch({ type: "toggleStar", productId: id })}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-ink">{p.name}</div>
          <div className="text-xs text-mute">{p.category}</div>
        </div>
        <div className="shrink-0 md:hidden">{statusBadge}</div>
      </div>
      <div className="basis-full md:hidden" />

      {/* In stock */}
      <div className={cn("text-sm leading-tight tabular-nums text-ink max-md:pl-11", COLS.stock)}>
        {o.stock > 0 ? `${formatQty(o.stock, p.unit)}${p.unit === "item" ? " items" : ""}` : "—"}
        {o.stockValue > 0 && <div className="text-xs text-mute">{formatPence(o.stockValue)}</div>}
      </div>

      {/* Calories */}
      <div className={cn("text-sm", COLS.kcal, edit && "max-md:basis-full max-md:pl-11")}>
        {edit ? (
          <KcalField row={row} dispatch={dispatch} />
        ) : (
          <div className="leading-tight">
            <div className="flex items-center gap-1 font-semibold text-ink tabular-nums">
              {row.kcal > 0 ? formatKcal(row.kcal) : <span className="font-normal text-ash">—</span>}
              {row.density.source === "gemini" && (
                <Sparkles className="size-3 text-ash" aria-label="Estimated by Gemini" />
              )}
              {row.density.source === "manual" && <Pencil className="size-3 text-ash" aria-label="Edited by you" />}
            </div>
            <div className="text-xs text-mute tabular-nums">
              {row.density.per} kcal {basisLabel(p.unit)}
            </div>
          </div>
        )}
      </div>

      {/* Expiry */}
      <div className={cn(COLS.expiry, edit && lots.length > 0 && "max-md:flex-1 max-md:pl-11")}>
        {edit && lots.length > 0 ? (
          <ExpiryPicker lots={lots} product={p} today={state.today} dispatch={dispatch} />
        ) : o.nextExpiryDay !== null ? (
          <Tooltip>
            <TooltipTrigger
              className={cn("text-left text-sm font-semibold", expiryTone(o.nextExpiryDay, state.today))}
            >
              {expiryText(o.nextExpiryDay, state.today)}
              {lots.length > 1 && <span className="ml-1.5 text-xs font-normal text-mute">+{lots.length - 1}</span>}
            </TooltipTrigger>
            <TooltipContent>
              {lots.map((l) => `${formatQty(l.qty, p.unit)} until ${shortDate(l.expiresDay, state.today)}`).join(" · ")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-sm text-ash">—</span>
        )}
      </div>

      <div className={COLS.status}>
        {statusBadge}
        {o.projectedWasteValue >= 10 && (
          <div className="mt-1 text-xs font-medium text-accent-purple">{formatPence(o.projectedWasteValue)} at risk</div>
        )}
      </div>

      {edit && (
        <div className={cn("ml-auto flex justify-end gap-0.5", COLS.actions)}>
          {o.stock > 0 && (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Used all the ${p.name}`}
                      onClick={() => dispatch({ type: "useUp", productId: id })}
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
                      aria-label={`Threw away the ${p.name}`}
                      onClick={() => dispatch({ type: "bin", productId: id })}
                    />
                  }
                >
                  <Trash2 />
                </TooltipTrigger>
                <TooltipContent>Threw it away (logs waste)</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MealName({ meal, dispatch }: { meal: Meal; dispatch: (a: Action) => void }) {
  const field = useDraft(meal.name, (v) => v.trim() && dispatch({ type: "renameMeal", mealId: meal.id, name: v.trim() }));
  return (
    <Input
      {...field}
      aria-label="Meal name"
      className="-ml-2 h-9 max-w-xs rounded-lg border-transparent bg-transparent px-2 py-1 text-body-md font-semibold hover:border-hairline focus-visible:bg-canvas"
    />
  );
}

function MealBlock({
  meal,
  rows,
  hiddenCount,
  mode,
  highlight,
  children,
  state,
  dispatch,
}: {
  meal: Meal;
  rows: Row[];
  hiddenCount: number;
  mode: Mode;
  highlight: boolean;
  children: React.ReactNode;
  state: PantryState;
  dispatch: (a: Action) => void;
}) {
  const edit = mode === "edit";
  const today = state.today;
  const { setNodeRef } = useDroppable({ id: `m:${meal.id}`, disabled: !edit });
  const kcal = rows.reduce((s, r) => s + r.kcal, 0);
  const useBy = rows.reduce<number | null>(
    (m, r) => (r.o.nextExpiryDay === null ? m : m === null ? r.o.nextExpiryDay : Math.min(m, r.o.nextExpiryDay)),
    null,
  );
  const count = meal.productIds.length;
  const hasStock = meal.productIds.some((id) => state.lots.some((l) => l.productId === id && l.qty > 0));

  const eat = () => {
    const before = state;
    dispatch({ type: "eatMeal", mealId: meal.id });
    toast.success(`Marked “${meal.name}” as eaten`, {
      description: "Its ingredients are now used up.",
      action: { label: "Undo", onClick: () => dispatch({ type: "hydrate", state: before }) },
    });
  };

  return (
    <section
      ref={setNodeRef}
      aria-label={`Meal: ${meal.name}`}
      className={cn(
        "relative rounded-xl border border-hairline bg-surface-soft p-1.5 transition-[box-shadow,background-color]",
        highlight && "bg-surface-card ring-2 ring-focus-outer",
      )}
    >
      {highlight && (
        <span className="absolute -top-2.5 right-3 z-10 rounded-full bg-focus-outer px-2 py-0.5 text-xs font-semibold text-on-dark">
          Add to meal
        </span>
      )}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pt-1.5 pb-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {edit && <span className="w-7 shrink-0" />}
          <StarButton
            starred={!!meal.starred}
            label={meal.name}
            editable={edit}
            onToggle={() => dispatch({ type: "toggleMealStar", mealId: meal.id })}
          />
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-on-dark">
            <UtensilsCrossed className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            {edit ? (
              <MealName meal={meal} dispatch={dispatch} />
            ) : (
              <h3 className="truncate text-body-md font-semibold text-ink">{meal.name}</h3>
            )}
            <div className="text-xs text-mute">
              {count} item{count === 1 ? "" : "s"}
              {hiddenCount > 0 && ` (${hiddenCount} hidden)`}
              {kcal > 0 && ` · ${formatKcal(kcal)}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 max-md:pl-11">
          {useBy !== null && (
            <div
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap",
                useBy < today
                  ? "bg-error/10 text-error"
                  : useBy - today <= 2
                    ? "bg-accent-purple/10 text-accent-purple"
                    : "bg-surface-card text-ink",
              )}
            >
              Cook by {shortDate(useBy, today)}
            </div>
          )}
          {edit && (
            <>
              <Button variant="secondary" size="sm" disabled={!hasStock} onClick={eat}>
                <CookingPot /> Ate it
              </Button>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Ungroup ${meal.name}`}
                      onClick={() => dispatch({ type: "ungroupMeal", mealId: meal.id })}
                    />
                  }
                >
                  <Unlink />
                </TooltipTrigger>
                <TooltipContent>Ungroup</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </header>
      <div className="divide-y divide-hairline-soft rounded-lg bg-canvas">{children}</div>
    </section>
  );
}

function DropZone({ id, icon: Icon, label }: { id: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 text-sm font-semibold transition-colors",
        isOver ? "border-ink bg-ink text-on-dark" : "border-stone bg-canvas text-ink",
      )}
    >
      <Icon className="size-4" />
      {label}
    </div>
  );
}

// ── board ───────────────────────────────────────────────────────────────────

const PRIORITY = (id: string) => (id.startsWith("zone:") ? 0 : id.startsWith("p:") ? 1 : 2);

// Pointer position decides the target; the most specific droppable wins (zone > item > meal)
const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length) return [...hits].sort((a, b) => PRIORITY(String(a.id)) - PRIORITY(String(b.id)));
  return rectIntersection(args);
};

function toTarget(overId: string | null, activeProduct: string): MealTarget | null {
  if (!overId) return null;
  if (overId === "zone:new") return { kind: "new" };
  if (overId === "zone:none") return { kind: "none" };
  if (overId.startsWith("m:")) return { kind: "meal", mealId: overId.slice(2) };
  const productId = overId.slice(2);
  return productId === activeProduct ? null : { kind: "product", productId };
}

export function PantryBoard({
  state,
  outlooks,
  dispatch,
}: {
  state: PantryState;
  outlooks: ProductOutlook[];
  dispatch: (a: Action) => void;
}) {
  const [mode, setMode] = usePersistent<Mode>("pantryiq-pantry-mode", "view");
  const [hideUnavailable, setHide] = usePersistent<boolean>("pantryiq-hide-unavailable", false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const today = state.today;

  const rows = useMemo(() => {
    const map = new Map<string, Row>();
    for (const o of outlooks) {
      const lots = state.lots
        .filter((l) => l.productId === o.productId && l.qty > 0)
        .sort((a, b) => a.expiresDay - b.expiresDay);
      const fresh = lots.filter((l) => l.expiresDay >= today);
      map.set(o.productId, {
        o,
        p: PRODUCTS_BY_ID[o.productId],
        lots,
        status: lots.length > fresh.length ? "expired" : o.status,
        unavailable: fresh.length === 0,
        kcal: kcalFor(o.productId, fresh.reduce((s, l) => s + l.qty, 0), state.kcal),
        density: kcalDensity(o.productId, state.kcal),
      });
    }
    return map;
  }, [outlooks, state.lots, state.kcal, today]);

  const mealOf = useMemo(() => {
    const m = new Map<string, Meal>();
    for (const meal of state.meals) for (const id of meal.productIds) m.set(id, meal);
    return m;
  }, [state.meals]);

  // Starred first, then by expiry (soonest first). A meal sorts by its soonest-expiring member and keeps
  // its members together.
  const entries = useMemo(() => {
    const visible = (r: Row) => !(hideUnavailable && r.unavailable);
    const out: Entry[] = [];
    for (const meal of state.meals) {
      const shown = meal.productIds
        .map((id) => rows.get(id))
        .filter((r): r is Row => !!r && visible(r))
        .sort(byExpiry);
      if (shown.length) out.push({ kind: "meal", meal, rows: shown, starred: !!meal.starred });
    }
    for (const r of rows.values()) {
      if (!mealOf.has(r.o.productId) && visible(r))
        out.push({ kind: "item", row: r, starred: state.starred.includes(r.o.productId) });
    }
    const key = (e: Entry) => (e.kind === "item" ? sortKey(e.row) : sortKey(e.rows[0]));
    const name = (e: Entry) => (e.kind === "item" ? e.row.p.name : e.meal.name);
    return out.sort(
      (a, b) => Number(b.starred) - Number(a.starred) || key(a) - key(b) || name(a).localeCompare(name(b)),
    );
  }, [rows, state.meals, state.starred, mealOf, hideUnavailable]);

  const hiddenCount = [...rows.values()].filter((r) => r.unavailable).length;
  const starredCount = entries.filter((e) => e.starred).length;

  // ── calorie tracker ──
  const kitchenKcal = [...rows.values()].reduce((s, r) => s + r.kcal, 0);
  const dailyKcal =
    [...rows.values()].reduce((s, r) => s + kcalFor(r.o.productId, r.o.rate.rate, state.kcal), 0) /
    Math.max(1, state.household.members);

  const [kcalStatus, setKcalStatus] = useState<"idle" | "loading" | "unavailable" | "error">("idle");
  const attempted = useRef(new Set<string>());
  const estimate = async (ids: string[]) => {
    ids.forEach((id) => attempted.current.add(id));
    if (!ids.length) return;
    setKcalStatus("loading");
    try {
      const res = await fetch("/api/calories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: ids.map((id) => ({ id, name: PRODUCTS_BY_ID[id].name, unit: PRODUCTS_BY_ID[id].unit })),
        }),
      });
      if (res.status === 503) return setKcalStatus("unavailable");
      if (!res.ok) return setKcalStatus("error");
      const { estimates } = (await res.json()) as { estimates: { id: string; kcal: number }[] };
      dispatch({
        type: "setKcal",
        entries: Object.fromEntries(estimates.map((e) => [e.id, { per: e.kcal, source: "gemini" as const }])),
      });
      setKcalStatus("idle");
    } catch {
      setKcalStatus("error");
    }
  };
  const productIds = outlooks.map((o) => o.productId).join(",");
  const estimateMissing = useEffectEvent(() => {
    const missing = productIds.split(",").filter((id) => id && !state.kcal[id] && !attempted.current.has(id));
    if (missing.length) void estimate(missing);
  });
  useEffect(() => {
    // Ask Gemini once for anything we have no estimate for yet
    estimateMissing();
  }, [productIds]);

  // ── drag and drop ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const activeProduct = activeId?.slice(2) ?? null;
  const activeMeal = activeProduct ? mealOf.get(activeProduct) : undefined;
  const target = activeProduct ? toTarget(overId, activeProduct) : null;
  // Dropping on an item that already belongs to a meal adds to that meal
  const targetMealId =
    target?.kind === "meal" ? target.mealId : target?.kind === "product" ? mealOf.get(target.productId)?.id : undefined;
  const highlightMeal = targetMealId && targetMealId !== activeMeal?.id ? targetMealId : null;
  const highlightProduct = target?.kind === "product" && !mealOf.has(target.productId) ? target.productId : null;

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragOver = (e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null);
  const onDragEnd = (e: DragEndEvent) => {
    const t = toTarget(e.over ? String(e.over.id) : null, String(e.active.id).slice(2));
    if (t) dispatch({ type: "moveToMeal", productId: String(e.active.id).slice(2), target: t });
    setActiveId(null);
    setOverId(null);
  };
  const onDragCancel = () => {
    setActiveId(null);
    setOverId(null);
  };

  const renderRow = (r: Row, inMeal: boolean) => (
    <ItemRow
      key={r.o.productId}
      row={r}
      mode={mode}
      state={state}
      dispatch={dispatch}
      highlight={highlightProduct === r.o.productId}
      inMeal={inMeal}
    />
  );

  const sectionLabel = (text: string) => (
    <div className="px-[19px] pt-2 text-xs font-semibold tracking-wide text-mute uppercase">{text}</div>
  );

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Your virtual pantry</CardTitle>
            <CardDescription>
              Pinned items first, then soonest expiry. Meals stay together and sort by their soonest-expiring item.
            </CardDescription>
          </div>
          <div className="inline-flex rounded-full bg-surface-card p-1" role="group" aria-label="Pantry mode">
            {(
              [
                ["view", Eye, "View"],
                ["edit", Pencil, "Edit"],
              ] as const
            ).map(([m, Icon, label]) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-focus-outer",
                  mode === m ? "bg-ink text-on-dark" : "text-ink hover:bg-secondary-bg",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3 rounded-lg bg-surface-card px-4 py-2.5">
            <Flame className="size-4 text-primary" />
            <div className="leading-tight">
              <div className="text-sm font-semibold text-ink tabular-nums">{formatKcal(kitchenKcal)} in the kitchen</div>
              <div className="text-xs text-mute tabular-nums">
                ≈ {formatKcal(dailyKcal)} per person a day at your usual pace
              </div>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-ink">
            <Switch checked={hideUnavailable} onCheckedChange={(v) => setHide(v)} />
            Hide expired &amp; out of stock
            {hiddenCount > 0 && <span className="font-normal text-mute">({hiddenCount})</span>}
          </label>
          <div className="flex items-center gap-2 text-xs text-mute">
            {kcalStatus === "loading" ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin" /> Estimating calories with Gemini…
              </>
            ) : kcalStatus === "unavailable" ? (
              "Calories are typical values (Gemini isn't configured)"
            ) : kcalStatus === "error" ? (
              "Couldn't reach Gemini — showing typical values"
            ) : (
              <>
                <Sparkles className="size-3.5" /> Calories estimated by Gemini
              </>
            )}
            {mode === "edit" && kcalStatus !== "loading" && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  estimate(outlooks.map((o) => o.productId).filter((id) => state.kcal[id]?.source !== "manual"))
                }
              >
                <RotateCcw /> Re-estimate
              </Button>
            )}
          </div>
        </div>
        {mode === "edit" && (
          <p className="text-body-sm text-mute">
            Drag <GripVertical className="inline size-3.5 align-[-2px]" /> onto another item to make a meal, or onto a
            meal to add it. Tap <Star className="inline size-3.5 align-[-2px]" /> to pin to the top.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <ColumnHeader mode={mode} />
        <DndContext
          sensors={sensors}
          collisionDetection={collide}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div className="space-y-2">
            {entries.map((e, i) => (
              <div key={e.kind === "item" ? e.row.o.productId : e.meal.id} className="space-y-2">
                {starredCount > 0 && i === 0 && sectionLabel("Pinned")}
                {starredCount > 0 && i === starredCount && sectionLabel("Everything else")}
                {e.kind === "item" ? (
                  <div className="border-b border-hairline-soft px-[7px]">{renderRow(e.row, false)}</div>
                ) : (
                  <MealBlock
                    meal={e.meal}
                    rows={e.rows}
                    hiddenCount={e.meal.productIds.length - e.rows.length}
                    mode={mode}
                    highlight={highlightMeal === e.meal.id}
                    state={state}
                    dispatch={dispatch}
                  >
                    {e.rows.map((r) => renderRow(r, true))}
                  </MealBlock>
                )}
              </div>
            ))}
            {entries.length === 0 && (
              <div className="rounded-lg bg-surface-card px-4 py-10 text-center text-body-sm text-mute">
                Nothing usable in the kitchen right now. Turn off “Hide expired &amp; out of stock” to see everything.
              </div>
            )}
          </div>

          {activeProduct && (
            <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-lg gap-2 rounded-2xl bg-canvas/95 p-2 shadow-[0_8px_30px_rgb(0_0_0/0.18)] backdrop-blur">
              <DropZone id="zone:new" icon={Plus} label="New meal" />
              {activeMeal && <DropZone id="zone:none" icon={Unlink} label="Remove from meal" />}
            </div>
          )}

          <DragOverlay dropAnimation={null}>
            {activeProduct && (
              <div className="inline-flex cursor-grabbing items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-on-dark shadow-[0_8px_30px_rgb(0_0_0/0.25)]">
                <GripVertical className="size-4" />
                {PRODUCTS_BY_ID[activeProduct].name}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </CardContent>
    </Card>
  );
}
