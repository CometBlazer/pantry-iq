// Receipt photo clean-up for OCR. Pure functions over grayscale pixel buffers, so the exact same
// pipeline runs in the browser (via canvas ImageData) and in Node tests.
//
//   photo → grayscale → find the paper → crop → deskew → adaptive threshold → OCR
//
// Phone photos of receipts have busy backgrounds, uneven lighting and a slight tilt; Tesseract
// does far better on a straight, tightly cropped, black-on-white image.

export interface Gray {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** RGBA → grayscale, box-filtered down by an integer-ish factor. */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, scale = 1): Gray {
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const out = new Uint8ClampedArray(width * height);
  const step = 1 / scale;
  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor(y * step);
    const sy1 = Math.min(h, Math.max(sy0 + 1, Math.floor((y + 1) * step)));
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor(x * step);
      const sx1 = Math.min(w, Math.max(sx0 + 1, Math.floor((x + 1) * step)));
      let sum = 0;
      let n = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const i = (yy * w + xx) * 4;
          sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          n++;
        }
      }
      out[y * width + x] = sum / n;
    }
  }
  return { data: out, width, height };
}

function otsu(data: Uint8ClampedArray): number {
  const hist = new Array(256).fill(0);
  for (const v of data) hist[v]++;
  const total = data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Longest run of indices whose value exceeds `min`, tolerating short dips (text lines, folds). */
function longestRun(values: number[], min: number, maxGap: number): [number, number] {
  let best: [number, number] = [0, values.length - 1];
  let bestLen = 0;
  let start = -1;
  let gap = 0;
  for (let i = 0; i <= values.length; i++) {
    const on = i < values.length && values[i] >= min;
    if (on) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > maxGap || i === values.length) {
        const end = i - gap;
        if (end - start > bestLen) {
          bestLen = end - start;
          best = [start, end];
        }
        start = -1;
        gap = 0;
      }
    }
  }
  return best;
}

/**
 * Find the receipt: the large bright (paper) region. Works on a small grayscale copy.
 * Returns a box in that copy's coordinates, or the whole image if no clear paper is found.
 */
export function findPaperBounds(g: Gray): Box {
  const { data, width, height } = g;
  const t = Math.max(otsu(data), 110);
  const bright = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) bright[i] = data[i] > t ? 1 : 0;

  // A paper column is bright over most of the paper's height; gravel/texture is only patchy.
  const rowFrac = Array.from({ length: height }, (_, y) => {
    let s = 0;
    for (let x = 0; x < width; x++) s += bright[y * width + x];
    return s / width;
  });
  const [y0, y1] = longestRun(rowFrac, 0.2, Math.round(height * 0.02));
  const colFrac = Array.from({ length: width }, (_, x) => {
    let s = 0;
    for (let y = y0; y <= y1; y++) s += bright[y * width + x];
    return s / Math.max(1, y1 - y0 + 1);
  });
  const [x0, x1] = longestRun(colFrac, 0.6, Math.round(width * 0.01));

  const box = { x0, y0, x1, y1 };
  const area = ((x1 - x0) * (y1 - y0)) / (width * height);
  // Already-cropped scans or screenshots: keep everything
  if (area < 0.08 || area > 0.97) return { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
  return box;
}

export function crop(g: Gray, b: Box): Gray {
  const x0 = Math.max(0, Math.floor(b.x0));
  const y0 = Math.max(0, Math.floor(b.y0));
  const x1 = Math.min(g.width - 1, Math.ceil(b.x1));
  const y1 = Math.min(g.height - 1, Math.ceil(b.y1));
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    out.set(g.data.subarray((y + y0) * g.width + x0, (y + y0) * g.width + x0 + width), y * width);
  }
  return { data: out, width, height };
}

/**
 * Bradley–Roth adaptive threshold: a pixel is ink if it is `t` darker than its local mean.
 * Handles shadows and uneven lighting that defeat a single global threshold.
 */
