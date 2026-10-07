/**
 * Dev-bundle staleness guard.
 *
 * Why this exists: the preview dev server is not allowed to hot-update the
 * open page, so the browser keeps running the module graph it loaded at
 * startup. Two symptoms follow, and both used to require a manual refresh:
 *
 *  1. You change a file, navigate to a route that was already imported, and
 *     the OLD page renders — the app looks frozen even though the code on
 *     disk is new.
 *  2. A lazy route chunk is fetched fresh while everything else is stale. The
 *     mixed old/new graph can fail to evaluate, the dynamic import rejects,
 *     and the page dead-ends on an error panel with nothing to click.
 *
 * So: watch the dev server for a changed entry module and reload once when it
 * changes, and treat a failed dynamic import as "reload me". Both are guarded
 * to fire at most once per load, and a watcher that cannot reach the server
 * never reloads (a blank preview is worse than a stale one).
 *
 * Nothing here runs in a production build.
 */

/** Vite/Chrome wording for "the lazy chunk could not be loaded". */
const DYNAMIC_IMPORT_ERRORS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "failed to load module script",
];

export function isDynamicImportFailure(message: string): boolean {
  const m = message.toLowerCase();
  return DYNAMIC_IMPORT_ERRORS.some((needle) => m.includes(needle));
}

/** FNV-1a over module text — cheap, stable, and only ever compared to itself. */
export function moduleFingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}:${text.length}`;
}

export type WatcherOptions = {
  /** Returns the module text, or null when it cannot be read. */
  load: () => Promise<string | null>;
  reload: () => void;
  intervalMs?: number;
  /** How long a new fingerprint must hold before reloading (avoids reloading
   *  mid-edit, while a file is being written in pieces). */
  settleMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  onReload?: (reason: "stale-bundle") => void;
};

export type Watcher = {
  start: () => void;
  stop: () => void;
  /** One poll — exposed so tests do not need timers. */
  check: () => Promise<"skipped" | "baseline" | "unchanged" | "reloading">;
  reloaded: () => boolean;
};

/**
 * Polls for a changed entry module and reloads exactly once.
 *
 * Null responses (offline, dev server down, non-dev host) are ignored, so this
 * can never turn a transient hiccup into a reload loop.
 */
export function createStaleWatcher(opts: WatcherOptions): Watcher {
  const intervalMs = opts.intervalMs ?? 3000;
  const settleMs = opts.settleMs ?? 1200;
  const now = opts.now ?? (() => Date.now());
  const schedule =
    opts.schedule ??
    ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const cancel = opts.cancel ?? ((h: unknown) => clearTimeout(h as never));

  let baseline: string | null = null;
  let pending: { fingerprint: string; since: number } | null = null;
  let handle: unknown = null;
  let running = false;
  let didReload = false;

  async function check(): Promise<"skipped" | "baseline" | "unchanged" | "reloading"> {
    if (didReload) return "skipped";
    let text: string | null = null;
    try {
      text = await opts.load();
    } catch {
      return "skipped"; // never reload because a poll failed
    }
    if (text === null || text === "") return "skipped";

    const fingerprint = moduleFingerprint(text);
    if (baseline === null) {
      baseline = fingerprint;
      return "baseline";
    }
    if (fingerprint === baseline) {
      pending = null;
      return "unchanged";
    }

    // Different from baseline: only reload once it has held steady, so a file
    // being written in several chunks does not trigger a reload per chunk.
    if (!pending || pending.fingerprint !== fingerprint) {
      pending = { fingerprint, since: now() };
      return "unchanged";
    }
    if (now() - pending.since < settleMs) return "unchanged";

    didReload = true;
    opts.onReload?.("stale-bundle");
    opts.reload();
    return "reloading";
  }

  function tick() {
    handle = schedule(() => {
      void check().then(() => {
        if (running && !didReload) tick();
      });
    }, intervalMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      void check();
      tick();
    },
    stop() {
      running = false;
      if (handle !== null) cancel(handle);
      handle = null;
    },
    check,
    reloaded: () => didReload,
  };
}

/**
 * Reload once when a dynamic import fails, which means the page is running a
 * stale module graph. Guarded by sessionStorage so a genuinely broken chunk
 * cannot become a reload loop.
 */
export function installDynamicImportRecovery(
  reload: () => void,
  storageKey = "rc.importRecovery",
): () => void {
  let fired = false;
  const onError = (event: ErrorEvent) => {
    if (fired) return;
    const message =
      (event as ErrorEvent).message ??
      (event.error instanceof Error ? event.error.message : "");
    if (!isDynamicImportFailure(String(message))) return;
    try {
      if (window.sessionStorage.getItem(storageKey)) return;
      window.sessionStorage.setItem(storageKey, String(Date.now()));
    } catch {
      /* storage unavailable — the in-memory flag still prevents a loop */
    }
    fired = true;
    reload();
  };
  window.addEventListener("error", onError);
  return () => window.removeEventListener("error", onError);
}