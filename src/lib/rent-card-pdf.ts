// Rent-card PDF renderer — pure JS, no native dependencies.
//
// Builds the same layout as the on-screen printable card (header, QR linking
// to the rental, one labelled row per data field) and encodes it as a valid
// single-page PDF. Telegram receives it as a real PDF document that opens
// anywhere and prints at fixed size — unlike the previous PNG, nothing is
// rescaled by chat clients and the text stays crisp.
//
// Also exports the Telegram caption builder (one line per data field) so the
// exact text attached to the PDF is unit-testable.

import QRCode from "qrcode";

export type RentCardData = {
  rentalId: string;
  groupName: string;
  tag: string;
  holderName: string;
  studentId?: string;
  statusLabel: string;
  requestedAt?: number;
  decidedAt?: number;
  pickedUpAt?: number;
  returnedAt?: number;
  conditionReport?: string;
  projectName?: string;
};

/**
 * Telegram caption for the rent-card PDF: headline, blank line, then one data
 * field per line (never a single long row). `extraUnitLines` are indented
 * bullet lines for every unit of a package rental.
 */
export function buildRentCardCaption(
  card: RentCardData,
  headline: string,
  extraUnitLines?: string[],
): string {
  const lines: string[] = [headline, ""];
  lines.push(`🏷 Item: ${card.groupName} (${card.tag})`);
  if (extraUnitLines && extraUnitLines.length > 0) {
    for (const u of extraUnitLines) lines.push(u);
  }
  lines.push(`👤 Student: ${card.holderName}${card.studentId ? ` · ${card.studentId}` : ""}`);
  lines.push(`📌 Status: ${card.statusLabel}`);
  if (card.projectName) lines.push(`🤖 Project: ${card.projectName}`);
  if (card.requestedAt) lines.push(`📅 Requested: ${new Date(card.requestedAt).toLocaleString("en-GB")}`);
  if (card.decidedAt) lines.push(`✅ Decided: ${new Date(card.decidedAt).toLocaleString("en-GB")}`);
  if (card.pickedUpAt) lines.push(`📦 Picked up: ${new Date(card.pickedUpAt).toLocaleString("en-GB")}`);
  if (card.returnedAt) lines.push(`↩️ Returned: ${new Date(card.returnedAt).toLocaleString("en-GB")}`);
  if (card.conditionReport) lines.push(`📝 Condition: ${card.conditionReport}`);
  return lines.join("\n");
}

const fmt = (n?: number) => (n ? new Date(n).toLocaleString("en-GB") : "—");

// ---------------------------------------------------------------------------
// PDF primitives
// ---------------------------------------------------------------------------

function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function latin1(s: string): string {
  // WinAnsi 0x80–0x9F maps smart quotes etc. to PRINTABLE chars for widths.
  const fixes: Record<number, string> = {
    0x2018: "'", 0x2019: "'", 0x201c: '"', 0x201d: '"',
    0x2013: "-", 0x2014: "-", 0x2026: "...",
    0x00a0: " ", 0x2190: "<-", 0x2192: "->", 0x00d7: "x",
    0x2022: "*", 0x00b7: "-", 0x25cf: "o", 0x26a0: "!", 0x2705: "OK",
  };
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (fixes[cp] !== undefined) {
      out += fixes[cp];
    } else if (cp >= 0x20 && cp <= 0x7e) {
      out += ch;
    } else if (cp >= 0xa0 && cp <= 0xff) {
      out += ch; // latin-1 direct
    } else if (cp === 0x20ac) {
      out += "\u20ac";
    } else {
      out += "?";
    }
  }
  return out;
}

// Helvetica AFM widths (1000 units/em) for chars 0x20–0xFF. Box drawing,
// arrows and control chars get a nominal 556 so nothing throws.
function helvWidth(code: number, bold: boolean): number {
  const W_R = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const W_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  if (code >= 0x20 && code < 0x20 + W_R.length) return (bold ? W_B : W_R)[code - 0x20];
  if (code >= 0xa1 && code <= 0xff) {
    const extraR: Record<number, number> = {};
    const extraB: Record<number, number> = {};
    const w = (bold ? extraB : extraR)[code] ?? 556;
    return w;
  }
  return 556;
}

function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of latin1(s)) w += helvWidth(ch.charCodeAt(0), bold);
  return (w / 1000) * size;
}

