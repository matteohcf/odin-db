#!/usr/bin/env node
// Reports file paths named in the living documents that point at nothing.
//
// What it checks: CLAUDE.md, README.md, CONTRIBUTING.md and docs/*.md. ADRs (docs/adr) are left
// out on purpose: they are immutable records, and a name in them is history, not a pointer. Paths
// are read from backtick spans, fenced code blocks and Markdown link targets. A token counts as a
// path when it has a `/` or ends in a known file extension; a `file.rs::fn` form is checked as
// `file.rs`. A token ending in `/` is a directory, even with one segment (`scripts/`), and only
// resolves to a tracked directory. URLs, absolute paths, globs and placeholders (`*`, `<name>`),
// `@` names (npm scopes, the `@/` alias), Rust paths (`a::b`) and npm package subpaths
// (`react-dom/client`: the first segment is a dependency in a tracked package.json) are skipped. A
// path resolves when it names a file tracked by git or an existing directory, as written, relative
// to the document, under apps/desktop/, apps/desktop/src/ or apps/desktop/src-tauri/, or as the
// tail of any tracked path (CLAUDE.md writes paths relative to the area it is talking about).
//
// What it cannot see: paths in plain prose (outside backticks, code and links), paths in a code
// block that are neither first on their line nor shaped like a file or `dir/`, names that are not
// paths (functions, commands, settings), a path whose first segment happens to share a dependency's
// name, a git-ignored directory (it is not tracked, so it needs an exemption), and a path that
// resolves to the wrong file: matching the tail of any tracked path is lenient, so a short name
// like `index.ts` always resolves. Also unseen: indented (four-space) code blocks, which are read
// as prose; a backtick span that wraps across lines; HTML `href`/`src` attributes; and
// percent-encoded link targets (`%20`), which are reported as unresolved. A path without a
// trailing `/` may also name an untracked directory on disk (fetched sidecars, say), so its result
// can differ between checkouts.
//
// It is a report, never a gate: it always exits 0, even when git or a document cannot be read (the
// error is printed instead). Known-legitimate refs go in EXEMPTIONS, per document; an exemption
// that no longer matches anything is reported as drift.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

/** Refs that are right not to resolve: `path` as `doc` writes it, and why. */
const EXEMPTIONS = [
  { doc: "CLAUDE.md", path: "binaries/", why: "sidecars, fetched by script and git-ignored" },
  { doc: "CLAUDE.md", path: "kebab-case.tsx", why: "the file naming convention, not a file" },
  { doc: "CLAUDE.md", path: "docs/adr/NNNN-short-title.md", why: "the name a new ADR takes" },
  { doc: "README.md", path: "SHA256SUMS.txt", why: "release asset, built by the release workflow" },
  { doc: "docs/milestone-0.md", path: "target/release/odin-desktop", why: "release build output" },
  {
    doc: "docs/milestone-0.md",
    path: "report.md",
    why: "where the benchmark command writes its report",
  },
  {
    doc: "docs/releasing.md",
    path: "SHA256SUMS.txt",
    why: "release asset, built by the release workflow",
  },
  { doc: "docs/releasing.md", path: "latest.json", why: "updater manifest, a release asset" },
  {
    doc: "docs/releasing.md",
    path: "releases/latest/download/latest.json",
    why: "updater manifest URL path on GitHub",
  },
];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIXES = ["", "apps/desktop/", "apps/desktop/src/", "apps/desktop/src-tauri/"];
const EXTENSIONS =
  /\.(ts|tsx|js|mjs|cjs|jsx|json|md|rs|toml|ya?ml|sh|txt|html|css|lock|svg|png|ico)$/;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** What git tracks: files, the directories that hold them, and the npm dependency names. */
const readRepo = () => {
  // -z: NUL-separated and unquoted, so non-ASCII paths come through as they are.
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const files = new Set(tracked);
  const dirs = new Set(
    tracked.flatMap((file) =>
      file
        .split("/")
        .slice(0, -1)
        .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
    ),
  );
  const dependencies = new Set(
    tracked
      .filter((file) => posix.basename(file) === "package.json")
      .flatMap((file) => {
        const manifest = JSON.parse(readFileSync(join(ROOT, file), "utf8"));
        return DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {}));
      }),
  );
  return { files, dirs, dependencies };
};

const isDirOnDisk = (path) => {
  const full = join(ROOT, path);
  return existsSync(full) && statSync(full).isDirectory();
};

/** Whether `path` (a directory when it ends in `/`) resolves from a document in `docDir`. */
const resolver =
  ({ files, dirs }) =>
  (path, docDir) => {
    const isDir = path.endsWith("/");
    const bare = isDir ? path.slice(0, -1) : path;
    const exists = isDir
      ? (candidate) => dirs.has(candidate)
      : (candidate) =>
          files.has(candidate) ||
          dirs.has(candidate) ||
          (candidate !== "" && !candidate.startsWith("..") && isDirOnDisk(candidate));
    const known = isDir ? [...dirs] : [...files, ...dirs];
    return (
      [docDir === "." ? "" : `${docDir}/`, ...PREFIXES].some((prefix) =>
        exists(posix.normalize(prefix + bare)),
      ) || known.some((candidate) => candidate.endsWith(`/${bare}`))
    );
  };