export function adaptiveThreshold(g: Gray, windowFrac = 1 / 16, t = 0.15): Gray {
  const { data, width, height } = g;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let row = 0;
    for (let x = 1; x <= width; x++) {
      row += data[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + row;
    }
  }
  const half = Math.max(4, Math.round((width * windowFrac) / 2));
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const ya = Math.max(0, y - half);
    const yb = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x++) {
      const xa = Math.max(0, x - half);
      const xb = Math.min(width, x + half + 1);
      const count = (yb - ya) * (xb - xa);
      const sum =
        integral[yb * (width + 1) + xb] -
        integral[ya * (width + 1) + xb] -
        integral[yb * (width + 1) + xa] +
        integral[ya * (width + 1) + xa];
      out[y * width + x] = data[y * width + x] * count <= sum * (1 - t) ? 0 : 255;
    }
  }
  return { data: out, width, height };
}

/** Skew angle (degrees) that makes text rows sharpest in the horizontal projection. */
export function estimateSkew(bin: Gray, maxDeg = 6, stepDeg = 0.25): number {
  const { data, width, height } = bin;
  const ink: [number, number][] = [];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) if (data[y * width + x] === 0) ink.push([x, y]);
  }
  if (ink.length < 50) return 0;
  let bestAngle = 0;
  let bestScore = -1;
  // Bins are as wide as the sampling stride (2px); 1px bins alias at exactly 0° (only even rows
  // filled), which fakes a perfect score and hides the real skew.
  const BIN = 2;
  const rows = new Float64Array(height);
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += stepDeg) {
    const r = (a * Math.PI) / 180;
    const sin = Math.sin(r);
    const cos = Math.cos(r);
    rows.fill(0);
    for (const [x, y] of ink) {
      const yy = Math.floor((y * cos - x * sin + height / 2) / BIN);
      if (yy >= 0 && yy < rows.length) rows[yy]++;
    }
    let score = 0;
    for (let i = 1; i < rows.length; i++) score += (rows[i] - rows[i - 1]) ** 2;
    if (score > bestScore) {
      bestScore = score;
      bestAngle = a;
    }
  }
  return bestAngle;
}

/** Rotate by `deg` (positive = clockwise correction of a counter-clockwise skew), white fill. */
export function rotate(g: Gray, deg: number): Gray {
  if (Math.abs(deg) < 0.1) return g;
  const { data, width, height } = g;
  const r = (deg * Math.PI) / 180;
  const sin = Math.sin(r);
  const cos = Math.cos(r);
  const cx = width / 2;
  const cy = height / 2;
  const out = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // inverse map: rotate destination back into the source
      const sx = cos * (x - cx) - sin * (y - cy) + cx;
      const sy = sin * (x - cx) + cos * (y - cy) + cy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) continue;
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * width + x0;
      out[y * width + x] =
        data[i] * (1 - fx) * (1 - fy) +
        data[i + 1] * fx * (1 - fy) +
        data[i + width] * (1 - fx) * fy +
        data[i + width + 1] * fx * fy;
    }
  }
  return { data: out, width, height };
}

/**
 * Whiten dark blobs touching the image border (background and torn paper edges that survive the crop).
 * Text never touches the border, so it is untouched.
 */
export function clearBorder(bin: Gray): Gray {
  const { width, height } = bin;
  const data = new Uint8ClampedArray(bin.data);
  const stack: number[] = [];
  const push = (i: number) => {
    if (data[i] === 0) {
      data[i] = 255;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i < (height - 1) * width) push(i + width);
  }
  return { data, width, height };
}

/** Tesseract page-segmentation mode that worked best on preprocessed receipts: one uniform text block. */
export const RECEIPT_PSM = "6";
/** Mode for the header pass: big store-name lettering is dropped by PSM 6 but kept by single-column mode. */
export const HEADER_PSM = "4";

/** Downscale a binarized image by an integer factor (min-pool keeps thin strokes black). */
function shrink(g: Gray, f: number): Gray {
  const width = Math.floor(g.width / f);
  const height = Math.floor(g.height / f);
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 255;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) v = Math.min(v, g.data[(y * f + dy) * g.width + x * f + dx]);
      }
      out[y * width + x] = v;
    }
  }
  return { data: out, width, height };
}

/**
 * Top slice of the receipt, where the store name lives — shrunk 2×, because store names are printed
 * in very large letters and Tesseract reads best at ~30px text height.
 */
export function headerRegion(g: Gray, frac = 0.22): Gray {
  return shrink(crop(g, { x0: 0, y0: 0, x1: g.width - 1, y1: Math.round(g.height * frac) }), 2);
}

