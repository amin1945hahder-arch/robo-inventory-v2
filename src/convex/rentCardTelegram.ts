"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import QRCode from "qrcode";
import { deflateSync } from "node:zlib";

/**
 * Rent-card attachment for the club Telegram group.
 *
 * When a member requests a return (or an admin processes one), a printable
 * "rent card" PNG is pushed to the group — the same data the printable card
 * in the app shows (part, holder, dates, condition) plus a QR that re-opens
 * the rental record when scanned. The PNG is rendered and encoded 100% in
 * JS (qrcode + a zlib-based PNG encoder + an embedded 5×7 bitmap font), so
 * there are no native deps, no canvas and no headless browser — it runs
 * anywhere Convex node actions run.
 */

type RentCardData = {
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

const fmt = (n?: number) => (n ? new Date(n).toLocaleString("en-GB") : "—");

// ---------------------------------------------------------------------------
// Minimal pure-JS PNG text renderer
// ---------------------------------------------------------------------------

/** 5×7 bitmap font (column bytes, LSB = top row) for latin glyphs. */
const GLYPHS: Record<string, number[]> = {
  A: [0x7e, 0x11, 0x11, 0x7e], B: [0x7f, 0x49, 0x49, 0x36], C: [0x3e, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x3e], E: [0x7f, 0x49, 0x49, 0x41], F: [0x7f, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x3a], H: [0x7f, 0x08, 0x08, 0x7f], I: [0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f], K: [0x7f, 0x08, 0x14, 0x63], L: [0x7f, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x04, 0x02, 0x7f], N: [0x7f, 0x04, 0x08, 0x10, 0x7f], O: [0x3e, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x06], Q: [0x3e, 0x41, 0x51, 0x5e], R: [0x7f, 0x09, 0x19, 0x66],
  S: [0x26, 0x49, 0x49, 0x32], T: [0x01, 0x7f, 0x01, 0x00], U: [0x3f, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f], W: [0x3f, 0x40, 0x38, 0x40, 0x3f], X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x03, 0x04, 0x78, 0x04, 0x03], Z: [0x61, 0x51, 0x49, 0x47],
  "0": [0x3e, 0x51, 0x49, 0x45], "1": [0x00, 0x42, 0x7f, 0x40], "2": [0x42, 0x61, 0x51, 0x4e],
  "3": [0x42, 0x41, 0x51, 0x4a], "4": [0x18, 0x14, 0x12, 0x7f], "5": [0x27, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x30], "7": [0x01, 0x71, 0x09, 0x05], "8": [0x36, 0x49, 0x49, 0x36],
  "9": [0x06, 0x49, 0x49, 0x3e],
  " ": [0x00, 0x00, 0x00, 0x00], ".": [0x00, 0x60, 0x60, 0x00], ",": [0x00, 0x50, 0x20, 0x00],
  ":": [0x00, 0x24, 0x24, 0x00], "-": [0x08, 0x08, 0x08, 0x00], "/": [0x20, 0x10, 0x08, 0x04],
  "(": [0x00, 0x3e, 0x41, 0x00], ")": [0x00, 0x41, 0x3e, 0x00], "'": [0x00, 0x05, 0x02, 0x00],
  "!": [0x00, 0x00, 0x5f, 0x00], "?": [0x02, 0x01, 0x51, 0x09], "*": [0x08, 0x2a, 0x1c, 0x2a],
  "+": [0x08, 0x08, 0x3e, 0x08], "#": [0x14, 0x7f, 0x14, 0x7f, 0x14], "&": [0x26, 0x55, 0x49, 0x3a],
  "=": [0x14, 0x14, 0x14, 0x00], "%": [0x32, 0x49, 0x49, 0x26], '"': [0x05, 0x05, 0x00, 0x00],
  ";": [0x00, 0x54, 0x2a, 0x00], "@": [0x3e, 0x41, 0x55, 0x5a], "_": [0x40, 0x40, 0x40, 0x40],
};

function glyphFor(ch: string): number[] {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS["?"];
}

type Rgb = [number, number, number];

/** Flat 3-byte-per-pixel RGB canvas with text + rect helpers. */
function makeCanvas(w: number, h: number) {
  const data = Buffer.alloc(w * h * 3, 255);
  const px = (x: number, y: number, [r, g, b]: Rgb) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  };
  const rect = (x0: number, y0: number, rw: number, rh: number, c: Rgb) => {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) px(x, y, c);
  };
  /** Draw one glyph; returns its width in px. */
  const glyph = (ch: string, x: number, y: number, scale: number, color: Rgb): number => {
    const g = glyphFor(ch);
    for (let cx = 0; cx < g.length; cx++) {
      for (let row = 0; row < 7; row++) {
        if ((g[cx] >> row) & 1) rect(x + cx * scale, y + row * scale, scale, scale, color);
      }
    }
    return g.length * scale;
  };
  const text = (s: string, x: number, y: number, scale: number, color: Rgb): number => {
    let cx = x;
    for (const ch of s) cx += glyph(ch, cx, y, scale, color) + scale;
    return cx;
  };
  const textWidth = (s: string, scale: number): number => {
    let tw = 0;
    for (const ch of s) tw += glyphFor(ch).length * scale + scale;
    return tw;
  };
  return { data, px, rect, text, textWidth };
}

