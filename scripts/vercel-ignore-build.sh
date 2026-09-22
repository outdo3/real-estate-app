#!/usr/bin/env bash
# E-JIP — Vercel Ignored Build Step. Wired via vercel.json "ignoreCommand" (VERCEL_DOCS_ONLY_BUILD_SKIP_ENABLE_V1).
#
# Vercel contract (docs, verified 2026-09-22):
#   exit 0  -> build is ABORTED (deployment CANCELED)      = SKIP
#   exit 1+ -> build continues                              = BUILD
#   VERCEL_GIT_PREVIOUS_SHA = SHA of the last *successful* deployment for this project+branch
#                              (empty on a branch's first deploy; only set when an Ignored Build Step exists)
#   Builds use a shallow clone (--depth=10).
#
# Rule: SKIP only when EVERY changed path since the last successful deployment is under docs/
#       (or is exactly the root CHANGELOG.md). Anything else, or any doubt, -> BUILD.
# We diff PREVIOUS_SHA..HEAD, never HEAD^..HEAD: one push can carry several commits, and a
# docs-only last commit must not hide a code commit before it.

build() { echo "[ignore-build] BUILD — $1"; exit 1; }
skip()  { echo "[ignore-build] SKIP — $1"; exit 0; }

command -v git >/dev/null 2>&1 || build "git not available"

PREV="${VERCEL_GIT_PREVIOUS_SHA:-}"
CUR="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

[ -n "$PREV" ] || build "no previous successful deployment SHA"
case "$PREV" in *[!0-9a-fA-F]*) build "previous SHA is not a hex SHA" ;; esac

# Shallow clone: the previous deploy may be deeper than 10 commits. Try to fetch it; if we
# still cannot see it, we cannot know what changed -> BUILD.
if ! git cat-file -e "${PREV}^{commit}" 2>/dev/null; then
  git fetch --quiet --no-tags --depth=200 origin "$PREV" >/dev/null 2>&1 || true
fi
git cat-file -e "${PREV}^{commit}" 2>/dev/null || build "previous SHA ${PREV} not available in this clone"
git cat-file -e "${CUR}^{commit}" 2>/dev/null || build "current commit ${CUR} not available"

# --no-renames: a rename lists both the old and the new path, so moving code into docs/ still builds.
if ! CHANGED="$(git diff --name-only --no-renames "$PREV" "$CUR" 2>/dev/null)"; then
  build "git diff failed"
fi
# Nothing changed (redeploy, empty commit used to re-trigger a deploy) -> BUILD, keep the old behaviour.
[ -n "$CHANGED" ] || build "empty diff"

while IFS= read -r f; do
  case "$f" in
    docs/*) ;;
    CHANGELOG.md) ;;
    *) build "non-docs path changed: $f" ;;
  esac
done <<< "$CHANGED"

skip "docs-only change ($(printf '%s\n' "$CHANGED" | wc -l | tr -d ' ') files)"
