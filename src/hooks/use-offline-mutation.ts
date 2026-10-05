/**
 * useOfflineMutation — the write-side twin of `useOfflineQuery`.
 *
 * WHY it exists
 * -------------
 * Converting a data function from a `mutation` to a Turso-backed `action`
 * changes how the client must CALL it: `useAction`, not `useMutation`. Doing
 * that at every one of the ~150 call sites by hand would be a silent,
 * page-by-page migration hazard — a missed site fails at runtime with a type
 * error deep in Convex's client. This hook dispatches on the same kind of
 * static registry the read side uses, so a call site can be switched once and
 * never has to think about which backend the function lives on.
 *
 *   const save = useOfflineMutation(api.foo.save);   // mutation OR action
 *   await save({ ... });                             // identical either way
 *
 * THE DIFFERENCE THAT MATTERS — reactivity
 * -----------------------------------------
 * A Convex mutation is reactive: writing invalidates the subscriptions that
 * read those tables, and every mounted `useQuery` refetches by itself. A
 * Turso-backed action is NOT: it writes straight to Turso, so no Convex
 * subscription ever fires and the UI would happily keep showing stale rows.
 *
 * So the Turso branch does the invalidation itself: after a successful write it
 * bumps the shared data-sync bus, which every mounted `useOfflineQuery` is
 * already listening to (that bus is the same interrupt path a reconnect uses).
 * The server-side half of the same signal is `publishTouchedHeads`, which the
 * write action calls so OTHER devices refetch too — the bus only covers this
 * one tab.
 *
 * The Convex branch is deliberately UNCHANGED (same function, no wrapping) so
 * the ~140 not-yet-converted mutations keep their exact current behaviour,
 * including the reactivity the subscription already provides. Bumping the bus
 * there as well would be harmless but would add a pointless extra revalidation
 * on every write.
 */
import { useCallback } from "react";
import { useAction as useConvexAction, useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { bumpDataSync } from "@/lib/sync/bus";
import { functionNameOf, isTursoWrite } from "@/lib/sync/tursoFunctions";

/** A write reference this hook accepts: still a Convex mutation, or a converted action. */
type MutationOrActionRef = FunctionReference<"mutation"> | FunctionReference<"action">;

export function useOfflineMutation<M extends FunctionReference<"mutation">>(
  fn: M,
): (args: FunctionArgs<M>) => Promise<FunctionReturnType<M>>;
export function useOfflineMutation<A extends FunctionReference<"action">>(
  fn: A,
): (args: FunctionArgs<A>) => Promise<FunctionReturnType<A>>;
export function useOfflineMutation(
  fn: MutationOrActionRef,
): (args: never) => Promise<unknown> {
  // Both hooks are called unconditionally on every render: the registry is a
  // build-time constant and call sites pass a literal ref, so which branch runs
  // never changes for a given call site and hook order stays stable.
  const runMutation = useMutation(fn as FunctionReference<"mutation">);
  const runAction = useConvexAction(fn as FunctionReference<"action">);

  const converted = isTursoWrite(functionNameOf(fn));

  return useCallback(
    async (args: never) => {
      if (!converted) return runMutation(args);
      const result = await runAction(args);
      // Only reached on SUCCESS — a rejected write throws before this line, and
      // a failed write changed nothing, so invalidating would only cost reads
      // against the free-plan budget.
      bumpDataSync();
      return result;
    },
    [converted, runMutation, runAction],
  );
}