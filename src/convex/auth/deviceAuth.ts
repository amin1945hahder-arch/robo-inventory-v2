import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import type { ConvexCredentialsConfig } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import { DataModel } from "../_generated/dataModel";

/**
 * "Fast sign-in" provider.
 *
 * After the first successful email-code sign-in the client stores a random
 * device token in localStorage (plus the profile shown on the button). The
 * database only ever sees the token's SHA-256 hash (deviceTokens.tokenHash).
 *
 * signIn("device", { token }) exchanges that token for a normal session —
 * identical to the one the email flow creates — without any code/email.
 *
 * This file exports ONLY the provider (no Convex functions): Convex Auth
 * requires provider modules to stay free of api-type cycles. The token
 * management mutations live in src/convex/deviceTokens.ts.
 */

/** SHA-256 hex digest (WebCrypto — available in the Convex runtime). */
async function sha256Hex(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

// The explicit annotation breaks the type-inference cycle: the initializer
// references `internal`, whose type includes this module's own exports.
export const deviceAuth: ConvexCredentialsConfig = ConvexCredentials<DataModel>({
  id: "device",
  authorize: async (params, ctx) => {
    const token = typeof params.token === "string" ? params.token : undefined;
    if (!token) return null;
    const tokenHash = await sha256Hex(token);
    const row = await ctx.runQuery(internal.deviceTokenStore.findToken, {
      tokenHash,
    });
    if (!row) return null;
    await ctx.runMutation(internal.deviceTokenStore.touch, { id: row._id });
    return { userId: row.userId };
  },
});
