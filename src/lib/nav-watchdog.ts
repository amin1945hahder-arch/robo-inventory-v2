/**
 * Navigation watchdog — the guarantee that clicking a tab always ends with the
 * right page on screen.
 *
 * The app has had a recurring glitch where the URL changes but the old page
 * stays visible. Whatever the trigger was (a stale bundle, a suspended route,
 * an iframe quirk), the member should never have to notice it or reach for the
 * browser refresh. So instead of trusting the mechanism, this watches the
 * RESULT: after a navigation settles, compare the screen with the last screen
 * we know rendered, and escalate if nothing changed.
 *
 * Escalation is bounded and deliberate:
 *   wait    → the page rendered (or there was nothing to verify)
 *   remount → the route tree is stuck; rebuild it
 *   reload  → still stuck after MAX_STALL_REMOUNTS; a reload always recovers
 *
 * The subtlety that matters: the baseline is the last screen we CONFIRMED, not
 * the screen at the moment the effect ran. An effect fires after the new route
 * has already rendered, so capturing the baseline there would make every
 * healthy navigation look like a stall. Everything here is pure so the
 * escalation ladder can be tested without a DOM, a router, or timers.
 */

export const MAX_STALL_REMOUNTS = 3;

/** How long after a navigation we decide it has settled. */
export const SETTLE_MS = 700;

export type NavWatchState = {
  path: string;
  /** Fingerprint of the last screen known to have rendered. */
  settled: string;
  /** Consecutive settled checks that found nothing changed. */
  stalls: number;
  /** A baseline has been captured (false only on the very first render). */
  ready: boolean;
  /** There is a navigation in flight worth verifying. */
  armed: boolean;
};

export type NavAction = "wait" | "remount" | "reload";

export function initialState(): NavWatchState {
  return { path: "", settled: "", stalls: 0, ready: false, armed: false };
}

/**
 * A cheap fingerprint of the visible page. Length plus a sample of the text is
 * enough to notice "this is still the old page" without hashing megabytes.
 */
export function fingerprintFromText(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "empty";
  const head = t.slice(0, 400);
  return `${t.length}:${head}`;
}

/** Fingerprint whatever is currently rendered in the app's content region. */
export function fingerprintOf(doc: Document | null | undefined): string {
  const root = doc?.querySelector("main") ?? doc?.body;
  return fingerprintFromText(root?.textContent);
}

/**
 * Record a navigation.
 *
 * - First observation: just capture the baseline; there is nothing to verify.
 * - Path changed: arm the watchdog, KEEPING the previous baseline, because
 *   that is the screen the new page must differ from.
 * - Same path (e.g. the effect re-runs after a remount): change nothing, so
 *   the ladder can continue escalating.
 */
export function onNavigate(
  state: NavWatchState,
  path: string,
  print: string,
): NavWatchState {
  if (!state.ready) {
    return { path, settled: print, stalls: 0, ready: true, armed: false };
  }
  if (state.path !== path) {
    return { path, settled: state.settled, stalls: 0, ready: true, armed: true };
  }
  return state;
}

/**
 * Decide what to do once a navigation has had time to settle.
 *
 * A changed fingerprint means the page really did render; that becomes the new
 * baseline and disarms the watchdog until the next navigation.
 */
export function evaluate(
  state: NavWatchState,
  currentPrint: string,
): { action: NavAction; state: NavWatchState } {
  if (!state.armed) return { action: "wait", state };

  if (currentPrint !== state.settled) {
    return {
      action: "wait",
      state: { ...state, settled: currentPrint, stalls: 0, armed: false },
    };
  }

  const stalls = state.stalls + 1;
  const next = { ...state, stalls };
  return { action: stalls <= MAX_STALL_REMOUNTS ? "remount" : "reload", state: next };
}