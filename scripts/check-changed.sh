#!/usr/bin/env bash
# Runs only the gates the current changes need: the JS ones, the Rust ones, or both.
# Compares the working tree (staged and not) with origin/main; when that cannot be worked
# out, everything runs, like CI.
set -euo pipefail
cd "$(dirname "$0")/.."

base=$(git merge-base HEAD origin/main 2>/dev/null || true)
if [ -z "$base" ]; then
  exec pnpm check
fi
files=$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)
if [ -z "$files" ]; then
  echo "Nothing changed since origin/main."
  exit 0
fi

rust_pattern='^(crates/|apps/desktop/src-tauri/|Cargo\.|rust-toolchain\.toml|clippy\.toml)'
js_pattern='^(apps/desktop/(src|e2e)/|apps/desktop/[^/]+\.(json|ts|js|html)$|packages/|package\.json|pnpm-|biome\.json|knip\.json|turbo\.json|tsconfig)'

run_js=false
run_rust=false
if printf '%s\n' "$files" | grep -qE "$js_pattern"; then run_js=true; fi
if printf '%s\n' "$files" | grep -qE "$rust_pattern"; then run_rust=true; fi

if $run_js; then
  echo "▸ JS gates"
  # One per line: under `set -e` a failing `a && b` chain would not stop the script.
  pnpm lint
  pnpm typecheck
  pnpm knip
  pnpm test
fi
if $run_rust; then
  echo "▸ Rust gates"
  pnpm check:rust
  # Rust types cross into TypeScript: the bindings must follow. Compared with the file as it
  # is, not as committed, so freshly regenerated bindings pass before the commit.
  bindings=packages/bindings/src/bindings.gen.ts
  before=$(shasum "$bindings")
  pnpm bindings
  if [ "$(shasum "$bindings")" != "$before" ]; then
    echo "The bindings were out of date; they are regenerated now: review and commit them."
    exit 1
  fi
fi
if ! $run_js && ! $run_rust; then
  echo "Only docs or other files changed: nothing to check."
fi
