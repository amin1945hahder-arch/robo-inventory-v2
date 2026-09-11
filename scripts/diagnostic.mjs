import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const url = process.env.VITE_CONVEX_URL || "https://tacit-spoonbill-952.convex.cloud";

const probes = ["userImageSizes", "cachedListAllRentals"];

async function main() {
  const client = new ConvexHttpClient(url);
  for (const which of probes) {
    try {
      const res = await client.query(anyApi.diagnostic.probe, { which });
      console.log(`${which}: ${JSON.stringify(res)}`);
    } catch (e) {
      console.log(`${which}: FAILED — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main();
