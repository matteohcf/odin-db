// Runs a shell script with Git's bash: `node scripts/run-sh.mjs <script> [args...]`.
// On Windows a bare `bash` from cmd.exe can resolve to C:\Windows\System32\bash.exe, which is
// WSL: another system, without this checkout's node_modules or toolchain. So there the bash
// that ships with Git is looked up from `git --exec-path` (<git>/mingw64/libexec/git-core);
// elsewhere, or when it cannot be found, plain `bash` from PATH runs it.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";

function gitBash() {
  try {
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    const root = join(execPath, "..", "..", "..");
    return [join(root, "bin", "bash.exe"), join(root, "usr", "bin", "bash.exe")].find(existsSync);
  } catch {
    return undefined;
  }
}

function chooseBash() {
  if (process.platform !== "win32") return "bash";
  const found = gitBash();
  if (found) return found;
  console.error("Git for Windows' bash not found; falling back to bash on PATH, which may be WSL.");
  return "bash";
}

const bash = chooseBash();
const result = spawnSync(bash, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(`Could not run ${bash}: ${result.error.message}`);
  process.exit(1);
}
// A script killed by a signal has no exit code: report it the way a shell would.
process.exit(result.status ?? 128 + (constants.signals[result.signal] ?? 0));
