/**
 * Card print-layout engine (client-safe).
 *
 * ONE source of truth for how a rent/badge card is placed on paper. Used by:
 *  - the Admin Settings preview (same renderer, scaled down),
 *  - window.print()  → injects @page size + positions [data-qr-label],
 *  - PDF download / Telegram send → maps the card raster onto the chosen page.
 *
 * The admin configures: page size (A4/A5/Letter/Legal/custom), card size in
 * mm, and the card's offset from the page's top-left. The card's aspect ratio
 * is NEVER distorted: the print pipeline scales the card to FIT the configured
 * box (letterboxing if needed), never to fill/stretch it.
 */

/** Typedef only — the real type lives in settings.ts (client imports type). */
export type CardPrintLayout = {
  pageSize: "A4" | "A5" | "Letter" | "Legal" | "custom";
  pageWidthMm: number;
  pageHeightMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
  offsetXmm: number;
  offsetYmm: number;
  printMode: "page" | "thermal";
  /** Printed QR size in millimetres (rent / package / badge cards). */
  qrMm: number;
};

/** CSS @page size keyword per preset (custom uses explicit mm). */
export function pageCssSize(l: CardPrintLayout): string {
  if (l.printMode === "thermal") return `${round(l.cardWidthMm)}mm ${round(l.cardHeightMm)}mm`;
  switch (l.pageSize) {
    case "A4":
      return "A4";
    case "A5":
      return "A5";
    case "Letter":
      return "letter";
    case "Legal":
      return "legal";
    case "custom":
      return `${round(l.pageWidthMm)}mm ${round(l.pageHeightMm)}mm`;
  }
}

/** Page dimensions in mm after mode/preset resolution. */
export function pageMm(l: CardPrintLayout): { w: number; h: number } {
  if (l.printMode === "thermal") return { w: l.cardWidthMm, h: l.cardHeightMm };
  switch (l.pageSize) {
    case "A4":
      return { w: 210, h: 297 };
    case "A5":
      return { w: 148, h: 210 };
    case "Letter":
      return { w: 215.9, h: 279.4 };
    case "Legal":
      return { w: 215.9, h: 355.6 };
    case "custom":
      return { w: l.pageWidthMm, h: l.pageHeightMm };
  }
}

/**
 * Fit `cardW × cardH` into the configured box without distortion.
 * Returns the placed size + offset (mm). If the card's ratio differs from
 * the configured box, it is centred inside it (letterbox) — never stretched.
 */
export function placedCardMm(
  l: CardPrintLayout,
  cardW: number,
  cardH: number,
): { x: number; y: number; w: number; h: number } {
  const page = pageMm(l);
  // Thermal: the page IS the card — ignore offsets, fill the roll width.
  const offX = l.printMode === "thermal" ? 0 : l.offsetXmm;
  const offY = l.printMode === "thermal" ? 0 : l.offsetYmm;
  const boxW = Math.min(l.cardWidthMm, Math.max(1, page.w - offX));
  const boxH = Math.min(l.cardHeightMm, Math.max(1, page.h - offY));
  const scale = Math.min(boxW / cardW, boxH / cardH); // fit, never stretch
  const w = cardW * scale;
  const h = cardH * scale;
  // Centre inside the configured box.
  const x = offX + (boxW - w) / 2;
  const y = offY + (boxH - h) / 2;
  return { x, y, w, h };
}

const MM_PER_PX = 25.4 / 96; // 96 dpi CSS reference

/** mm → CSS px (96dpi). */
export function mmToPx(mm: number): number {
  return mm / MM_PER_PX;
}

/**
 * Inject a dynamic <style id="card-print-layout"> that takes over printing:
 * @page size + margins 0, hide everything, then place ONLY the card element
 * (any [data-qr-label] — matched while it is inside #rent-card-sheet etc.)
 * at the configured position and size. Idempotent — safe to call per print.
 */
