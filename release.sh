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

# Update package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Commit, tag, and push
git add package.json
git commit -m "v$NEW_VERSION"
git tag "v$NEW_VERSION"
git push
git push origin "v$NEW_VERSION"

echo "Released v$NEW_VERSION"
