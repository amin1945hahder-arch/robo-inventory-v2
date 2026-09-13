import { snapdom } from "@zumer/snapdom";

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
 */
export async function elementToPdfBytes(
  el: HTMLElement,
): Promise<{ pdf: Uint8Array; widthPx: number; heightPx: number }> {
  const canvas = await elementToCanvas(el);
  // 0.92 quality ≈ visually lossless at 3× scale, much smaller than PNG.
  const jpegUrl = canvas.toDataURL("image/jpeg", 0.92);
  const bytes = dataUrlToBytes(jpegUrl);
  return { pdf: pngBytesToPdf(bytes, canvas.width, canvas.height), widthPx: canvas.width, heightPx: canvas.height };
}

/** Trigger a browser download of the card PDF. */
export async function downloadCardPdf(el: HTMLElement, fileName: string): Promise<void> {
  const { pdf } = await elementToPdfBytes(el);
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
): Promise<{ base64: string; widthPx: number; heightPx: number }> {
  const { pdf, widthPx, heightPx } = await elementToPdfBytes(el);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < pdf.length; i += CHUNK) {
    bin += String.fromCharCode(...pdf.subarray(i, i + CHUNK));
  }
  return { base64: btoa(bin), widthPx, heightPx };
}
