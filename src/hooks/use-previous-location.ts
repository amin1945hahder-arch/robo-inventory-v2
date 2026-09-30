import { useRef } from "react";
import { useLocation } from "react-router";

export type PreviousLocation = {
  pathname: string;
  search: string;
} | null;

/**
 * The location the user was on BEFORE the current one — read it with
 * usePreviousLocation(). Detail pages use it for a truthful back button
 * ("return to where I actually was": the storage page, the container, the
 * inventory with its filters) instead of hardcoding a parent route.
 *
 * Kept in a module ref written by a shared <PreviousLocationTracker /> mounted
 * in the router layout BEFORE the routed page, so by the time a page renders,
 * the value already points at the screen that led to it. null = the page was
 * opened directly (fresh tab, QR deep link) — callers fall back to their
 * default parent.
 */
const prevRef: { current: PreviousLocation } = { current: null };
const lastRef: { current: (PreviousLocation & { key: string }) | null } = { current: null };

export function usePreviousLocation(): PreviousLocation {
  return prevRef.current;
}

/** Mounted ONCE (router layout, before the routes): tracks navigation. */
export function PreviousLocationTracker() {
  const location = useLocation();
  // Promote during render (not in an effect): the routed page renders after
  // this sibling and must already see the previous location. Guarded by the
  // location key so it runs exactly once per navigation — idempotent.
  if (lastRef.current === null || lastRef.current.key !== location.key) {
    const last = lastRef.current;
    prevRef.current = last ? { pathname: last.pathname, search: last.search } : null;
    lastRef.current = { pathname: location.pathname, search: location.search, key: location.key };
  }
  return null;
}