const GRAY: Rgb = [110, 110, 110];
const DARK: Rgb = [17, 17, 17];
const LIGHT: Rgb = [229, 229, 229];

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGB, no interlace) — PNG = sig + IHDR + IDAT + IEND
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGB canvas buffer (w*h*3) as a PNG. */
function encodePng(w: number, h: number, rgb: Buffer): Buffer {
  // Each scanline is prefixed with filter byte 0 (None).
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Render the rent card to a PNG buffer (pure JS, no native modules). */
export async function renderRentCardPng(card: RentCardData): Promise<Buffer> {
  const W = 560;
  const H = 540;
  const img = makeCanvas(W, H);
  const BORDER: Rgb = [190, 190, 190];
  img.rect(0, 0, W, 2, BORDER);
  img.rect(0, H - 2, W, 2, BORDER);
  img.rect(0, 0, 2, H, BORDER);
  img.rect(W - 2, 0, 2, H, BORDER);

  const S = 2;
  const pad = 28;

  img.text("ROBOTICS CLUB - RENTAL RECEIPT", pad, 22, 2, GRAY);
  img.text(card.groupName.slice(0, 34), pad, 48, 3, DARK);
  img.text(card.tag, pad, 84, 2, GRAY);

  // QR top-right (rental deep link) rendered straight into the canvas.
  const qrSize = 120;
  const qr = QRCode.create(`rental:${card.rentalId}`, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const dataBits = qr.modules.data;
  const cell = Math.max(1, Math.floor(qrSize / size));
  const qrX = W - pad - cell * size;
  const qrY = 20;
  const label = "scan to open";
  img.text(label, qrX + (cell * size - img.textWidth(label, 1)) / 2, qrY + cell * size + 8, 1, GRAY);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (dataBits[r * size + c]) img.rect(qrX + c * cell, qrY + r * cell, cell, cell, [0, 0, 0]);
    }
  }

  const rows: [string, string][] = [
    ["Student", card.holderName],
    ...(card.studentId ? ([["Student ID", card.studentId]] as [string, string][]) : []),
    ["Status", card.statusLabel],
    ["Requested", fmt(card.requestedAt)],
    ["Approved", fmt(card.decidedAt ?? card.pickedUpAt)],
    ["Returned", fmt(card.returnedAt)],
    ...(card.projectName ? ([["Project", card.projectName]] as [string, string][]) : []),
    ...(card.conditionReport ? ([["Condition", card.conditionReport]] as [string, string][]) : []),
  ];
  let y = 180;
  for (const [k, val] of rows) {
    img.text(k, pad, y, S, GRAY);
    img.text(String(val).slice(0, 44), pad + 150, y, S, DARK);
    img.rect(pad, y + 20, W - pad * 2, 1, LIGHT);
    y += 40;
    if (y > H - 24) break;
  }

  return encodePng(W, H, img.data);
}

/**
 * Internal action: read the Telegram config, render the card PNG and post it
 * to the club group with `sendDocument` (documents are not recompressed, so
 * the card stays printable). No-op without a bot token configured.
 */
export const sendRentCardToGroup = internalAction({
  args: {
    card: v.object({
      rentalId: v.string(),
      groupName: v.string(),
      tag: v.string(),
      holderName: v.string(),
      studentId: v.optional(v.string()),
      statusLabel: v.string(),
      requestedAt: v.optional(v.number()),
      decidedAt: v.optional(v.number()),
      pickedUpAt: v.optional(v.number()),
      returnedAt: v.optional(v.number()),
      conditionReport: v.optional(v.string()),
      projectName: v.optional(v.string()),
    }),
    caption: v.string(),
  },
  handler: async (ctx, { card, caption }) => {
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    const token: string = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) return { sent: false, reason: "no-bot-token" };
    const groupChatId: string = cfg.clubGroupChatId || process.env.TELEGRAM_CHAT_ID || "";
    if (!groupChatId) return { sent: false, reason: "no-group-chat-id" };
    if (cfg.notificationsOn === false) return { sent: false, reason: "disabled-in-settings" };

    try {
      const png = await renderRentCardPng(card);
      const form = new FormData();
      form.append("chat_id", groupChatId);
      form.append("caption", caption.slice(0, 900));
      form.append(
        "document",
        new Blob([new Uint8Array(png)], { type: "image/png" }),
        `rent-card-${card.tag}.png`,
      );
      const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        console.warn(`[telegram] sendDocument failed: ${res.status}`);
        return { sent: false, reason: `http-${res.status}` };
      }
      return { sent: true };
    } catch (e) {
      console.warn("[telegram] rent card render/send failed", e);
      return { sent: false, reason: "render-error" };
    }
  },
});
