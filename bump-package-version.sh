#!/bin/sh
set -e

if [ $# != 2 ]; then
  echo "Usage: ./bump-package-version.sh <package-name> <new-version>"
  echo "Package names: infoview-api, infoview, unicode-input, unicode-input-component"
  exit 1
fi

package_name="$1"
new_version="$2"

case "$package_name" in
  infoview-api)
    dir="lean4-infoview-api"
    npm_name="@leanprover/infoview-api"
    ;;
  infoview)
    dir="lean4-infoview"
    npm_name="@leanprover/infoview"
    ;;
  unicode-input)
    dir="lean4-unicode-input"
    npm_name="@leanprover/unicode-input"
    ;;
  unicode-input-component)
    dir="lean4-unicode-input-component"
    npm_name="@leanprover/unicode-input-component"
    ;;
  *)
    echo "Unknown package: $package_name"
    echo "Valid names: infoview-api, infoview, unicode-input, unicode-input-component"
    exit 1
    ;;
esac

# Update version in the package's own package.json
echo "Updating $dir/package.json version to $new_version"
sed -i 's/"version": ".*"/"version": "'$new_version'"/' "$dir/package.json"

# Update dependency version in all other package.json files, preserving range prefix.
# Also patch-bump dependent NPM packages (excluding vscode-lean4 which has its own release cycle).
echo "Updating dependents of $npm_name"
for pkg_json in */package.json; do
  if grep -q "\"$npm_name\"" "$pkg_json"; then
    echo "  Updating dependency in $pkg_json"
    sed -i 's|"'"$npm_name"'": "\([~^]*\)[^"]*"|"'"$npm_name"'": "\1'"$new_version"'"|' "$pkg_json"

    dep_dir="$(dirname "$pkg_json")"
    if [ "$dep_dir" != "vscode-lean4" ] && [ "$dep_dir" != "$dir" ]; then
      old_ver="$(node -p "require('./$pkg_json').version")"
      # Patch bump: increment the last numeric component
      new_dep_ver="$(echo "$old_ver" | awk -F. '{$NF=$NF+1; print}' OFS=.)"
      echo "  Bumping $dep_dir version: $old_ver -> $new_dep_ver"
      sed -i 's/"version": ".*"/"version": "'$new_dep_ver'"/' "$pkg_json"
    fi
  fi
done

# Update package-lock.json
echo "Updating package-lock.json"
npm install --package-lock-only

# Commit
git commit -am "Bump $npm_name to $new_version"
echo "Done. Committed version bump for $npm_name to $new_version."
