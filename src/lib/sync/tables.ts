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
