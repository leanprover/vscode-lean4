#!/usr/bin/env bash

cd "$(dirname $0)"

tsc -p tsconfig.json

PUBLISHED_VERSION="$(npm view @leanprover/infoview-api version)"
NEW_VERSION="$(sed -n 's/^\s*"version":\s*"\(.*\)",\s*/\1/p' ../package.json)"
PUBLISHED_MAJOR="$(cut -d '.' -f 1 <<< $PUBLISHED_VERSION)"
NEW_MAJOR="$(cut -d '.' -f 1 <<< $NEW_VERSION)"

if [ $PUBLISHED_MAJOR == $NEW_MAJOR ]; then
    tsc -p tsconfig-breaking.json
else
    echo "Skipping breaking.ts test as major version got bumped from $PUBLISHED_MAJOR to $NEW_MAJOR!"
fi
