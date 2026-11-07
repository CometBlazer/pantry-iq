# PantryIQ

Intelligent household inventory & cost optimisation — Lloyds "Solutions to the Cost of Living" challenge.

Scan a supermarket receipt, watch the virtual pantry fill up, fast-forward time to see what runs out or goes off,
then get the cheapest shopping basket that covers what the household will actually need.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and click **Load demo household** (three weeks of receipt history), or scan one of the
sample receipts on the **Scan** tab.

Photo scanning uses Claude vision. Add a key to `.env.local`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Without a key, pasted receipt text is read by the built-in rule-based parser, so the demo still works offline.

## How it works

| Spec component | MVP implementation |
| --- | --- |
| Receipt extraction | `app/api/receipt/route.ts` — Claude (`claude-opus-5-5`) vision + structured output for photos; regex parser (`lib/receipt.ts`) for text without a key |
| Product identification | `lib/matching.ts` — abbreviation expansion, character-trigram Dice + token overlap against the food database (`lib/catalog.ts`), pack-size parsing |
| Inventory management | `lib/store.ts` — lots with purchase/expiry dates, FIFO-by-expiry consumption, waste log. Persisted to `localStorage` (actions map 1:1 onto PostgreSQL writes for production) |
| Consumption forecasting | `lib/forecast.ts` — per-product rate blends a per-person prior with the rate observed between shops; daily stock simulation predicts run-outs and expiry waste |
| Purchasing optimisation | `lib/optimizer.ts` — integer pack choices scored by simulation (cost + λ·waste + shortfall penalty − carry-over), solved exactly as a multiple-choice knapsack under an optional budget; compared against habitual re-buy, bulk-buy and small-packs strategies |

UI is Next.js 16 (App Router) + shadcn/ui (Base UI, `base-nova` style) + Recharts.
