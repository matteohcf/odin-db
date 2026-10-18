// Runs the UI checks against the mock backend served by `pnpm dev:web` (http://localhost:1420).
// Usage: pnpm e2e [name ...]
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2);
const scripts = readdirSync(here)
  .filter((file) => file.endsWith(".mjs") && file !== "run.mjs")
  .filter((file) => wanted.length === 0 || wanted.includes(basename(file, ".mjs")));

const server = await fetch("http://localhost:1420/").catch(() => null);
if (!server?.ok) {
  console.error("Start the web app first: pnpm --filter @odin-db/desktop dev:web");
  process.exit(1);
}

mkdirSync(join(here, "..", "test-results"), { recursive: true });
const failed = [];
for (const script of scripts) {
  const run = spawnSync(process.execPath, [join(here, script)], {
    cwd: join(here, ".."),
    encoding: "utf8",
  });
  const output = `${run.stdout}${run.stderr}`;
  const errors = output.match(/\{"errors":\[(.*)\]\}/)?.[1];
  const ok = run.status === 0 && !/^FAIL/m.test(output) && !errors;
  console.log(`${ok ? "ok  " : "FAIL"} ${script}`);
  if (!ok) {
    failed.push(script);
    console.log(output.replace(/^/gm, "     "));
  }
}
console.log(`\n${scripts.length - failed.length}/${scripts.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
