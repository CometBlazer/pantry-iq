import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

// Calorie densities from Gemini on Vertex AI. Without credentials this returns 503 and the
// client keeps the food database's typical values.

const Body = z.object({
  items: z
    .array(
      z.object({
        id: z.string().max(64),
        name: z.string().max(120),
        unit: z.enum(["g", "ml", "item"]),
      }),
    )
    .min(1)
    .max(100),
});

const Estimates = z.object({
  items: z.array(z.object({ id: z.string(), kcal: z.number().nonnegative() })),
});

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kcal: { type: "number", description: "Energy in kcal for the stated basis" },
        },
        required: ["id", "kcal"],
      },
    },
  },
  required: ["items"],
};

const BASIS = { g: "per 100 g", ml: "per 100 ml", item: "per single item (typical UK supermarket size)" } as const;

let client: GoogleGenAI | null = null;

function gemini(): GoogleGenAI | null {
  const { GOOGLE_VERTEX_CREDENTIALS_B64: b64, GOOGLE_VERTEX_PROJECT: project, GOOGLE_VERTEX_LOCATION } =
    process.env;
  if (!b64 || !project) return null;
  client ??= new GoogleGenAI({
    vertexai: true,
    project,
    location: GOOGLE_VERTEX_LOCATION || "global",
    googleAuthOptions: { credentials: JSON.parse(Buffer.from(b64, "base64").toString("utf8")) },
  });
  return client;
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Expected { items: [{ id, name, unit }] }" }, { status: 400 });

  const ai = gemini();
  if (!ai) {
    return Response.json(
      { error: "Calorie estimates need Vertex AI credentials (GOOGLE_VERTEX_CREDENTIALS_B64, GOOGLE_VERTEX_PROJECT)." },
      { status: 503 },
    );
  }

  const list = parsed.data.items.map((i) => `- id "${i.id}": ${i.name}, kcal ${BASIS[i.unit]}`).join("\n");
  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
      contents: `Estimate the energy content of these grocery products as sold (uncooked, unprepared), using typical UK nutrition labels. Non-food products are 0.\n\n${list}`,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: SCHEMA,
        temperature: 0,
      },
    });
    const out = Estimates.parse(JSON.parse(response.text ?? ""));
    const wanted = new Set(parsed.data.items.map((i) => i.id));
    return Response.json({
      estimates: out.items
        .filter((i) => wanted.has(i.id))
        .map((i) => ({ id: i.id, kcal: Math.round(i.kcal) })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Calorie estimate failed: ${message.slice(0, 200)}` }, { status: 502 });
  }
}
