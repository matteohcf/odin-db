#!/usr/bin/env bash
# Builds mongodump and mongorestore from MongoDB's source as Tauri sidecars (ADR-0033).
# Usage: scripts/build-database-tools.sh <rust-target-triple>
set -euo pipefail

TOOLS_VERSION=100.19.1
# The commit tag 100.19.1 points to. Fetching by hash pins the exact source.
TOOLS_COMMIT=9348e032419d906e40966f477278cce647b9b1eb

target="${1:?usage: build-database-tools.sh <rust-target-triple>}"
ext=""
case "$target" in
  x86_64-unknown-linux-gnu) goos=linux goarch=amd64 ;;
  aarch64-unknown-linux-gnu) goos=linux goarch=arm64 ;;
  x86_64-apple-darwin) goos=darwin goarch=amd64 ;;
  aarch64-apple-darwin) goos=darwin goarch=arm64 ;;
  x86_64-pc-windows-msvc) goos=windows goarch=amd64 ext=".exe" ;;
  aarch64-pc-windows-msvc) goos=windows goarch=arm64 ext=".exe" ;;
  *) echo "unsupported target: $target" >&2; exit 1 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/apps/desktop/src-tauri/binaries"
src="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/mongo-tools-$TOOLS_COMMIT"

if [ ! -d "$src/.git" ]; then
  git init -q "$src"
  git -C "$src" fetch -q --depth 1 https://github.com/mongodb/mongo-tools.git "$TOOLS_COMMIT"
  git -C "$src" checkout -q FETCH_HEAD
fi

mkdir -p "$out"
for tool in mongodump mongorestore; do
  # CGO off: static, distribution-independent binaries. Only Kerberos (GSSAPI) needs cgo,
  # and it is outside the V1 authentication scope (ADR-0018).
  (cd "$src" && CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build -trimpath \
    -ldflags "-s -w -X main.VersionStr=$TOOLS_VERSION -X main.GitCommit=$TOOLS_COMMIT" \
    -o "$out/$tool-$target$ext" "./$tool/main")
  echo "built $out/$tool-$target$ext"
done
