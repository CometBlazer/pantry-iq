"use client";

import { useRef, useState } from "react";
import { Camera, FileText, ImageIcon, Loader2, ScanLine, Sparkles, Upload, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CATALOG, formatMoney, formatQty, PRODUCTS_BY_ID } from "@/lib/catalog";
import { ocrReceipt } from "@/lib/ocr";
import { parseReceiptText, requantify, SAMPLE_RECEIPTS, toParsedReceipt } from "@/lib/receipt";
import type { ParsedReceipt, ReceiptLine } from "@/lib/types";

const IGNORE = "__ignore";

const productItems: Record<string, string> = {
  [IGNORE]: "Not food / ignore",
  ...Object.fromEntries(CATALOG.map((p) => [p.id, p.name])),
};

async function imageToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  // Downscale large phone photos so uploads stay small; receipts stay legible at 1600px.
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { data: dataUrl.split(",")[1], mediaType: "image/jpeg" };
}

export function ReceiptScanner({
  onAdd,
}: {
  onAdd: (store: string, lines: ReceiptLine[]) => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const pickFile = (f: File | null) => {
    setFile(f);
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  /** Free fallback: OCR the photo in the browser, then run the rule-based parser. */
  const scanOnDevice = async (photo: File) => {
    setProgress("Loading text recognition…");
    const ocrText = await ocrReceipt(photo, (status, p) => {
      setProgress(status === "recognizing text" ? `Reading receipt… ${Math.round(p * 100)}%` : "Loading text recognition…");
    });
    setText(ocrText); // visible below, so the user can fix OCR slips and re-parse
    const raw = parseReceiptText(ocrText, { ocr: true });
    if (!raw.items.length) {
      throw new Error(
        "Couldn't find any priced lines in that photo. Try a flatter, well-lit shot, or edit the recognised text below and press Parse.",
      );
    }
    setReceipt(toParsedReceipt(raw, "ocr"));
  };

  const scan = async (source: "image" | "text") => {
    setLoading(true);
    setError(null);
    setReceipt(null);
    try {
      const body =
        source === "image" && file ? { image: await imageToBase64(file) } : { text };
      const res = await fetch("/api/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // 503 = no Anthropic key on the server: read the photo on this device instead
      if (res.status === 503 && source === "image" && file) {
        await scanOnDevice(file);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not read receipt");
      setReceipt(json as ParsedReceipt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read receipt");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const updateLine = (i: number, productId: string | null) => {
    if (!receipt) return;
    const lines = receipt.lines.map((l, j) =>
      j === i ? requantify(l, productId === IGNORE ? null : productId) : l,
    );
    setReceipt({ ...receipt, lines });
  };

  const matched = receipt?.lines.filter((l) => l.productId) ?? [];

  const commit = () => {
    if (!receipt) return;
    onAdd(receipt.store, receipt.lines);
    toast.success(`Added ${matched.length} items to your pantry`, {
      description: `${receipt.store} receipt processed`,
    });
    setReceipt(null);
    setText("");
    pickFile(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="size-4" /> Scan a receipt
          </CardTitle>
          <CardDescription>
            Photograph a supermarket receipt, or paste its text. PantryIQ extracts each line,
            matches it to a product and adds it to your inventory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-stone bg-canvas p-8 text-center text-body-sm text-mute transition-colors hover:border-ash"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pickFile(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Receipt preview" className="max-h-48 rounded-lg object-contain" />
            ) : (
              <>
                <span className="flex size-10 items-center justify-center rounded-full bg-surface-card text-ink"><Camera className="size-4" /></span>
                <span>
                  <span className="font-semibold text-ink">Take a photo or choose one</span>
                  <span className="block">or drop a receipt image here</span>
                </span>
              </>
            )}
            {/* No `capture` attribute: on iPhone/Android this lets the OS show its own menu
                (Photo Library / Take Photo / Choose File) instead of forcing the camera. */}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0] ?? null);
                e.target.value = ""; // allow re-picking the same photo
              }}
            />
          </div>
          {/* Phones and tablets: explicit camera vs. photo-library choice */}
          <div className="hidden grid-cols-2 gap-2 pointer-coarse:grid">
            <Button variant="outline" className="w-full" onClick={() => cameraInput.current?.click()}>
              <Camera /> Take photo
            </Button>
            <Button variant="outline" className="w-full" onClick={() => fileInput.current?.click()}>
              <ImageIcon /> Choose photo
            </Button>
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>
          <Button variant="secondary" className="w-full" disabled={!file || loading} onClick={() => scan("image")}>
            {loading && file ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {progress ?? "Read photo"}
          </Button>

          <div className="flex items-center gap-3 text-xs font-medium text-mute">
            <div className="h-px flex-1 bg-hairline" /> or paste text <div className="h-px flex-1 bg-hairline" />
          </div>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"TESCO STORES\nSEMI SKMD MILK 4PT   1.65\n..."}
            className="h-40 text-sm tabular-nums"
          />
          <div className="flex flex-wrap gap-2">
            {SAMPLE_RECEIPTS.map((s) => (
              <Button key={s.label} variant="outline" size="sm" className="rounded-full bg-canvas" onClick={() => setText(s.text)}>
                <FileText /> {s.label}
              </Button>
            ))}
          </div>
          <Button
            variant="secondary"
            className="w-full"
            disabled={!text.trim() || loading}
            onClick={() => scan("text")}
          >
            {loading && !file ? <Loader2 className="animate-spin" /> : <Upload />}
            Parse receipt text
          </Button>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Extracted items</CardTitle>
          <CardDescription>
            {receipt
              ? `${receipt.store}${receipt.date ? ` · ${receipt.date}` : ""}${receipt.total != null ? ` · total ${formatMoney(receipt.total, receipt.currency)}` : ""} · ${receipt.lines.length} lines · read by ${receipt.engine === "claude" ? "Claude" : receipt.engine === "ocr" ? "on-device OCR — check the matches" : "rule-based parser"}`
              : "Check the matches before adding them to your pantry."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Couldn&apos;t read that receipt</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!receipt && !error && (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-body-sm text-mute">
              <ScanLine className="size-8 opacity-40" />
              Scan a receipt to see what PantryIQ finds.
              <span className="text-xs">Tip: try one of the sample receipts.</span>
            </div>
          )}
          {receipt?.kind === "dining" && (
            <Alert className="mb-4 border-0 bg-surface-card">
              <UtensilsCrossed />
              <AlertTitle>This looks like a restaurant bill</AlertTitle>
              <AlertDescription>
                Meals you&apos;ve already eaten don&apos;t go in the pantry, so nothing is selected. If any line is
                groceries, pick the product to add it.
              </AlertDescription>
            </Alert>
          )}
          {receipt && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt line</TableHead>
                  <TableHead>Matched product</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Match</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipt.lines.map((line, i) => {
                  const product = line.productId ? PRODUCTS_BY_ID[line.productId] : null;
                  return (
                    <TableRow key={i} className={product ? "" : "opacity-60"}>
                      <TableCell className="max-w-48 truncate text-xs font-medium uppercase tracking-wide text-body" title={line.raw}>
                        {line.count > 1 ? `${line.count} × ` : ""}
                        {line.raw}
                      </TableCell>
                      <TableCell>
                        <Select
                          items={productItems}
                          value={line.productId ?? IGNORE}
                          onValueChange={(v) => updateLine(i, v as string)}
                        >
                          <SelectTrigger size="sm" className="w-52 font-medium">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={IGNORE}>Not food / ignore</SelectItem>
                            {line.alternatives.map((id) => (
                              <SelectItem key={`alt-${id}`} value={id}>
                                {PRODUCTS_BY_ID[id].name}
                              </SelectItem>
                            ))}
                            {CATALOG.filter((p) => !line.alternatives.includes(p.id)).map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {product ? `${formatQty(line.qty, product.unit)}${product.unit === "item" ? " items" : ""}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.linePrice != null ? formatMoney(line.linePrice, receipt.currency) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {receipt.kind === "dining" && !line.productId ? (
                          <Badge variant="secondary">Meal</Badge>
                        ) : (
                          <Badge className={line.matchScore >= 0.75 ? "bg-success-pale text-success-deep" : line.productId ? "bg-canvas text-ink" : "bg-error/10 text-error"}>
                            {Math.round(line.matchScore * 100)}%
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {receipt && (
          <CardFooter className="justify-between gap-2">
            <span className="text-body-sm text-mute">
              {matched.length} of {receipt.lines.length} lines matched ·{" "}
              {formatMoney(matched.reduce((s, l) => s + (l.linePrice ?? 0), 0), receipt.currency)}
            </span>
            <Button onClick={commit} disabled={!matched.length}>
              Add {matched.length} items to pantry
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
