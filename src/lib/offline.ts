/**
 * Offline mode core (no React — one source of truth for connectivity).
 *
 * - `isOffline()` is true when the browser reports no network OR the Convex
 *   websocket reports a disconnected backend (AppShell feeds that in via
 *   `setBackendConnected`). Both matter: a device can have Wi-Fi but no route
 *   to the backend, and the ws can drop while the OS still says "online".
 * - `attachOfflineGuard(client)` wraps ConvexReactClient.mutation/.action so
 *   EVERY write in the app is refused while offline with a clear toast and a
 *   rejected promise — nothing silently hangs or half-applies. Reads (reactive
 *   queries + the IndexedDB delta cache) are untouched, so cached data stays
 *   browsable offline and syncs incrementally on reconnect.
 * - `useOnline` (src/hooks/use-online.ts) subscribes via onConnectivityChange.
 */
import { toast } from "sonner";

export const OFFLINE_WRITE_MESSAGE =
  "You're offline — this change was canceled. Browsing saved data still works; try again once you're back online.";

type Listener = () => void;

const listeners = new Set<Listener>();

/** Optimistic until Convex reports otherwise (set by AppShell's connection state). */
let backendConnected = true;

function notify(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a broken listener never breaks the others */
    }
  });
}

let windowHooksInstalled = false;
function ensureWindowHooks(): void {
  if (windowHooksInstalled || typeof window === "undefined") return;
  windowHooksInstalled = true;
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
}

/** True when the app cannot reach the backend right now. */
export function isOffline(): boolean {
  ensureWindowHooks();
  if (typeof navigator === "undefined") return false;
  if (navigator.onLine === false) return true;
  return backendConnected === false;
}

export function getOnline(): boolean {
  return !isOffline();
}

/** AppShell reports the live Convex websocket state here. */
export function setBackendConnected(connected: boolean): void {
  const next = connected === true;
  if (next === backendConnected) return;
  backendConnected = next;
  notify();
}

/** Subscribe to any connectivity flip (browser events + backend state). */
export function onConnectivityChange(fn: Listener): () => void {
  ensureWindowHooks();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Throttle the block toast so a burst of clicks doesn't spam the screen.
let lastBlockToast = 0;

function blockOfflineToast(): void {
  const now = Date.now();
  if (now - lastBlockToast < 1500) return;
  lastBlockToast = now;
  toast.error(OFFLINE_WRITE_MESSAGE, { id: "roboshelf-offline-block", duration: 5000 });
}

/**
 * Wrap any async function so it refuses to run while offline. The rejection
 * flows into each call site's normal catch → its own error toast; we also
 * surface a deduplicated global toast so nothing feels silently dead.
 */
export function guardWrite<F extends (...args: never[]) => unknown>(fn: F): F {
  return function guard(this: unknown, ...args: Parameters<F>) {
    if (isOffline()) {
      blockOfflineToast();
      return Promise.reject(new Error(OFFLINE_WRITE_MESSAGE));
    }
    return (fn as unknown as (...a: unknown[]) => unknown).apply(this, args) as ReturnType<F>;
  } as F;
}

/** Minimal structural type so the guard is unit-testable without Convex. */
export type WriteClient = {
  mutation: (...args: never[]) => Promise<unknown>;
  action: (...args: never[]) => Promise<unknown>;
};

/**
 * Patch a ConvexReactClient in place: mutations AND actions (all writes) are
 * guarded app-wide with this single call. Queries/watchers are not touched.
 */
export function attachOfflineGuard(client: WriteClient): void {
  const rawMutation = client.mutation.bind(client);
  const rawAction = client.action.bind(client);
  client.mutation = guardWrite(rawMutation) as unknown as typeof client.mutation;
  client.action = guardWrite(rawAction) as unknown as typeof client.action;
}
