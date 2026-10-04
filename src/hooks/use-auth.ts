import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";

/** The live user document shape (inferred from the query). */
type LiveUser = NonNullable<ReturnType<typeof useQuery<typeof api.users.currentUser>>>;

/**
 * Auth — works offline.
 *
 * The live `currentUser` query needs the backend, so on a cold offline open it
 * returns `undefined`. That used to mean `isLoading` stayed `true` forever and
 * the app never rendered — you couldn't even get INTO the app without a
 * connection, let alone read cached data.
 *
 * The fix is a locally persisted identity: the moment we know who the signed-in
 * user is, we write a minimal profile to localStorage. On any later boot we
 * read it back and can identify the member immediately, so:
 *  - the shell renders with the user's name/role instead of a spinner;
 *  - the offline query cache can be scoped to their id;
 *  - signing out clears it.
 *
 * The cached copy is deliberately small (id, name, email, role, avatar-ish
 * fields) — it is an identity hint, never a data source. When the network is
 * up, the live query value always wins.
 */

const USER_KEY = "roboshelf.authUser.v1";

/**
 * The persisted identity mirrors the live user document's shape. Deriving it
 * with `Partial<>` (instead of listing fields) means every property call site
 * keeps compiling against the real schema — no hand-maintained field list to
 * drift out of sync when a field is added.
 */
export type CachedUser = Partial<LiveUser> & { _id: LiveUser["_id"] };

/** Read the persisted identity (defensive: corrupt JSON → null). */
export function readCachedUser(): CachedUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedUser;
    return parsed && typeof parsed._id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: CachedUser | null): void {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable (private mode) — auth just won't survive a reload */
  }
}

/**
 * Shared identity store.
 *
 * The offline query cache needs the current user id to scope its keys, but it
 * is called from ~100 query hooks per page. Calling `useAuth()` in each one
 * would open ~100 duplicate `useConvexAuth` + `currentUser` subscriptions, so
 * the id is published here once and read without subscribing.
 *
 * `subscribeAuthUser` lets a hook re-scope its cache when the identity changes
 * (sign-in / sign-out) without re-querying anything.
 */
let currentAuthUser: CachedUser | null = readCachedUser();
const authUserListeners = new Set<(u: CachedUser | null) => void>();

export function publishAuthUser(user: CachedUser | null): void {
  if (currentAuthUser?._id === user?._id) return;
  currentAuthUser = user;
  authUserListeners.forEach((fn) => {
    try {
      fn(user);
    } catch {
      /* a broken listener never breaks the others */
    }
  });
}

export function subscribeAuthUser(fn: (u: CachedUser | null) => void): () => void {
  authUserListeners.add(fn);
  return () => {
    authUserListeners.delete(fn);
  };
}

/** Current identity, without subscribing to Convex. */
export function getAuthUserSync(): CachedUser | null {
  return currentAuthUser;
}

export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const liveUser = useQuery(api.users.currentUser);
  const { signIn, signOut } = useAuthActions();

  // Seeded synchronously from localStorage so the FIRST render (offline
  // included) already knows who this is — no spinner, no empty shell.
  const [cachedUser, setCachedUser] = useState<CachedUser | null>(readCachedUser);

  // Keep the persisted identity in step with the live record, and publish it to
  // the shared store so non-subscribing consumers (the offline query cache) see
  // the same identity without opening their own subscription.
  useEffect(() => {
    if (liveUser && typeof liveUser._id === "string") {
      setCachedUser((prev) => {
        const next: CachedUser = { ...liveUser, _id: liveUser._id };
        if (prev?._id !== next._id || prev?.role !== next.role) writeCachedUser(next);
        return next;
      });
      publishAuthUser({ ...liveUser, _id: liveUser._id });
    } else if (!liveUser && isAuthenticated === false) {
      // Signed out for real (not merely offline) → drop the identity.
      setCachedUser((prev) => {
        if (prev) writeCachedUser(null);
        return null;
      });
      publishAuthUser(null);
    } else {
      // Nothing live to go on yet (cold offline boot) — publish what we seeded
      // from localStorage so the shared store isn't empty.
      publishAuthUser(cachedUser);
    }
  }, [liveUser, isAuthenticated, cachedUser]);

  // The live record wins whenever we have it; otherwise the persisted copy
  // stands in. Either way `user` is defined for a returning member, which is
  // what keeps the shell out of its loading state while offline.
  const user = liveUser ?? cachedUser;

  // Only a genuinely unknown user (no live record AND nothing cached) is
  // "loading" — a cached identity means we can render immediately.
  const isLoading = isAuthLoading || (user === undefined && isAuthenticated !== false);

  return {
    isLoading,
    isAuthenticated: isAuthenticated || Boolean(cachedUser),
    user,
    signIn,
    signOut,
  };
}