// Minimal structural view of Tesseract's `blocks` output (avoids depending on its types here)
interface TessBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TessLine {
  text: string;
  confidence: number;
  bbox: TessBox;
  words?: { text: string; bbox: TessBox }[];
}

/** Text height of a line: median height of its real words (a stray "|" can stretch the line box). */
function lineTextHeight(l: TessLine): number {
  const hs = (l.words ?? [])
    .filter((w) => /[A-Za-z0-9]{2,}/.test(w.text))
    .map((w) => w.bbox.y1 - w.bbox.y0)
    .sort((a, b) => a - b);
  return hs.length ? hs[Math.floor(hs.length / 2)] : l.bbox.y1 - l.bbox.y0;
}
type TessBlocks = { paragraphs: { lines: TessLine[] }[] }[] | null | undefined;

export interface OcrLine {
  text: string;
  /** Text height in the preprocessed image's pixels */
  height: number;
  /** Top edge as a fraction of the image height */
  top: number;
  confidence: number;
}

export function linesFromBlocks(blocks: TessBlocks, imageHeight: number, scale = 1): OcrLine[] {
  return (blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) =>
      p.lines.map((l) => ({
        text: l.text.trim(),
        height: lineTextHeight(l) * scale,
        top: (l.bbox.y0 * scale) / imageHeight,
        confidence: l.confidence,
      })),
    ),
  );
}

