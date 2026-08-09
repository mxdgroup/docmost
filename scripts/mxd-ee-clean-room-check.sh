#!/usr/bin/env bash
#
# mxd-ee-clean-room-check.sh — enforce the fork's clean-room rule (plan R7):
#   1. Fork commits must NOT modify EE-licensed paths.
#   2. Fork-ADDED lines in non-EE files must NOT import from EE paths
#      (static import, require(), or dynamic import()).
#
# Gates on ADDED lines only, because upstream core already contains some EE
# imports (e.g. the page header mounts @/ee components) — those are upstream's,
# not ours. Base defaults to the fork's upstream tag.
#
# Run with MXD_CLEAN_ROOM_SELFTEST=1 to run the built-in self-test instead of
# checking the repo (used by CI so the guard can never silently rot).
set -uo pipefail

BASE_REF="${BASE_REF:-v0.95.0}"

EE_PATH_RE='^(apps/(client|server)/src/ee/|packages/ee/|packages/base-formula/)'
# Any added line that pulls an EE path in via from-import, require(), or
# dynamic import(). The path is matched after the opening quote in all three
# forms (the quote follows the paren directly in require()/import()).
EE_PATH_TAIL="[^'\"]*(/ee/|@docmost/ee|base-formula)"
EE_IMPORT_RE="^\+.*(from[[:space:]]*['\"]${EE_PATH_TAIL}|(require|import)\([[:space:]]*['\"]${EE_PATH_TAIL})"

run_check() {
  local base changed f fail=0
  base=$(git merge-base "$BASE_REF" HEAD 2>/dev/null) || { echo "::error::cannot resolve base $BASE_REF"; return 2; }
  changed=$(git diff --name-only "$base"..HEAD)

  if printf '%s\n' "$changed" | grep -qE "$EE_PATH_RE"; then
    echo "::error::fork commits modify EE-licensed paths:"
    printf '%s\n' "$changed" | grep -E "$EE_PATH_RE" | sed 's/^/  /'
    fail=1
  fi

  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      apps/client/src/ee/*|apps/server/src/ee/*|packages/ee/*|packages/base-formula/*) continue ;;
    esac
    [ -f "$f" ] || continue
    case "$f" in
      *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
      *) continue ;;
    esac
    if git diff -U0 "$base"..HEAD -- "$f" | grep -qE "$EE_IMPORT_RE"; then
      echo "::error file=$f::fork-added line imports from an EE path"
      git diff -U0 "$base"..HEAD -- "$f" | grep -E "$EE_IMPORT_RE" | sed 's/^/  /'
      fail=1
    fi
  done <<< "$changed"

  return "$fail"
}

selftest() {
  local rc=0 line
  # lines that MUST be flagged
  for line in \
    '+import { X } from "@/ee/page-permission";' \
    "+import Y from '../../ee/base/thing';" \
    '+const z = require("@docmost/ee/foo");' \
    '+const w = await import("../ee/lazy");' \
    '+import { a } from "@docmost/base-formula";'; do
    if printf '%s\n' "$line" | grep -qE "$EE_IMPORT_RE"; then :; else echo "SELFTEST FAIL (missed): $line"; rc=1; fi
  done
  # lines that must NOT be flagged
  for line in \
    '+import { Editor } from "@tiptap/react";' \
    '+import { free } from "@/features/page-access/panel";' \
    '+// mentions /ee/ in a comment only' \
    '+const seeed = "base-formula is a great name";'; do
    if printf '%s\n' "$line" | grep -qE "$EE_IMPORT_RE"; then echo "SELFTEST FAIL (false positive): $line"; rc=1; fi
  done
  [ "$rc" -eq 0 ] && echo "clean-room self-test: PASS" || echo "clean-room self-test: FAIL"
  return "$rc"
}

if [ "${MXD_CLEAN_ROOM_SELFTEST:-}" = "1" ]; then
  selftest
else
  run_check
fi