/**
 * Turns a raw token into the path to check, or null when it is not a path. A directory keeps its
 * trailing `/`, so it is told apart from a file both when resolving and in the report.
 */
const pathParser = (dependencies) => (token, fromLink) => {
  const trimmed = token.replace(/[.,;:)]+$/, "").replace(/^\(/, "");
  const [base] = trimmed.split("::");
  if (!base || /[<>*{}$]|:\/\/|^[@/~#]|^mailto:/.test(base)) return null;
  const withSlash = base.split("#")[0].replace(/^\.\//, "");
  // Decided before the slash goes: `scripts/` is a directory, `scripts` is just a word.
  const isDir = withSlash.endsWith("/");
  const path = withSlash.replace(/\/$/, "");
  if (path === "" || path === "." || path === "..") return null;
  if (!fromLink && !isDir && !path.includes("/") && !EXTENSIONS.test(path)) return null;
  if (!/^[\p{L}\p{N}_.@/-]+$/u.test(path)) return null;
  if (!fromLink && path.includes("/") && dependencies.has(path.split("/")[0])) return null;
  return isDir ? `${path}/` : path;
};

const tokens = (text) => text.split(/[\s"'=]+/).filter(Boolean);

// A code block mixes paths with prose (the layout tree, comments after commands), so only its
// first token and tokens shaped like a file or a directory (`x.ts`, `dir/`) count.
const fencedTokens = (line) =>
  tokens(line).filter((token, i) => i === 0 || EXTENSIONS.test(token) || token.endsWith("/"));

/** Every candidate path in a document, with its line number. */
const refsIn = (text, toPath) => {
  const fencedRefs = (line) => fencedTokens(line).map((token) => toPath(token, false));
  const proseRefs = (line) => [
    ...[...line.matchAll(/`([^`]+)`/g)].flatMap((m) =>
      tokens(m[1]).map((token) => toPath(token, false)),
    ),
    ...[...line.matchAll(/\]\(([^)\s]+)/g), ...line.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g)].map((m) =>
      toPath(m[1], true),
    ),
  ];
  const lines = text.split("\n");
  const fences = lines.flatMap((line, i) => (/^\s*(```|~~~)/.test(line) ? [i] : []));
  const isFenced = (i) => fences.filter((fence) => fence < i).length % 2 === 1;
  return lines.flatMap((line, i) => {
    if (fences.includes(i)) return [];
    const found = isFenced(i) ? fencedRefs(line) : proseRefs(line);
    return [...new Set(found.filter(Boolean))].map((path) => ({ line: i + 1, path }));
  });
};

const listDocuments = () => [
  ...["CLAUDE.md", "README.md", "CONTRIBUTING.md"].filter((doc) => existsSync(join(ROOT, doc))),
  ...readdirSync(join(ROOT, "docs"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`),
];

const report = () => {
  const repo = readRepo();
  const resolves = resolver(repo);
  const toPath = pathParser(repo.dependencies);
  const documents = listDocuments();

  const checked = documents.map((doc) => ({
    doc,
    refs: refsIn(readFileSync(join(ROOT, doc), "utf8"), toPath),
  }));
  const unresolved = checked.map(({ doc, refs }) => ({
    doc,
    refs: refs.filter(({ path }) => !resolves(path, posix.dirname(doc))),
  }));

  const exempts = (e, doc, path) => e.doc === doc && e.path === path;
  const isExempt = (doc, path) => EXEMPTIONS.some((e) => exempts(e, doc, path));
  const reported = unresolved
    .map(({ doc, refs }) => ({ doc, refs: refs.filter(({ path }) => !isExempt(doc, path)) }))
    .filter(({ refs }) => refs.length > 0);
  const drift = EXEMPTIONS.filter(
    (e) => !unresolved.some(({ doc, refs }) => refs.some(({ path }) => exempts(e, doc, path))),
  );

  const total = checked.reduce((sum, { refs }) => sum + refs.length, 0);
  console.log(
    `Doc refs: ${total} paths in ${documents.length} documents (${documents.join(", ")}).`,
  );
  if (reported.length === 0) console.log("Every path resolves.");
  for (const { doc, refs } of reported) {
    console.log(`\n${doc}`);
    for (const { line, path } of refs) console.log(`  ${doc}:${line}  ${path}`);
  }
  if (drift.length > 0) {
    console.log("\nExemptions that no longer match anything (remove them):");
    for (const { doc, path, why } of drift) console.log(`  ${doc}  ${path}  (${why})`);
  }
  const count = reported.reduce((sum, { refs }) => sum + refs.length, 0);
  console.log(`\n${count} unresolved, ${EXEMPTIONS.length - drift.length} exempt.`);
};

try {
  report();
} catch (error) {
  console.log(
    `Doc refs: could not run the report: ${error instanceof Error ? error.message : error}`,
  );
}
