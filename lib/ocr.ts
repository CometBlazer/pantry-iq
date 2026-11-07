// On-device receipt OCR (no API key). Runs Tesseract in a Web Worker in the browser;
// its WASM core and English model (~a few MB) are fetched from a CDN on first use and cached.
//
// Pipeline (same code the offline evaluation in scripts/ocr-eval.ts measures):
//   find paper → crop → deskew → adaptive threshold (lib/ocr-preprocess.ts)
//   → Tesseract on the whole receipt (uniform block) + a header pass for the big store name

import type { PSM } from "tesseract.js";
import {
  assembleOcrText,
  type Gray,
  HEADER_PSM,
  headerRegion,
  preprocessReceipt,
  RECEIPT_PSM,
  TITLE_PSM,
  titleBand,
} from "./ocr-preprocess";

export type OcrProgress = (status: string, progress: number) => void;

function toCanvas(g: Gray): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = g.width;
  canvas.height = g.height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i];
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function readPixels(file: File): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  // createImageBitmap honours EXIF orientation, so portrait phone photos arrive upright.
  const bitmap = await createImageBitmap(file);
  // Cap the working size: 12MP photos are slow to process and gain nothing for OCR.
  const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width: canvas.width, height: canvas.height };
}

export async function ocrReceipt(file: File, onProgress?: OcrProgress): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  let pass = 0;
  const worker = await createWorker("eng", undefined, {
    logger: (m) => onProgress?.(m.status, pass === 0 ? m.progress * 0.85 : 0.85 + m.progress * 0.15),
  });
  try {
    const px = await readPixels(file);
    const { image } = preprocessReceipt(px.data, px.width, px.height);

    await worker.setParameters({ tessedit_pageseg_mode: RECEIPT_PSM as PSM, preserve_interword_spaces: "1" });
    const main = await worker.recognize(toCanvas(image), {}, { text: true, blocks: true });

    pass = 1;
    await worker.setParameters({ tessedit_pageseg_mode: HEADER_PSM as PSM });
    const header = await worker.recognize(toCanvas(headerRegion(image)), {}, { text: true, blocks: true });

    // Title pass: the tallest text band near the top, read as a single line
    const band = titleBand(image);
    let titleText: string | undefined;
    if (band) {
      await worker.setParameters({ tessedit_pageseg_mode: TITLE_PSM as PSM });
      titleText = (await worker.recognize(toCanvas(band))).data.text;
    }

    return assembleOcrText(main.data, header.data, image.height, titleText);
  } finally {
    await worker.terminate();
  }
}