export function injectCardPrintCss(l: CardPrintLayout): void {
  const page = pageCssSize(l);
  // Scale factor: the on-screen card renders at its DOM size (px); we map it
  // to the configured mm box, preserving ratio.
  const el = document.getElementById("card-print-layout") ?? document.createElement("style");
  el.id = "card-print-layout";
  el.textContent = `
@media print {
  @page { size: ${page}; margin: 0; }
  body { background: white !important; }
  body * { visibility: hidden !important; }
  [data-qr-label], [data-qr-label] * { visibility: visible !important; }
  [data-qr-label] {
    position: fixed !important;
    left: 0 !important;
    top: 0 !important;
    margin: 0 !important;
    transform-origin: top left !important;
    transform: scale(var(--card-print-scale, 1)) !important;
    translate: var(--card-print-x, 0) var(--card-print-y, 0) !important;
    inset: auto !important;
    box-shadow: none !important;
  }
  [data-qr-label] * { color: black !important; }
}`;
  document.head.appendChild(el);
}

/**
 * Compute and set the CSS variables that position/scale the card for print.
 * Call right before window.print() with the live card element. Also pins the
 * element's measured size inline so global print rules (width: fit-content)
 * cannot re-flow the card between measurement and printing.
 */
export function prepareCardForPrint(l: CardPrintLayout, el: HTMLElement): void {
  const placed = placedCardMm(l, el.offsetWidth, el.offsetHeight);
  const x = mmToPx(placed.x);
  const y = mmToPx(placed.y);
  const scale = placed.w / Math.max(1, el.offsetWidth);
  // Exact QR size on paper (the on-screen size is only an approximation).
  (el as HTMLElement & { __cardQrRestore?: () => void }).__cardQrRestore = fitCardQr(
    el,
    l.qrMm ?? 0,
    scale,
  );
  // Pin the on-screen geometry so print styles can't shrink/re-wrap it.
  (el as HTMLElement & { __cardPrintPrev?: string }).__cardPrintPrev = el.getAttribute("style") ?? "";
  el.style.width = `${el.offsetWidth}px`;
  el.style.height = `${el.offsetHeight}px`;
  el.style.setProperty("--card-print-x", `${x}px`);
  el.style.setProperty("--card-print-y", `${y}px`);
  el.style.setProperty("--card-print-scale", `${scale}`);
  injectCardPrintCss(l);
}

/**
 * Resize the card's [data-card-qr] block so it prints at EXACTLY `qrMm`
 * millimetres. `mmPerPx` is the card's print scale (millimetres per CSS
 * pixel). Returns a restore function for the element's original style.
 */
export function fitCardQr(el: HTMLElement, qrMm: number, mmPerPx: number): () => void {
  const qr = el.querySelector<HTMLElement>("[data-card-qr]");
  if (!qr || !(qrMm > 0) || !(mmPerPx > 0)) return () => {};
  const prev = qr.getAttribute("style") ?? "";
  const px = qrMm / mmPerPx;
  qr.style.width = `${px}px`;
  qr.style.height = `${px}px`;
  return () => {
    if (prev === "") qr.removeAttribute("style");
    else qr.setAttribute("style", prev);
  };
}

/** fitCardQr pre-bound to a layout, measured from the live card element. */
export function fitCardQrForLayout(el: HTMLElement, l: CardPrintLayout): () => void {
  const placed = placedCardMm(l, el.offsetWidth, el.offsetHeight);
  return fitCardQr(el, l.qrMm ?? 0, placed.w / Math.max(1, el.offsetWidth));
}

/** Remove the injected print CSS + inline vars (after printing). */
export function cleanupCardPrint(el?: HTMLElement | null): void {
  document.getElementById("card-print-layout")?.remove();
  if (el) {
    const restoreQr = (el as HTMLElement & { __cardQrRestore?: () => void }).__cardQrRestore;
    if (restoreQr) {
      restoreQr();
      delete (el as HTMLElement & { __cardQrRestore?: () => void }).__cardQrRestore;
    }
    const holder = el as HTMLElement & { __cardPrintPrev?: string };
    el.style.removeProperty("width");
    el.style.removeProperty("height");
    el.style.removeProperty("--card-print-x");
    el.style.removeProperty("--card-print-y");
    el.style.removeProperty("--card-print-scale");
    if (holder.__cardPrintPrev !== undefined) {
      if (holder.__cardPrintPrev === "") el.removeAttribute("style");
      else el.setAttribute("style", holder.__cardPrintPrev);
      delete holder.__cardPrintPrev;
    }
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
