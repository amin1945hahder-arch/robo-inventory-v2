/**
 * Client-side mirror of convex/sync.ts SYNC_TABLES (kept as a separate tiny
 * module so the hook never imports server code — the convex file pulls in
 * the db handle and auth helpers, which must stay out of the bundle).
 */
export const SYNC_TABLES = [
  "users",
  "closets",
  "categories",
  "groups",
  "parts",
  "projects",
  "rentalPackages",
  "rentals",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

/**
 * Tombstone retention window, mirrored from convex/sync.ts
 * TOMBSTONE_RETENTION_MS. A cursor older than the oldest surviving tombstone
 * (or older than this window) must full-resync — deletes may have been pruned
 * while the client was offline.
 */
export const TOMBSTONE_RETENTION_MS = 90 * 24 * 36e5;
