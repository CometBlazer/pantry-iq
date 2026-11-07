import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CATALOG } from "@/lib/catalog";
import { parseReceiptText, toParsedReceipt, type RawReceipt } from "@/lib/receipt";
import type { ParsedReceipt } from "@/lib/types";

//
const ReceiptSchema = z.object({
  store: z.string(),
  currency: z.enum(["GBP", "EUR", "USD"]),
  kind: z.enum(["grocery", "dining"]),
  date: z.string().nullable(),
  total_pence: z.number().int().nullable(),
  items: z.array(
    z.object({
      receipt_text: z.string(),
      product_name: z.string(),
      count: z.number().int(),
      line_total_pence: z.number().int().nullable(),
    }),
  ),
});

const SYSTEM = `You extract line items from shop and restaurant receipts (any language).
Set currency from the symbols on the receipt, and kind to "dining" for restaurant, café or takeaway bills.
For each purchased product return:
- receipt_text: the line as printed, keeping any pack size text (e.g. "SEMI SKMD MILK 4PT").
- product_name: a plain-English product name with the pack size, e.g. "Semi-skimmed milk 4 pints". Prefer the closest name from the reference list when one fits.
- count: number of units bought (from "3 x" or "@" lines; default 1).
- line_total_pence: the amount paid for the line in minor units (pence/cents), after any multibuy or loyalty discount printed directly beneath it.
Skip totals, payment, VAT, loyalty points and bag charges. Dates use YYYY-MM-DD; use null when unreadable.

Reference product names: ${CATALOG.map((p) => p.name).join("; ")}.`;

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

async function extractWithClaude(
  input: { image?: { data: string; mediaType: ImageMediaType }; text?: string },
): Promise<RawReceipt> {
  const client = new Anthropic();
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: input.image.mediaType, data: input.image.data },
    });
    content.push({ type: "text", text: "Extract the line items from this receipt." });
  } else {
    content.push({ type: "text", text: `Extract the line items from this receipt:\n\n${input.text}` });
  }

  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(ReceiptSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") throw new Error("The model declined to read this receipt.");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Could not read the receipt — try a clearer photo.");

  return {
    store: parsed.store,
    currency: parsed.currency,
    kind: parsed.kind,
    date: parsed.date,
    total: parsed.total_pence,
    items: parsed.items.map((i) => ({
      // Combine both renderings so fuzzy matching sees the abbreviation and the expansion
      name: `${i.product_name} ${i.receipt_text}`,
      count: Math.max(1, i.count),
      linePrice: i.line_total_pence,
    })),
  };
}

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function POST(request: Request) {
  let body: { text?: string; image?: { data: string; mediaType: string } };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    let raw: RawReceipt;
    let engine: ParsedReceipt["engine"];
    if (body.image) {
      if (!MEDIA_TYPES.includes(body.image.mediaType)) {
        return Response.json({ error: "Upload a JPEG, PNG, GIF or WebP image." }, { status: 400 });
      }
      raw = await extractWithClaude({
        image: { data: body.image.data, mediaType: body.image.mediaType as ImageMediaType },
      });
      engine = "claude";
    } else if (body.text?.trim()) {
      // Text receipts: use Claude when a key is configured, otherwise the offline rule parser
      if (process.env.ANTHROPIC_API_KEY) {
        raw = await extractWithClaude({ text: body.text });
        engine = "claude";
      } else {
        raw = parseReceiptText(body.text);
        engine = "rules";
      }
    } else {
      return Response.json({ error: "Provide a receipt image or text." }, { status: 400 });
    }

    const result: ParsedReceipt = toParsedReceipt(raw, engine);
    return Response.json(result);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json(
        { error: "Photo scanning needs an Anthropic API key. Set ANTHROPIC_API_KEY in .env.local, or paste the receipt text instead." },
        { status: 503 },
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Rate limited by the AI service — try again shortly." }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: `AI service error: ${err.message}` }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    const missingKey = /api key|apiKey|authentication/i.test(message);
    return Response.json(
      {
        error: missingKey
          ? "Photo scanning needs an Anthropic API key. Set ANTHROPIC_API_KEY in .env.local, or paste the receipt text instead."
          : message,
      },
      { status: missingKey ? 503 : 500 },
    );
  }
}
