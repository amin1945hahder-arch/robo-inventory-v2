/**
 * The Turso-backed function registry.
 *
 * Keys are `module/function` — the exact id `useOfflineQuery` derives from a
 * Convex function reference's url (`apiUrl/module/name`). A function listed
 * here has been CONVERTED from a Convex `query`/`mutation` into an ACTION that
 * reads/writes Turso, so the frontend dispatch routes it through
 * `useAction` / a `useAction`-backed mutation instead of `useQuery` /
 * `useMutation`, and refreshes it off the `head:tursoHeads` mirror rather than
 * the Convex subscription.
 *
 * Deliberately a build-time constant set, not a runtime probe: the whole point
 * is that the read/write route is decided statically, so a page never has to
 * discover at runtime whether its data lives in Turso.
 *
 * The registry contains only functions already converted to Turso-backed
 * actions. Unlisted functions keep their existing Convex path.
 */
export const TURSO_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  // Converted reads (Turso-backed actions):
  "labels/getLabelData",
  "lookup/resolve",
  "stats/groupStats",
  "stats/overview",
  "exportData/inventory",
  "exportData/rentals",
  "exportData/people",
  "exportData/projects",
  "exportData/storages",
  "exportData/units",
  "reports/history",
  "reports/stats",
  
  "catalog/listClosets",
  "catalog/getCloset",
  "catalog/listCategories",
  "catalog/listGroups",
  "catalog/getGroup",
  "catalog/childGroupOptions",
  "catalog/consumptionLog",
  "projects/listProjects",
  "projects/getProject",
  "notifications/listNotifications",
  "notifications/unreadCount",
  "notifications/listProfileRequests",
  "notifications/myPendingProfileRequest",
  "notifications/listPeople",
  // settings reads (Turso-backed actions):
  "settings/getCardLayout",
  "settings/getMySounds",
  "settings/getMyAppearance",
  "settings/getMyFont",
  "settings/getSounds",
  "settings/getTelegram",
  "settings/getReturnCooldown",
  "telegramTopics/listTopics",
  "appThemes/get",
  "appBackup/getBackupSettings",
  "projectReadme/get",
  "projectReadme/getRequest",
  "projectReadme/history",
  "projectReadme/pendingAll",
  "projectWorkspace/listSummaries",
  "projectWorkspace/workspace",
  "bulk/historyStats",
  "bulk/seenForKeys",
  "bulk/allSeenKeys",
  "printing/listPrinters",
  "printing/listFilaments",
  "printing/listJobs",
  "printing/farmStats",
  // parts reads (Turso-backed actions):
  "parts/listPartsOfGroup",
  "parts/rentalsOfPart",
  "parts/listPartsByGroups",
  "parts/availabilityByGroup",
  "parts/getPart",
  "parts/getPartWithRental",
  "parts/getPartByTag",
  "parts/listMyRentals",
  "parts/myRequestCounts",
  "parts/listAllRentals",
  "parts/pendingRentalRows",
  "parts/listPackages",
  "parts/holdingOfPart",
  "parts/getPackage",
  "parts/scheduledPickups",
  // users reads (Turso-backed actions). `users.currentUser` deliberately
  // STAYS on Convex — it is the auth identity every gate resolves through.
  "users/listPeopleLite",
  "users/getPersonCard",
  "users/listRankRequests",
  "users/myPendingRankRequest",
  "users/listPrinterRequests",
  "users/myPendingPrinterRequest",
  "users/listInventoryRequests",
  "users/myPendingInventoryRequest",
  "users/myInventoryAccess",
  "users/listUnapprovedProfiles",
]);

/** Is this `module/function` id Turso-backed (i.e. an action now)? */
export function isTursoFunction(name: string): boolean {
  return TURSO_FUNCTIONS.has(name);
}

/**
 * WRITE-side registry: Convex `mutation`s that have been converted into
 * Turso-backed ACTIONS.
 *
 * Kept separate from {@link TURSO_FUNCTIONS} on purpose. Reads and writes are
 * dispatched by DIFFERENT hooks with different contracts — `useOfflineQuery`
 * takes a ref and returns data, `useOfflineMutation` takes a ref and returns a
 * callable — and mixing them in one set would let a read ref reach the write
 * hook. A function may legitimately appear in both (a module whose reads and
 * writes both moved), so the two sets are independent, not exclusive.
 *
 * A converted write is invisible to Convex reactivity: it lands in Turso, so no
 * Convex subscription fires. That is why `useOfflineMutation` bumps the data
 * bus on success — it has to stand in for the subscription the old mutation
 * used to trigger.
 */
export const TURSO_WRITES: ReadonlySet<string> = new Set<string>([
  "appThemes/save",
  "appThemes/remove",
  "appThemes/setActive",
  "appThemes/setDefault",
  "appThemes/setSchedule",
]);

/** Is this `module/function` id a converted (Turso-backed) write? */
export function isTursoWrite(name: string): boolean {
  return TURSO_WRITES.has(name);
}

/** Shared `module/function` derivation from a Convex function reference url. */
export function functionNameOf(fn: unknown): string {
  const url = (fn as { url?: string } | undefined)?.url;
  if (typeof url !== "string") return "unknown";
  const parts = url.split("/");
  // apiUrl: "https://host/api/v1", then module, then function name.
  return `${parts[parts.length - 2] ?? "?"}/${parts[parts.length - 1] ?? "?"}`;
}
