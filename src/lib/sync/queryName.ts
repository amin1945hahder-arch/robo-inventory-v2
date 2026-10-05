/**
 * Resolve the "module/function" identifier for a Convex function reference.
 *
 * Why this is not a one-liner on `query.url`: Convex function references
 * (`api.notifications.listPeople`) are Proxies that carry their name only under
 * the global `functionName` symbol — they have NO `url` property. Reading
 * `.url` therefore returned `undefined` for every reference, so EVERY query
 * collapsed onto the single cache key `<user>|unknown|<args>`.
 *
 * The consequence was severe: a page expecting an array (e.g. the People list)
 * would hydrate from whatever another query last cached under that shared key —
 * often an object such as `stats.overview` — and crash with
 * `TypeError: (peopleRaw ?? []) is not iterable` inside a `useMemo`, blanking
 * the route. It only reproduced on a device with a populated cache, so a fresh
 * preview looked fine while the deployed app broke on every navigation.
 *
 * `getFunctionName` is the supported accessor for the real reference shape and
 * returns `"module:function"`, normalized here to `"module/function"`.
 */
import { getFunctionName } from "convex/server";

export function queryNameOf(query: unknown): string {
  try {
    const name = getFunctionName(query as Parameters<typeof getFunctionName>[0]);
    return name.replace(":", "/");
  } catch {
    // Not a function reference (or a component reference): keep the cache
    // scoped rather than throwing from a render-path helper.
    return "unknown";
  }
}
