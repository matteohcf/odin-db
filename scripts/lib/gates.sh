# Shared by check.sh and check-changed.sh: each gate runs under a name, a failing one does not
# stop the others, and the summary at the end lists every failure. Mirrors CI's check job.
# Sourced, not run: the caller has already moved to the repository root.

failed=()

# Ctrl-C stops the whole run, not just the gate in progress: carrying on to the next gate after
# an interrupt would make the run impossible to stop. A gate interrupted exits with 130 (SIGINT)
# or 143 (SIGTERM); the trap covers bash's own interrupt. Any other signal, such as a test binary
# crashing, is an ordinary failure: the run goes on and the summary still lists it.
trap 'exit 130' INT

# gate NAME COMMAND...: runs COMMAND, recording NAME when it fails, and ending the run with the
# same status when it was interrupted.
gate() {
  local name=$1
  shift
  echo "▸ $name"
  local status=0
  "$@" || status=$?
  if [ "$status" -eq 130 ] || [ "$status" -eq 143 ]; then
    echo "Interrupted in $name.${failed[*]:+ Failed before it: ${failed[*]}}"
    exit "$status"
  fi
  if [ "$status" -ne 0 ]; then
    failed+=("$name")
  fi
}

# Rust types cross into TypeScript: the bindings must follow. Compared with the file as it is,
# not as committed, so freshly regenerated bindings pass before the commit.
bindings_up_to_date() {
  local bindings=packages/bindings/src/bindings.gen.ts
  local before
  before=$(git hash-object "$bindings")
  pnpm bindings || return 1
  if [ "$(git hash-object "$bindings")" != "$before" ]; then
    echo "The bindings were out of date; they are regenerated now: review and commit them."
    return 1
  fi
}

js_gates() {
  gate biome pnpm biome ci .
  gate typecheck pnpm typecheck
  gate knip pnpm knip
  gate vitest pnpm test
}

rust_gates() {
  gate rustfmt cargo fmt --all --check
  gate clippy cargo clippy --workspace --all-targets --all-features -- -D warnings
  gate cargo-test cargo test --workspace
  gate bindings bindings_up_to_date
}

# Prints the gates that failed and exits 1, or reports that all passed.
summary() {
  if [ "${#failed[@]}" -gt 0 ]; then
    echo "FAILED: ${failed[*]}"
    exit 1
  fi
  echo "all green"
}
