import { describe, expect, it } from "vitest";

// The one-way feature graph of CLAUDE.md ("Dependency rules"): each feature and the features it
// may import, always through their index.ts. The two change together, and a new feature needs a
// row here.
const FEATURE_DEPENDENCIES: Record<string, readonly string[]> = {
  workspace: [],
  results: [],
  documents: ["results", "transfer", "ai"],
  aggregation: ["results", "transfer"],
  indexes: [],
  ai: ["workspace"],
  collection: [
    "documents",
    "aggregation",
    "schema",
    "indexes",
    "changes",
    "connections",
    "workspace",
  ],
  shell: ["connections", "workspace"],
  backups: ["connections", "backup"],
  monitor: ["connections", "indexes", "workspace"],
  users: ["connections", "workspace"],
  settings: ["results", "documents", "updates", "ai", "diagram"],
  compare: ["results"],
  diagram: ["connections", "workspace"],
  queries: ["aggregation", "connections", "documents", "workspace"],
  connections: ["workspace", "backup", "transfer", "compare"],
  backup: [],
  transfer: [],
  schema: [],
  changes: [],
  updates: [],
  "perf-lab": [],
};

// Static and side-effect imports, `export ... from`, dynamic `import()`, and the module paths
// given to vi.mock, vi.doMock, vi.importActual, vi.importMock and import.meta.glob, quoted or in
// a template literal. Not seen: a specifier built at run time (a variable, a template with `${`),
// any glob pattern after the first of an array, a glob with a wildcard (it names no single
// module), a vi.mock given `import(...)`, which counts as a dynamic import, and an `import(...)`
// inside a type argument (`vi.importActual<typeof import("x")>(...)`), which the type argument
// swallows.
const IMPORT =
  /\b(from|import|vi\.(?:mock|doMock|importActual|importMock)|import\.meta\.glob)\s*(?:<.*?>\s*)?(\(\s*)?(?:\[\s*)?(["'`])((?:(?!\3)[^$\n])+)\3/g;

interface Import {
  specifier: string;
  // `import()`, the one form src/app may use to reach inside a feature.
  dynamic: boolean;
}

function importsOf(source: string): Import[] {
  return [...source.matchAll(IMPORT)].flatMap(([, keyword, call, , specifier = ""]) =>
    keyword === "import.meta.glob" && /[*!]/.test(specifier)
      ? []
      : [{ specifier, dynamic: keyword === "import" && call !== undefined }],
  );
}

interface Place {
  // `features/<name>` for a feature, otherwise the folder directly under src/; "" for a file
  // directly under src/ (main.tsx), whose subtree is all of src/.
  area: string;
  feature: string | undefined;
  // The path inside the feature: "" or "index.ts" is its public entry.
  rest: string;
}

function locate(path: string): Place {
  const segments = path.split("/");
  const [top = "", name = "", ...rest] = segments;
  if (top === "features") return { area: `features/${name}`, feature: name, rest: rest.join("/") };
  return { area: segments.length > 1 ? top : "", feature: undefined, rest: "" };
}

// The src-relative path an import points to, or undefined for a package. URL resolution folds
// the `./` and `../` segments; a path climbing out of src/ keeps its leading slash.
function resolve(from: string, specifier: string): string | undefined {
  const bare = specifier.replace(/\?.*$/, "");
  const relative = bare.startsWith("@/") ? `/src/${bare.slice(2)}` : bare;
  if (!relative.startsWith(".") && !relative.startsWith("/")) return undefined;
  return new URL(relative, `file:///src/${from}`).pathname.replace(/^\/src\//, "");
}

function isPublicEntry(rest: string): boolean {
  return /^(index(\.tsx?)?)?$/.test(rest);
}

function violation(from: string, specifier: string, dynamic: boolean): string | undefined {
  const target = resolve(from, specifier);
  if (target === undefined) return undefined;
  const source = locate(from);
  const dest = locate(target);
  if (specifier.startsWith(".") && source.area !== "" && source.area !== dest.area) {
    return "a relative import leaves its folder subtree: use the @/ alias";
  }
  if (dest.feature === undefined || dest.feature === source.feature) return undefined;

  if (source.feature !== undefined) {
    if (!FEATURE_DEPENDENCIES[source.feature]?.includes(dest.feature)) {
      return `${source.feature} may not depend on ${dest.feature} (see FEATURE_DEPENDENCIES)`;
    }
    return isPublicEntry(dest.rest)
      ? undefined
      : `reaches inside ${dest.feature}: import from @/features/${dest.feature}`;
  }
  if (source.area === "app") {
    // The composition root may lazy-load a feature's page, so it lands in a chunk of its own.
    return isPublicEntry(dest.rest) || dynamic
      ? undefined
      : `reaches inside ${dest.feature}: import from @/features/${dest.feature}, or lazy-load it with import()`;
  }
  // The one place that registers every feature's translations.
  if (from === "lib/i18n.ts" && /^locales\/[a-z]+\.json$/.test(dest.rest)) return undefined;
  return "shared code knows no feature; only src/app wires them together";
}

function checkImports(files: Record<string, string>): string[] {
  return Object.entries(files).flatMap(([path, source]) =>
    importsOf(source).flatMap(({ specifier, dynamic }) => {
      const reason = violation(path, specifier, dynamic);
      return reason === undefined ? [] : [`${path}: "${specifier}": ${reason}`];
    }),
  );
}

function crossFeatureImports(files: Record<string, string>): number {
  return Object.entries(files).reduce((count, [path, source]) => {
    const own = locate(path).feature;
    const others = importsOf(source).filter(({ specifier }) => {
      const target = resolve(path, specifier);
      const feature = target === undefined ? undefined : locate(target).feature;
      return own !== undefined && feature !== undefined && feature !== own;
    });
    return count + others.length;
  }, 0);
}

function hasCycle(graph: Record<string, readonly string[]>): boolean {
  const visit = (node: string, trail: readonly string[]): boolean =>
    trail.includes(node) || (graph[node] ?? []).some((next) => visit(next, [...trail, node]));
  return Object.keys(graph).some((node) => visit(node, []));
}

// Vitest's on-disk module cache can keep an old file list: locally, a brand-new file may be
// missed until `vitest --clearCache`.
const sources = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(["../**/*.{ts,tsx}", "!./feature-boundaries.test.ts"], {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([path, source]) => [path.replace(/^\.\//, "app/").replace(/^\.\.\//, ""), source]),
);

describe("feature boundaries", () => {
  it("reads the source tree", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(200);
    expect(crossFeatureImports(sources)).toBeGreaterThan(50);
  });

  it("has a row for every feature, and only for features", () => {
    const features = new Set(Object.keys(sources).flatMap((path) => locate(path).feature ?? []));
    expect(Object.keys(FEATURE_DEPENDENCIES).sort()).toEqual([...features].sort());
  });

  it("keeps the feature graph one-way", () => {
    expect(hasCycle(FEATURE_DEPENDENCIES)).toBe(false);
  });

  it("finds no import across a boundary", () => {
    expect(checkImports(sources)).toEqual([]);
  });
});

describe("the boundary check", () => {
  it.each([
    [
      "a module inside another feature",
      { "features/documents/components/a.tsx": 'import { x } from "@/features/results/lib/y";' },
      "reaches inside results",
    ],
    [
      "a dynamic import inside another feature",
      { "features/documents/a.ts": 'const m = await import("@/features/results/lib/y");' },
      "reaches inside results",
    ],
    [
      "a dynamic import in a template literal",
      { "features/documents/a.ts": "const m = await import(`@/features/results/lib/y`);" },
      "reaches inside results",
    ],
    [
      "a vi.mock of another feature's module",
      { "features/documents/a.test.ts": 'vi.mock("@/features/results/lib/y", () => ({}));' },
      "reaches inside results",
    ],
    [
      "a vi.doMock in a template literal",
      { "features/documents/a.test.ts": "vi.doMock(`@/features/results/lib/y`);" },
      "reaches inside results",
    ],
    [
      "a vi.importActual against the graph",
      {
        "features/results/a.test.ts":
          'const m = await vi.importActual<Record<string, unknown>>("@/features/documents");',
      },
      "results may not depend on documents",
    ],
    [
      "a vi.importMock of another feature's module",
      { "features/documents/a.test.ts": 'await vi.importMock("@/features/results/lib/y");' },
      "reaches inside results",
    ],
    [
      "an import.meta.glob of another feature's module",
      {
        "features/documents/a.ts": "const m = import.meta.glob(['@/features/results/lib/y.ts']);",
      },
      "reaches inside results",
    ],
    [
      "a vi.mock of a feature's module from the app",
      { "app/a.test.ts": 'vi.mock("@/features/monitor/components/monitor-tab");' },
      "reaches inside monitor",
    ],
    [
      "a relative path into another feature",
      { "features/documents/components/a.tsx": 'import { x } from "../../results/lib/y";' },
      "leaves its folder subtree",
    ],
    [
      "a relative path through features/",
      { "lib/nested/a.ts": "import { x } from '../../features/results/lib/y';" },
      "leaves its folder subtree",
    ],
    [
      "a relative path out of a feature",
      { "features/documents/lib/a.ts": 'import { x } from "../../../lib/format";' },
      "leaves its folder subtree",
    ],
    [
      "a feature edge the graph does not list",
      { "features/results/components/a.tsx": 'import { useTabs } from "@/features/workspace";' },
      "results may not depend on workspace",
    ],
    [
      "a dynamic import against the graph",
      { "features/indexes/a.ts": 'const m = import("@/features/documents");' },
      "indexes may not depend on documents",
    ],
    [
      "a re-export against the graph",
      { "features/workspace/index.ts": 'export { x } from "@/features/results";' },
      "workspace may not depend on results",
    ],
    [
      "a side-effect import against the graph",
      { "features/results/a.ts": 'import "@/features/documents";' },
      "results may not depend on documents",
    ],
    [
      "shared code importing a feature",
      { "components/a.tsx": 'import { useTabs } from "@/features/workspace";' },
      "shared code knows no feature",
    ],
    [
      "the entry point importing a feature's module",
      { "main.tsx": 'import { x } from "./features/results/lib/y";' },
      "shared code knows no feature",
    ],
    [
      "a static import of a feature's module from the app",
      { "app/a.tsx": 'import { MonitorTab } from "@/features/monitor/components/monitor-tab";' },
      "reaches inside monitor",
    ],
  ])("rejects %s", (_name, files: Record<string, string>, reason) => {
    const found = checkImports(files);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(reason);
  });

  it("accepts the allowed forms", () => {
    expect(
      checkImports({
        "app/a.tsx": [
          'import { useTabs } from "@/features/workspace";',
          'const Lab = lazy(() => import("@/features/perf-lab/components/perf-lab"));',
        ].join("\n"),
        "features/documents/components/a.tsx": [
          'import { ResultsView } from "@/features/results";',
          'import { x } from "../lib/x";',
          'import { y } from "@/features/documents/lib/y";',
          'import { cn } from "@odin-db/ui/lib/utils";',
          'import { format } from "@/lib/format";',
          'vi.mock("@/features/results", () => ({}));',
        ].join("\n"),
        "lib/locales.test.ts": 'const files = import.meta.glob("../**/locales/*.json");',
        "features/results/index.ts": 'export { ResultsView } from "./components/results-view";',
        "lib/i18n.ts": 'import results from "@/features/results/locales/en.json";',
        "main.tsx": 'import { App } from "./app/app";',
      }),
    ).toEqual([]);
  });
});
