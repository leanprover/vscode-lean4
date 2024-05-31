#!/usr/bin/env bash

PUBLISHED_VERSION="$(npm view @leanprover/infoview-api version --no-workspaces)"
NEW_VERSION="$(sed -n 's/^\s*"version":\s*"\(.*\)",\s*/\1/p' ./package.json)"
PUBLISHED_MAJOR="$(cut -d '.' -f 1 <<< $PUBLISHED_VERSION)"
NEW_MAJOR="$(cut -d '.' -f 1 <<< $NEW_VERSION)"

if [ $PUBLISHED_MAJOR == $NEW_MAJOR ]; then
    tsc -p test/tsconfig.json
else
    echo "Skipping breaking.ts test as major version got bumped from $PUBLISHED_MAJOR to $NEW_MAJOR!"
    tsc -p test/tsconfig-breaking.json
fi

# exit if the above command failed
if [ $? -ne 0 ]; then
    exit 1
fi
