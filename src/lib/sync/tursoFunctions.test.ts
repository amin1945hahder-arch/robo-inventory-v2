import { describe, expect, it } from "vitest";
import {
  TURSO_FUNCTIONS,
  TURSO_WRITES,
  isTursoFunction,
  isTursoWrite,
} from "./tursoFunctions";

/**
 * A Convex `query()` / `action()` / `mutation()` export carries its own kind as
 * a flag on the function object (there is no `convex/server` type guard for it),
 * which is exactly what we need to assert on.
 */
type KindFlagged = { isQuery?: boolean; isAction?: boolean; isMutation?: boolean };

/**
 * Load a Convex module by its registry name. The registry key is exactly
 * `module/function`, so the module id is the same string minus the function.
 */
async function loadModule(module: string): Promise<Record<string, unknown>> {
  return (await import(`../../convex/${module}.ts`)) as Record<string, unknown>;
}

describe("Turso function registry", () => {
  it("reports unknown functions as Convex-backed", () => {
    expect(isTursoFunction("parts/listParts")).toBe(false);
    expect(isTursoFunction("")).toBe(false);
  });

  it("only ever holds `module/function` ids", () => {
    for (const name of TURSO_FUNCTIONS) {
      expect(name).toMatch(/^[A-Za-z0-9_]+\/[A-Za-z0-9_]+$/);
    }
  });

  it("is a no-op while empty (dispatch keeps the Convex path)", () => {
    // Safe to ship ahead of the conversion: an empty registry means every
    // call site stays on useQuery/useMutation.
    if (TURSO_FUNCTIONS.size === 0) {
      expect([...TURSO_FUNCTIONS]).toEqual([]);
    }
  });

  /**
   * THE invariant that makes the frontend dispatch safe.
   *
   * `useOfflineQuery` reads the registry and sends anything listed there
   * through `useAction` instead of `useQuery`. If a registered id were still a
   * Convex QUERY, the client would call `useAction` on a query reference and
   * the page would silently never resolve. So every single registered id must
   * be a real exported ACTION — checked against the actual modules, not the
   * registry's own bookkeeping.
   */
  it("every registered function really is an exported Convex action", async () => {
    const byModule = new Map<string, string[]>();
    for (const name of TURSO_FUNCTIONS) {
      const [module, fn] = name.split("/");
      byModule.set(module, [...(byModule.get(module) ?? []), fn]);
    }

    expect(byModule.size).toBeGreaterThan(0);

    for (const [module, fns] of byModule) {
      const mod = await loadModule(module);
      for (const fn of fns) {
        const value = mod[fn] as KindFlagged;
        expect(value, `${module}.${fn} is registered but not exported`).toBeDefined();
        expect(
          value.isAction,
          `${module}.${fn} is registered as Turso-backed but is NOT a Convex action`,
        ).toBe(true);
        expect(value.isQuery).toBeFalsy();
        expect(value.isMutation).toBeFalsy();
        expect(isTursoFunction(`${module}/${fn}`)).toBe(true);
      }
    }
  });

  it("every registered write really is an exported Convex action", async () => {
    for (const name of TURSO_WRITES) {
      const [module, fn] = name.split("/");
      const mod = await loadModule(module);
      const value = mod[fn] as KindFlagged;
      expect(value, `${module}.${fn} is registered but not exported`).toBeDefined();
      expect(value.isAction, `${module}.${fn} is registered but is not an action`).toBe(true);
      expect(value.isQuery).toBeFalsy();
      expect(value.isMutation).toBeFalsy();
      expect(isTursoWrite(name)).toBe(true);
    }
  });
});