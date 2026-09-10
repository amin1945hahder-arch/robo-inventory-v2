/**
 * Backend smoke test — verifies the dev deployment is healthy and that the
 * auth guards on the newly added functions are enforced.
 *
 * Without a signed-in session every requireUser/requireAdmin-guarded function
 * must reject with "Please sign in first". The id-less functions below prove
 * the guard wiring; id-taking mutations share the same requireUser helper
 * (Convex validates argument shapes before handlers run, so fake ids can't
 * reach the guard).
 *
 * Run: bun scripts/smoke.ts
 */
import { anyApi } from "convex/server";
import { ConvexClient } from "convex/browser";

const url = process.env.VITE_CONVEX_URL;
if (!url) {
  console.error("VITE_CONVEX_URL must be set (e.g. from .env.local)");
  process.exit(1);
}

const api = anyApi as any;
const client = new ConvexClient(url);

const results: { name: string; ok: boolean; note?: string }[] = [];
function record(name: string, ok: boolean, note?: string) {
  results.push({ name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${note ? ` — ${note}` : ""}`);
}

async function rejectsWith(fn: () => Promise<unknown>, needle: string): Promise<boolean> {
  try {
    await fn();
    return false; // expected a rejection, got success
  } catch (e: any) {
    return String(e?.message ?? e).includes(needle);
  }
}

async function main() {
  const guard = "sign in";

  // New member-side flow guarded correctly
  record(
    "users.requestRankUpgrade guarded",
    await rejectsWith(
      () => client.mutation(api.users.requestRankUpgrade, { requestedRoles: ["مدرب"] }),
      guard,
    ),
  );
  // New admin-side datasets guarded correctly
  record(
    "exportData.inventory admin-only",
    await rejectsWith(() => client.query(api.exportData.inventory, {}), guard),
  );
  record(
    "exportData.rentals admin-only",
    await rejectsWith(() => client.query(api.exportData.rentals, {}), guard),
  );
  record(
    "exportData.people admin-only",
    await rejectsWith(() => client.query(api.exportData.people, {}), guard),
  );
  record(
    "exportData.projects admin-only",
    await rejectsWith(() => client.query(api.exportData.projects, {}), guard),
  );
  record(
    "users.listRankRequests admin-only",
    await rejectsWith(() => client.query(api.users.listRankRequests, {}), guard),
  );
  record(
    "notifications.listPeople admin-only",
    await rejectsWith(() => client.query(api.notifications.listPeople, {}), guard),
  );

  await client.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error("SMOKE CRASHED:", e);
  process.exit(1);
});
