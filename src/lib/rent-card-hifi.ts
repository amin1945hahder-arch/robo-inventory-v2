import { snapdom } from "@zumer/snapdom";
import {
  pageMm,
  placedCardMm,
  type CardPrintLayout,
} from "./card-print-layout";

/**
 * Hi-fi rent-card PDF pipeline.
 *
 * The Telegram PDF used to be drawn by a hand-rolled vector PDF renderer
 * (WinAnsi Helvetica) which has no Arabic glyphs — Arabic names came out
 * transliterated or mangled. The on-screen card in RentCardDialog, however,
 * renders perfectly (browser text shaping + RTL). So instead of redrawing the
 * card server-side, we capture the EXACT card element the admin sees and
 * print it to PDF:
 *
 *   1. snapdom serializes the card DOM → rasterizes to a high-DPI canvas
 *   2. the canvas becomes a single-page PDF sized exactly to the card
 *   3. the PDF goes to Telegram as a real document (or downloads locally)
 *
 * Result: the group receives the same crisp card the admin would print —
 * identical layout, identical fonts, correct Arabic, correct RTL.
 */

/** Rasterize an element to a canvas at 3× scale (print-crisp). */
async function elementToCanvas(el: HTMLElement): Promise<HTMLCanvasElement> {
  return snapdom.toCanvas(el, { scale: 3, fast: false });
}

/** Data URL → raw bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Wrap a PNG image in a minimal valid single-page PDF whose page is sized
 * exactly to the image (1 px = 0.75 pt at 96 dpi).
 */
export function pngBytesToPdf(
  bytes: Uint8Array,
  widthPx: number,
  heightPx: number,
): Uint8Array {
  const W = widthPx * 0.75;
  const H = heightPx * 0.75;
  const content = `q ${W.toFixed(2)} 0 0 ${H.toFixed(2)} 0 0 cm /Im0 Do Q`;
  const enc = new TextEncoder();

  const obj5 = (filter: string) =>
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} /Length ${bytes.length} >>\nstream\n`;

  const parts: Uint8Array[] = [];
  const offs: number[] = [];
  let pos = 0;
  const add = (data: string | Uint8Array) => {
    const b = typeof data === "string" ? enc.encode(data) : data;
    offs.push(pos);
    parts.push(b);
    pos += b.length;
  };

  add("%PDF-1.4\n");
  add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  add("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  add(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 6 0 R >>\nendobj\n`,
  );
  add("4 0 obj\n<< >>\nendobj\n");
  // Object 5: the image stream (JPEG/DCTDecode — browsers give us JPEG from
  // toDataURL("image/jpeg") which embeds directly, no re-encoding needed).
  add(obj5("DCTDecode"));
  add(bytes);
  add("\nendstream\nendobj\n");
  add(`6 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

  const xrefStart = pos;
  let xref = "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 0; i < 6; i++) xref += `${String(offs[i]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  add(xref);

  const total = parts.reduce((n, b) => n + b.length, 0);
  const pdf = new Uint8Array(total);
  let w = 0;
  for (const b of parts) {
    pdf.set(b, w);
    w += b.length;
  }
  return pdf;
}

/**
 * Rasterize the card element and build the PDF bytes (JPEG-embedded so the
 * browser's own encoder does all compression; Arabic text is pixels — perfect).
 *
 * With a `layout` the card is PLACED on the configured paper (page size,
 * card size, position from Admin Settings → Card print layout) instead of
 * producing a page cut exactly to the card. The card is scaled to fit its
 * box — never stretched.
 */
export async function elementToPdfBytes(
  el: HTMLElement,
  layout?: CardPrintLayout,
): Promise<{ pdf: Uint8Array; widthPx: number; heightPx: number }> {
  const canvas = await elementToCanvas(el);
  // 0.92 quality ≈ visually lossless at 3× scale, much smaller than PNG.
  const jpegUrl = canvas.toDataURL("image/jpeg", 0.92);
  const bytes = dataUrlToBytes(jpegUrl);

  if (!layout) {
    return {
      pdf: pngBytesToPdf(bytes, canvas.width, canvas.height),
      widthPx: canvas.width,
      heightPx: canvas.height,
    };
  }

  // Map the card onto the configured page (mm → px at 96dpi, ×3 raster).
  const MM_PER_PX = 25.4 / 96;
  const placed = placedCardMm(layout, canvas.width / 3 * MM_PER_PX, canvas.height / 3 * MM_PER_PX);
  const page = pageMm(layout);
  const pageWPx = (page.w / MM_PER_PX) * 3;
  const pageHPx = (page.h / MM_PER_PX) * 3;
  // White page canvas, card drawn at its placed rect.
  const sheet = document.createElement("canvas");
  sheet.width = Math.round(pageWPx);
  sheet.height = Math.round(pageHPx);
  const ctx = sheet.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("card raster failed"));
    img.src = jpegUrl;
  });
  const S = 3; // raster scale
  ctx.drawImage(
    img,
    (placed.x / MM_PER_PX) * S,
    (placed.y / MM_PER_PX) * S,
    (placed.w / MM_PER_PX) * S,
    (placed.h / MM_PER_PX) * S,
  );
  const sheetUrl = sheet.toDataURL("image/jpeg", 0.92);
  const sheetBytes = dataUrlToBytes(sheetUrl);
  return {
    pdf: pngBytesToPdf(sheetBytes, sheet.width, sheet.height),
    widthPx: sheet.width,
    heightPx: sheet.height,
  };
}

/** Trigger a browser download of the card PDF (optionally page-placed). */
export async function downloadCardPdf(
  el: HTMLElement,
  fileName: string,
  layout?: CardPrintLayout,
): Promise<void> {
  const { pdf } = await elementToPdfBytes(el, layout);
  const blob = new Blob([pdf as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Build the card PDF for the Telegram relay (base64, no data: prefix). */
export async function elementToPdfBase64(
  el: HTMLElement,
  layout?: CardPrintLayout,
): Promise<{ base64: string; widthPx: number; heightPx: number }> {
  const { pdf, widthPx, heightPx } = await elementToPdfBytes(el, layout);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < pdf.length; i += CHUNK) {
    bin += String.fromCharCode(...pdf.subarray(i, i + CHUNK));
  }
  return { base64: btoa(bin), widthPx, heightPx };
}
