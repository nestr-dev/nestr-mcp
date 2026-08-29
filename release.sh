#!/bin/bash
set -e

# Check for clean git state
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working directory is not clean. Commit or stash changes first."
  exit 1
fi

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")

if [ -n "$1" ]; then
  # Use provided version
  NEW_VERSION="$1"
else
  # Bump patch version
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
fi

echo "Bumping version: $CURRENT_VERSION -> $NEW_VERSION"

# Update package.json AND package-lock.json together. Writing package.json alone
# left the lockfile claiming the previous version, so the next install dirtied
# the tree and the published tarball disagreed with the lockfile in git.
npm version "$NEW_VERSION" --no-git-tag-version >/dev/null

# Commit, tag, and push
git add package.json package-lock.json
git commit -m "v$NEW_VERSION"
git tag "v$NEW_VERSION"
git push
git push origin "v$NEW_VERSION"

echo "Released v$NEW_VERSION"
