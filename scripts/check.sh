#!/usr/bin/env bash
# Runs every gate CI runs, all of them even when one fails, and lists the failures at the end.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/gates.sh

js_gates
rust_gates
summary
