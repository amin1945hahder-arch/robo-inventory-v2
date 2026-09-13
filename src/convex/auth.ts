// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { emailOtp } from "./auth/emailOtp";
import { deviceAuth } from "./auth/deviceAuth";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [emailOtp, Anonymous, deviceAuth],
  // Long-lived sessions: members should not be thrown back to the login page
  // after a couple of weeks. The device quick sign-in covers re-auth anyway.
  session: {
    totalDurationMs: 365 * 24 * 60 * 60 * 1000, // 1 year
    inactiveDurationMs: 365 * 24 * 60 * 60 * 1000, // 1 year
  },
});