#!/bin/bash
set -euo pipefail

# main is protected (PR + 1 approval, enforced for admins), so the version bump
# cannot be pushed straight to main. Instead: open a release PR, let auto-merge
# land it once the Claude reviewer approves, then tag the resulting main commit.
# The tag push is what triggers publish.yml.

WAIT_TIMEOUT_SECONDS=${WAIT_TIMEOUT_SECONDS:-1800}

# Check for clean git state
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working directory is not clean. Commit or stash changes first."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: the GitHub CLI (gh) is required."
  exit 1
fi

# Release from an up-to-date main, so the PR contains nothing but the bump
git fetch origin main --tags --quiet
if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "Error: run releases from main."
  exit 1
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Error: local main differs from origin/main. Run 'git pull --ff-only' first."
  exit 1
fi

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")

if [ -n "${1:-}" ]; then
  # Use provided version
  NEW_VERSION="$1"
else
  # Bump patch version
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
fi

TAG="v$NEW_VERSION"
BRANCH="release/$TAG"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Error: tag $TAG already exists. Pass an explicit version: ./release.sh <version>"
  exit 1
fi

echo "Bumping version: $CURRENT_VERSION -> $NEW_VERSION"

# Update package.json AND package-lock.json together. Writing package.json alone
# left the lockfile claiming the previous version, so the next install dirtied
# the tree and the published tarball disagreed with the lockfile in git.
git switch -c "$BRANCH"
npm version "$NEW_VERSION" --no-git-tag-version >/dev/null
git add package.json package-lock.json
git commit -m "$TAG"
git push -u origin "$BRANCH"

PR_URL=$(gh pr create --base main --head "$BRANCH" --title "$TAG" \
  --body "Release $TAG. Bumps package.json and package-lock.json; the tag is pushed once this merges.")
echo "Opened $PR_URL"

# Squash so main gets one commit per release; the branch is deleted on merge
# by the repo setting.
gh pr merge "$PR_URL" --auto --squash

git switch main

echo "Waiting for review and merge (timeout ${WAIT_TIMEOUT_SECONDS}s)..."
deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
while true; do
  # Captured rather than read from a process substitution, whose exit status
  # set -e ignores: a failed call would leave every field empty and the loop
  # would spin silently. A transient failure is retried until the deadline.
  if ! pr_status=$(gh pr view "$PR_URL" \
    --json state,reviewDecision,mergeCommit,statusCheckRollup \
    --jq '[.state, (.reviewDecision // "NONE"), (.mergeCommit.oid // "-"),
      ([.statusCheckRollup[]? | select(.conclusion == "FAILURE")] | length)] | @tsv'); then
    echo "Warning: could not read $PR_URL; retrying."
    pr_status=""
  fi
  read -r STATE DECISION MERGE_SHA FAILED <<< "$pr_status" || true

  # mergeCommit can lag behind state on the first poll after the merge
  if [ "${STATE:-}" = "MERGED" ] && [ "${MERGE_SHA:--}" != "-" ]; then
    break
  fi
  if [ "${STATE:-}" = "CLOSED" ]; then
    echo "Error: $PR_URL was closed without merging. Nothing was tagged."
    exit 1
  fi
  if [ "${DECISION:-}" = "CHANGES_REQUESTED" ]; then
    echo "Error: changes were requested on $PR_URL. Nothing was tagged."
    exit 1
  fi
  if [ "${FAILED:-0}" != "0" ]; then
    echo "Error: a required check failed on $PR_URL. Fix it there; auto-merge stays armed."
    echo "Once it merges, finish the release with:"
    echo "  git fetch origin main && git tag $TAG <merge-commit-sha> && git push origin $TAG"
    exit 1
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "Timed out waiting for $PR_URL to merge (state: ${STATE:-unknown}, review: ${DECISION:-unknown})."
    echo "Once it merges, finish the release with:"
    echo "  git fetch origin main && git tag $TAG <merge-commit-sha> && git push origin $TAG"
    exit 1
  fi
  sleep 15
done

# Tag the squash commit that actually landed on main, not the branch commit
git pull --ff-only origin main
git tag "$TAG" "$MERGE_SHA"
git push origin "$TAG"
git branch -D "$BRANCH" >/dev/null 2>&1 || true

echo "Released $TAG"
