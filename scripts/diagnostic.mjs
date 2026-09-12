// ⚠️ TEMPORARY DIAGNOSTIC — DELETE AFTER USE ⚠️
// Usage: bun scripts/diagnostic.mjs [mode ...]
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const url = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL;
if (!url) {
  console.error("No Convex URL in env (VITE_CONVEX_URL / CONVEX_URL)");
  process.exit(1);
}

const modes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["partDetailSample", "exportRentals", "exportOthers", "myRentalsAllUsers"];

for (const which of modes) {
  const client = new ConvexHttpClient(url);
  try {
    const res = await client.query(anyApi.diagnostic.probe, { which });
    console.log(`✔ ${which}:`, JSON.stringify(res));
  } catch (e) {
    console.log(`✘ ${which}:`, e instanceof Error ? e.message : String(e));
  }
}
