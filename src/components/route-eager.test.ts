// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Route components must stay EAGERLY imported.
 *
 * With <Suspense> above <Routes>, a route that is still fetching its code
 * leaves React rendering the PREVIOUS page — the documented behaviour of a
 * suspended transition. A chunk request that stalls therefore freezes the app
 * on the old page: the URL changes, the content does not, and only a browser
 * refresh recovers. That was a real, repeatedly-reported glitch.
 *
 * A source-level guard is the right tool here: the failure is about WHICH
 * modules are dynamic, which no DOM test can observe, and re-introducing
 * `lazy(() => import("./pages/..."))` is otherwise an invisible optimisation.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mainSrc = readFileSync(path.join(root, "src/main.tsx"), "utf8");

describe("route loading policy", () => {
  it("imports every page statically instead of lazily", () => {
    const dynamic = mainSrc.match(/lazy\(\s*\(\)\s*=>\s*import\(/g) ?? [];
    expect(dynamic).toEqual([]);
    expect(mainSrc).not.toMatch(/import\("\.\/pages\//);
  });

  it("eagerly imports every page in src/pages", () => {
    const imported = new Set(
      [...mainSrc.matchAll(/^import\s+\w+\s+from\s+"\.\/pages\/(\w+)";$/gm)].map(
        (m) => m[1],
      ),
    );
    const onDisk = readdirSync(path.join(root, "src/pages"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => f.replace(/\.tsx$/, ""))
      .sort();
    expect(onDisk.length).toBeGreaterThan(20);
    // Nothing on disk may be missing a route import.
    const missing = onDisk.filter((p) => !imported.has(p));
    expect(missing).toEqual([]);
  });

  it("still wraps routes in a Suspense boundary (guards nested suspensions)", () => {
    expect(mainSrc).toContain("<Suspense fallback={<RouteLoading />}>");
    // …but it is no longer load-bearing for navigation itself.
    expect(mainSrc).toContain("<PageErrorBoundary resetKey={location.pathname}>");
  });
});