#!/bin/sh
set -e

if [ $# != 2 ]; then
  echo "Usage: ./bump-package-version.sh <package-name> <new-version>"
  echo "Package names: infoview-api, infoview, unicode-input, unicode-input-component"
  exit 1
fi

package_name="$1"
new_version="$2"
dir="lean4-$package_name"
npm_name="@leanprover/$package_name"

if [ ! -d "$dir" ]; then
  echo "Unknown package: $package_name"
  echo "Valid names: infoview-api, infoview, unicode-input, unicode-input-component"
  exit 1
fi

# Maps directory names to npm package names
npm_name_of() {
  echo "@leanprover/$(echo "$1" | sed 's/^lean4-//')"
}

# Process version bumps transitively using a queue.
# Each entry is "dir:version" — the package whose version was bumped and needs its
# dependents updated. Dependents (excluding vscode-lean4) get patch-bumped and are
# added to the queue so their own dependents are updated in turn.
bumped="" # Track already-bumped packages to handle diamonds in the dependency graph
queue="$dir:$new_version"
while [ -n "$queue" ]; do
  entry="${queue%%
*}"
  queue="${queue#"$entry"}"
  queue="${queue#
}"

  bump_dir="${entry%%:*}"
  bump_version="${entry#*:}"
  bump_npm_name="$(npm_name_of "$bump_dir")"
  bumped="$bumped $bump_dir"

  echo "Updating $bump_dir/package.json version to $bump_version"
  sed -i 's/"version": ".*"/"version": "'$bump_version'"/' "$bump_dir/package.json"

  echo "Updating dependents of $bump_npm_name"
  for pkg_json in */package.json; do
    dep_dir="$(dirname "$pkg_json")"
    [ "$dep_dir" = "$bump_dir" ] && continue
    if grep -q "\"$bump_npm_name\"" "$pkg_json"; then
      echo "  Updating dependency in $pkg_json"
      sed -i 's|"'"$bump_npm_name"'": "\([~^]*\)[^"]*"|"'"$bump_npm_name"'": "\1'"$bump_version"'"|' "$pkg_json"

      # Patch-bump the dependent (excluding vscode-lean4 and already-bumped packages)
      case " $bumped " in *" $dep_dir "*) continue ;; esac
      if [ "$dep_dir" != "vscode-lean4" ]; then
        old_ver="$(node -p "require('./$pkg_json').version")"
        dep_new_ver="$(echo "$old_ver" | awk -F. '{$NF=$NF+1; print}' OFS=.)"
        echo "  Patch-bumping $dep_dir: $old_ver -> $dep_new_ver"
        # Add to queue so its dependents are updated too
        if [ -n "$queue" ]; then
          queue="$queue
$dep_dir:$dep_new_ver"
        else
          queue="$dep_dir:$dep_new_ver"
        fi
      fi
    fi
  done
done

# Update package-lock.json
echo "Updating package-lock.json"
npm install --package-lock-only --ignore-scripts

# Commit
git commit -am "chore: bump $npm_name to $new_version"
echo "Done. Committed version bump for $npm_name to $new_version."