/** Break text into lines that fit maxWidth (points), breaking on words. */
function wrapText(s: string, size: number, maxWidth: number, bold = false): string[] {
  const words = latin1(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (textWidth(cand, size, bold) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cand;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildPdf(contentOps: string[], width: number, height: number): Uint8Array {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>"); // 1
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"); // 2
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
  ); // 3
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"); // 4
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"); // 5

  const stream = contentOps.join("\n");
  objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`); // 6

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

// ---------------------------------------------------------------------------
// Card layout
// ---------------------------------------------------------------------------

const PAGE_W = 420; // points (~5.8 in — a card that prints crisp)
const PAGE_H = 330;
const MARGIN = 28;

/** Render the rent card as a PDF (single page, A-series landscape card). */
export function renderRentCardPdf(card: RentCardData): Uint8Array {
  const ops: string[] = [];
  const contentW = PAGE_W - MARGIN * 2 - 130; // leave room for the QR block
  let y = PAGE_H - MARGIN;

  // Header
  ops.push("BT /F1 8 Tf 0.45 0.45 0.45 rg");
  ops.push(`${MARGIN} ${y - 8} Td (ROBOTICS CLUB - RENTAL RECEIPT) Tj ET`);
  y -= 22;
  ops.push("BT /F2 15 Tf 0.06 0.06 0.06 rg");
  ops.push(`${MARGIN} ${y - 12} Td (${pdfEscape(latin1(card.groupName.slice(0, 40)))}) Tj ET`);
  y -= 20;
  ops.push("BT /F1 10 Tf 0.35 0.35 0.35 rg");
  ops.push(`${MARGIN} ${y - 9} Td (${pdfEscape(latin1(card.tag))}) Tj ET`);
  y -= 22;
  ops.push(`0.85 0.85 0.85 RG 0.8 w ${MARGIN} ${y} m ${PAGE_W - MARGIN - 140} ${y} l S`);
  y -= 20;

  // Data rows (each on its own line, wrapped)
  const rows: [string, string][] = [
    ["Student", card.holderName || "—"],
    ...(card.studentId ? ([["Student ID", card.studentId]] as [string, string][]) : []),
    ["Status", card.statusLabel || "—"],
    ["Requested", fmt(card.requestedAt)],
    ["Approved", fmt(card.decidedAt ?? card.pickedUpAt)],
    ["Returned", fmt(card.returnedAt)],
    ...(card.projectName ? ([["Project", card.projectName]] as [string, string][]) : []),
    ...(card.conditionReport ? ([["Condition", card.conditionReport]] as [string, string][]) : []),
  ];

  for (const [k, val] of rows) {
    const labelX = MARGIN;
    const valueX = MARGIN + 92;
    ops.push("BT /F1 8 Tf 0.45 0.45 0.45 rg");
    ops.push(`${labelX} ${y - 8} Td (${pdfEscape(latin1(k.toUpperCase()))}) Tj ET`);
    const lines = wrapText(val, 10, contentW - 92);
    let vy = y;
    for (const line of lines) {
      ops.push("BT /F2 10 Tf 0.06 0.06 0.06 rg");
      ops.push(`${valueX} ${vy - 8} Td (${pdfEscape(latin1(line))}) Tj ET`);
      vy -= 13;
      if (vy < MARGIN + 30) break;
    }
    y = vy - 7;
    if (y < MARGIN + 20) break;
  }

  // QR code — embedded as a bitmap XObject (drawn cell-by-cell as rects is
  // heavy in PDF; a tiny raster keeps the file small and prints perfectly).
  // We draw it as filled rectangles in the content stream instead: the QR is
  // ~29x29 modules, so at most ~450 rects — cheap and vector-sharp.
  const qr = QRCode.create(`rental:${card.rentalId}`, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const bits = qr.modules.data;
  const cell = 3.1;
  const qrSide = size * cell;
  const qrX = PAGE_W - MARGIN - qrSide;
  const qrY = PAGE_H - MARGIN - qrSide - 14;
  ops.push("0 0 0 rg");
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (bits[r * size + c]) {
        ops.push(
          `${(qrX + c * cell).toFixed(2)} ${(qrY + (size - 1 - r) * cell).toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`,
        );
      }
    }
  }
  ops.push("BT /F1 6.5 Tf 0.45 0.45 0.45 rg");
  ops.push(`${qrX} ${qrY - 10} Td (scan to open this rental) Tj ET`);

  // Footer
  ops.push("BT /F1 7 Tf 0.55 0.55 0.55 rg");
  ops.push(`${MARGIN} ${MARGIN - 8} Td (Generated ${new Date().toLocaleString("en-GB")} - Robotics Club Inventory) Tj ET`);

  return buildPdf(ops, PAGE_W, PAGE_H);
}
