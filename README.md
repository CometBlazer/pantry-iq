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

**No API key needed.** Receipt photos are read on the device with
[tesseract.js](https://github.com/naptha/tesseract.js) (free OCR running in the browser; its model is
downloaded from a CDN on first use), then parsed by the built-in rule-based parser. Garbled prices are
repaired by checking each reading against the product's known price.

Optionally, add an Anthropic key to `.env.local` for more accurate photo reading with Claude vision:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

## How it works

| Spec component | MVP implementation |
| --- | --- |
| Receipt extraction | On-device OCR (`lib/ocr.ts`, tesseract.js) + rule-based parser with OCR price repair (`lib/receipt.ts`); optional Claude vision (`app/api/receipt/route.ts`) when a key is set |
| Product identification | `lib/matching.ts` — abbreviation expansion, character-trigram Dice + token overlap against the food database (`lib/catalog.ts`), pack-size parsing |
| Inventory management | `lib/store.ts` — lots with purchase/expiry dates, FIFO-by-expiry consumption, waste log. Persisted to `localStorage` (actions map 1:1 onto PostgreSQL writes for production) |
| Consumption forecasting | `lib/forecast.ts` — per-product rate blends a per-person prior with the rate observed between shops; daily stock simulation predicts run-outs and expiry waste |
| Purchasing optimisation | `lib/optimizer.ts` — integer pack choices scored by simulation (cost + λ·waste + shortfall penalty − carry-over), solved exactly as a multiple-choice knapsack under an optional budget; compared against habitual re-buy, bulk-buy and small-packs strategies |

UI is Next.js 16 (App Router) + shadcn/ui (Base UI, `base-nova` style) + Recharts.