const PLAUSIBLE_NAME = (l: string) =>
  (l.match(/[A-Za-z]/g)?.length ?? 0) >= 3 && (l.match(/\d/g)?.length ?? 0) <= 2 && /^[A-Za-z0-9 '&.,-]+$/.test(l);

/**
 * The store name is the largest text near the top of a receipt. Pick the tallest plausible line
 * from the top quarter (header pass and main pass combined).
 */
export function pickStoreName(lines: OcrLine[]): string | null {
  const candidates = lines
    .map((l) => ({ ...l, text: l.text.replace(/[^A-Za-z0-9 '&.,-]/g, "").replace(/\s{2,}/g, " ").trim() }))
    .filter((l) => l.top < 0.25 && l.confidence >= 30 && PLAUSIBLE_NAME(l.text));
  if (!candidates.length) return null;
  // Tallest wins; among near-equal heights (±15%) the topmost line is the store name
  // (receipts print name, then address)
  const tallest = Math.max(...candidates.map((c) => c.height));
  return candidates.filter((c) => c.height >= tallest * 0.85).sort((a, b) => a.top - b.top)[0].text;
}

/** Tesseract mode for reading one cropped line of text. */
export const TITLE_PSM = "7";

/**
 * Find the store-name line geometrically: the tallest band of text rows in the top of the receipt.
 * Tesseract's layout analysis sometimes skips very large lettering, so we crop it out ourselves.
 * Returns the band shrunk to ~40px text height, or null if nothing stands out.
 */
export function titleBand(bin: Gray, topFrac = 0.3): Gray | null {
  const { data, width } = bin;
  const maxY = Math.round(bin.height * topFrac);
  // Per row: ink pixels, and how widely they are spread (vertical streaks/specks are narrow)
  const rowInk = new Array(maxY).fill(0);
  for (let y = 0; y < maxY; y++) {
    for (let x = 0; x < width; x++) if (data[y * width + x] === 0) rowInk[y]++;
  }
  const bands: { y0: number; y1: number }[] = [];
  let start = -1;
  for (let y = 0; y <= maxY; y++) {
    const on = y < maxY && rowInk[y] > width * 0.004;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      bands.push({ y0: start, y1: y - 1 });
      start = -1;
    }
  }
  const textBands = bands.filter(({ y0, y1 }) => {
    if (y1 - y0 < 8) return false;
    // Text fills a good share of each row; a streak or a scatter of specks does not
    let ink = 0;
    for (let y = y0; y <= y1; y++) ink += rowInk[y];
    if (ink / (y1 - y0 + 1) < width * 0.02) return false;
    // Real text spans a decent width
    let minX = width;
    let maxX = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = 0; x < width; x++) {
        if (data[y * width + x] === 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    return maxX - minX > width * 0.15;
  });
  if (textBands.length < 2) return null;
  const heights = textBands.map((b) => b.y1 - b.y0 + 1).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const tallest = textBands.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
  const h = tallest.y1 - tallest.y0 + 1;
  if (h < median * 1.3) return null; // no distinctly larger title
  const pad = Math.round(h * 0.25);
  const band = crop(bin, { x0: 0, y0: tallest.y0 - pad, x1: width - 1, y1: tallest.y1 + pad });
  const f = Math.max(1, Math.round(h / 40));
  return f > 1 ? shrink(band, f) : band;
}

/**
 * Combine the OCR passes: main text for the line items, plus the store name — from the dedicated
 * title-line pass when it reads plausibly, otherwise the tallest plausible line from the other passes.
 * (The header pass ran on `headerRegion`, i.e. shrunk 2×.)
 */
export function assembleOcrText(
  main: { text: string; blocks?: TessBlocks },
  header: { blocks?: TessBlocks },
  imageHeight: number,
  titleText?: string,
): string {
  const title = titleText?.replace(/[^A-Za-z0-9 '&.,-]/g, "").replace(/\s{2,}/g, " ").trim();
  if (title && PLAUSIBLE_NAME(title)) return withStore(title, main.text);
  const lines = [
    ...linesFromBlocks(main.blocks, imageHeight, 1),
    ...linesFromBlocks(header.blocks, imageHeight, 2),
  ];
  return withStore(pickStoreName(lines), main.text);
}

/** Make sure the chosen store name is the first plausible line the parser sees. */
export function withStore(store: string | null, mainText: string): string {
  if (!store) return mainText;
  const firstMain = mainText.split(/\r?\n/).map((l) => l.trim()).find(PLAUSIBLE_NAME);
  return firstMain === store ? mainText : `${store}\n${mainText}`;
}

export interface PreprocessOptions {
  /** Width (px) the cropped receipt is scaled to before OCR */
  targetWidth?: number;
  windowFrac?: number;
  threshold?: number;
  /** false → hand Tesseract the deskewed grayscale and let it binarize */
  binarize?: boolean;
}

/** Full pipeline on an RGBA photo. Returns a clean black-on-white receipt image. */
export function preprocessReceipt(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  opts: PreprocessOptions = {},
): { image: Gray; box: Box; skew: number } {
  const targetWidth = opts.targetWidth ?? 1100;
  // Tuned on real phone photos: a gentler threshold keeps thin thermal-print digits intact (9 vs 8)
  opts = { threshold: 0.1, ...opts };

  // 1. Locate the paper on a small copy
  const smallScale = Math.min(1, 600 / Math.max(w, h));
  const small = rgbaToGray(rgba, w, h, smallScale);
  const sb = findPaperBounds(small);
  const pad = 0.01 * Math.max(small.width, small.height);
  const box: Box = {
    x0: Math.max(0, (sb.x0 - pad) / smallScale),
    y0: Math.max(0, (sb.y0 - pad) / smallScale),
    x1: Math.min(w - 1, (sb.x1 + pad) / smallScale),
    y1: Math.min(h - 1, (sb.y1 + pad) / smallScale),
  };

  // 2. Crop at a resolution where text is a comfortable size for Tesseract
  const paperW = box.x1 - box.x0 + 1;
  const scale = Math.min(2, targetWidth / paperW);
  const full = rgbaToGray(rgba, w, h, Math.min(1, scale));
  const s = full.width / w;
  let g = crop(full, { x0: box.x0 * s, y0: box.y0 * s, x1: box.x1 * s, y1: box.y1 * s });

  // 3. Deskew using a binarized copy
  const skew = estimateSkew(clearBorder(adaptiveThreshold(g, opts.windowFrac, opts.threshold)));
  g = rotate(g, skew);

  // 4. Final binarization + border clean-up
  const bin = clearBorder(adaptiveThreshold(g, opts.windowFrac, opts.threshold));
  if (opts.binarize === false) {
    // Keep grey levels for Tesseract, but blank out what the border clean-up removed
    const out = new Uint8ClampedArray(g.data);
    const raw = adaptiveThreshold(g, opts.windowFrac, opts.threshold);
    for (let i = 0; i < out.length; i++) if (raw.data[i] === 0 && bin.data[i] === 255) out[i] = 255;
    return { image: { data: out, width: g.width, height: g.height }, box, skew };
  }
  return { image: bin, box, skew };
}
