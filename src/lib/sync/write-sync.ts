/**
 * Write-driven delta-sync invalidation.
 *
 * The reactive `sync.syncHead` subscription is the primary interrupt for the
 * delta-sync cache, but it alone is not a complete story:
 *
 *  - it can silently die (auth expiry, websocket blip mid-handshake) and
 *    until a pull failure re-arms it, nothing wakes that table;
 *  - it fires on the NEXT reactive update, not the instant a write commits;
 *  - another browser window of the same app shares the IndexedDB cache but
 *    has no channel to learn that a write happened (the head watch fires
 *    there too, but only via the same fragile path).
 *
 * This module closes those gaps: every synced-table mutation marks its
 * tables through `markWritten(table)`:
 *
 *  - same tab: mounted useCachedData hooks for that table pull a delta
 *    immediately (coalesced);
 *  - other tabs: a BroadcastChannel message (and a localStorage fallback)
 *    makes THEIR hooks pull immediately too — so two windows never show
 *    different data for longer than one delta pull.
 *
 * Pure + dependency-free so it is trivially unit-testable (see
 * write-sync.test.ts).
 */

type Listener = (table: string) => void;

const listeners = new Set<Listener>();

/** Tables whose writes should trigger cross-tab sync (mirrors SYNC_TABLES). */
const SYNC_TABLES: readonly string[] = [
  "users",
  "closets",
  "categories",
  "groups",
  "parts",
  "projects",
  "rentalPackages",
  "rentals",
];

const CHANNEL_NAME = "roboshelf-sync";
const STORAGE_KEY = "roboshelf.syncWrite";

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (ev: MessageEvent) => {
        const table = (ev.data as { table?: string } | null)?.table;
        if (typeof table === "string" && isSyncTable(table)) {
          notifyLocal(table);
        }
      };
    } catch {
      channel = null;
    }
  }
  return channel;
}

function isSyncTable(t: string): boolean {
  return SYNC_TABLES.includes(t);
}

function notifyLocal(table: string): void {
  for (const fn of listeners) {
    try {
      fn(table);
    } catch {
      /* a broken listener never breaks the bumper */
    }
  }
}

/**
 * Mark a table as written. Local listeners fire immediately; sibling tabs
 * are told via BroadcastChannel (localStorage fallback).
 */
export function markWritten(table: string): void {
  if (!isSyncTable(table)) return;
  notifyLocal(table);
  try {
    getChannel()?.postMessage({ table });
  } catch {
    /* channel closed — the head watch still covers this tab */
  }
  try {
    if (typeof localStorage !== "undefined") {
      // Storage events fire in OTHER tabs (never the writer), making this
      // the fallback cross-tab signal where BroadcastChannel is missing.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ table, at: Date.now() }));
    }
  } catch {
    /* private mode */
  }
}

/** Install the cross-tab receiver once (no-op on the server / tests). */
export function installWriteSyncReceiver(): void {
  if (typeof window === "undefined") return;
  getChannel();
  if (typeof window.addEventListener !== "function") return;
  window.addEventListener("storage", (ev: StorageEvent) => {
    if (ev.key !== STORAGE_KEY || !ev.newValue) return;
    try {
      const parsed = JSON.parse(ev.newValue) as { table?: string };
      if (typeof parsed.table === "string") notifyLocal(parsed.table);
    } catch {
      /* malformed payload — ignore */
    }
  });
}

/** Subscribe to write marks for one table (used by useCachedData). */
export function writeSyncListen(table: string, fn: () => void): () => void {
  const wrapper = (t: string) => {
    if (t === table) fn();
  };
  listeners.add(wrapper);
  return () => listeners.delete(wrapper);
}

/** Reset all state (tests). */
export function resetWriteSyncForTests(): void {
  listeners.clear();
  channel?.close();
  channel = null;
}
