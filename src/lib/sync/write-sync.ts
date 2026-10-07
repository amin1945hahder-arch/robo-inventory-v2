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

/** Wildcard: a write whose exact table we could not attribute. */
export const ANY_TABLE = "*";

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (ev: MessageEvent) => {
        const table = (ev.data as { table?: string } | null)?.table;
        if (typeof table === "string") notifyLocal(table);
      };
    } catch {
      channel = null;
    }
  }
  return channel;
}

function isSyncTable(t: string): boolean {
  return t === ANY_TABLE || SYNC_TABLES.includes(t);
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

function broadcast(table: string): void {
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

/**
 * Mark a table as written. Local listeners fire immediately; sibling tabs
 * are told via BroadcastChannel (localStorage fallback).
 */
export function markWritten(table: string): void {
  if (!isSyncTable(table)) return;
  notifyLocal(table);
  broadcast(table);
}

/**
 * Mark an un-attributable write: every mounted table re-pulls a delta. Called
 * after ANY successful mutation, so a write in one browser window is visible
 * in every other window immediately instead of only when the server head
 * push happens to arrive. Deltas are small and pulls are coalesced, so the
 * breadth is cheap.
 */
export function markAnyWrite(): void {
  notifyLocal(ANY_TABLE);
  broadcast(ANY_TABLE);
}

let receiverInstalled = false;

/** Install the cross-tab receiver once (no-op on the server / tests). */
export function installWriteSyncReceiver(): void {
  if (receiverInstalled) return;
  if (typeof window === "undefined") return;
  getChannel();
  if (typeof window.addEventListener !== "function") return;
  receiverInstalled = true;
  window.addEventListener("storage", (ev: StorageEvent) => {
    if (ev.key !== STORAGE_KEY || !ev.newValue) return;
    try {
      const parsed = JSON.parse(ev.newValue) as { table?: string };
      if (typeof parsed.table === "string" && isSyncTable(parsed.table)) {
        notifyLocal(parsed.table);
      }
    } catch {
      /* malformed payload — ignore */
    }
  });
}

/** Subscribe to write marks for one table (used by useCachedData). */
export function writeSyncListen(table: string, fn: () => void): () => void {
  const wrapper = (t: string) => {
    if (t === table || t === ANY_TABLE) fn();
  };
  listeners.add(wrapper);
  return () => listeners.delete(wrapper);
}

/** Reset all state (tests). The installed storage receiver stays attached
 *  (it reads the live listener set), so re-installing is a no-op. */
export function resetWriteSyncForTests(): void {
  listeners.clear();
  channel?.close();
  channel = null;
}
