// Offline evaluation of the on-device receipt pipeline (preprocess → Tesseract → parse).
//
//   python scripts/dump_rgba.py path/to/receipt.jpg /tmp/r.rgba   # prints "W H"
//   npx tsx scripts/ocr-eval.ts /tmp/r.rgba W H [outDir]
//
// Writes the preprocessed image as PGM (for inspection) and prints OCR text, parsed lines and a score
// against the expected contents of the sample receipt.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWorker, type PSM } from "tesseract.js";
import {
  assembleOcrText,
  HEADER_PSM,
  headerRegion,
  linesFromBlocks,
  preprocessReceipt,
  RECEIPT_PSM,
  TITLE_PSM,
  titleBand,
  type Gray,
  type OcrLine,
} from "../lib/ocr-preprocess";
import { parseReceiptText, resolveItems } from "../lib/receipt";

const EXPECTED = {
  store: "TKO TACOS",
  date: "2026-10-31",
  total: 1275,
  items: [
    { name: "LLEVAR", count: 1, price: 100 },
    { name: "TACO DE ALAMBRE DE", count: 2, price: 390 },
    { name: "TACO DE ARRACHERA", count: 1, price: 195 },
    { name: "TACO DE COCHINADA", count: 1, price: 195 },
    { name: "TACO DE SUADERO", count: 1, price: 100 },
    { name: "TACO DE CARNITAS DE", count: 1, price: 195 },
    { name: "TACO AL PASTOR", count: 1, price: 100 },
  ],
};

function toPgm(g: Gray): Buffer {
  const header = Buffer.from(`P5\n${g.width} ${g.height}\n255\n`, "ascii");
  return Buffer.concat([header, Buffer.from(g.data)]);
}

function sim(a: string, b: string): number {
  const A = a.toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean);
  const B = b.toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean);
  if (!A.length || !B.length) return 0;
  return B.filter((t) => A.includes(t)).length / Math.max(A.length, B.length);
}

async function main() {
  const [file, w, h, outDir = "."] = process.argv.slice(2);
  const rgba = new Uint8Array(readFileSync(file));
  const width = Number(w);
  const height = Number(h);
  const opts = JSON.parse(process.env.PRE_OPTS ?? "{}");

  const t0 = Date.now();
  const { image, box, skew } = preprocessReceipt(rgba, width, height, opts);
  const pgm = toPgm(image);
  writeFileSync(join(outDir, "pre.pgm"), pgm);
  console.log(`preprocess ${Date.now() - t0}ms  box=${JSON.stringify(box)} skew=${skew}° out=${image.width}x${image.height}`);

  const worker = await createWorker("eng");
  await worker.setParameters({
    tessedit_pageseg_mode: ((process.env.PSM ?? RECEIPT_PSM) as PSM),
    preserve_interword_spaces: "1",
  });
  const { data } = await worker.recognize(pgm, {}, { text: true, blocks: true });
  // Header pass for the store name (large lettering)
  await worker.setParameters({ tessedit_pageseg_mode: HEADER_PSM as PSM });
  const header = await worker.recognize(toPgm(headerRegion(image)), {}, { text: true, blocks: true });
  // Title pass: the tallest text band, read as a single line
  const band = titleBand(image);
  let titleText: string | undefined;
  if (band) {
    await worker.setParameters({ tessedit_pageseg_mode: TITLE_PSM as PSM });
    titleText = (await worker.recognize(toPgm(band))).data.text;
    if (process.env.SHOW_LINES) console.log(`title band ${band.width}x${band.height}: "${titleText.trim()}"`);
  }
  await worker.terminate();
  const text = assembleOcrText(data, header.data, image.height, titleText);
  if (process.env.SHOW_LINES) {
    const fmt = (l: OcrLine) => `  h=${l.height.toFixed(0).padStart(3)} top=${l.top.toFixed(2)} conf=${l.confidence.toFixed(0).padStart(3)} ${l.text}`;
    console.log("main lines:\n" + linesFromBlocks(data.blocks, image.height, 1).filter((l) => l.top < 0.3).map(fmt).join("\n"));
    console.log("header lines:\n" + linesFromBlocks(header.data.blocks, image.height, 2).map(fmt).join("\n"));
  }
  if (process.env.SHOW_HEADER) console.log("----- HEADER -----\n" + header.data.text);
  console.log("----- OCR -----\n" + text + "---------------");

  const raw = parseReceiptText(text, { ocr: true });
  const lines = resolveItems(raw.items);
  for (const l of lines) console.log(`  ${String(l.count).padStart(2)} × ${l.raw.padEnd(30)} ${String(l.linePrice).padStart(5)}  → ${l.productId ?? "-"}`);

  let found = 0;
  for (const e of EXPECTED.items) {
    const hit = raw.items.find((i) => sim(i.name, e.name) >= 0.6 && i.linePrice === e.price && i.count === e.count);
    if (hit) found++;
    else console.log(`  MISSING ${e.count} × ${e.name} ${e.price}`);
  }
  const extra = raw.items.filter((i) => !EXPECTED.items.some((e) => sim(i.name, e.name) >= 0.6)).length;
  const score = {
    store: raw.store.toUpperCase().includes(EXPECTED.store),
    date: raw.date === EXPECTED.date,
    total: raw.total === EXPECTED.total,
    items: `${found}/${EXPECTED.items.length}`,
    extraLines: extra,
  };
  console.log("SCORE", JSON.stringify(score), `store="${raw.store}" date=${raw.date} total=${raw.total} currency=${raw.currency} kind=${raw.kind}`);
}

main();
