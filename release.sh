#!/bin/sh
if [ $# != 1 ]; then
  echo Usage: ./release.sh 1.2.3
  exit 1
fi

if [ -z "$OVSX_PAT" ]; then
  OVSX_PAT="$(pass pat/openvsx)" || exit 1
  export OVSX_PAT
fi

if [ -z "$VSCE_PAT" ]; then
  VSCE_PAT="$(pass pat/vsce)" || exit 1
  export VSCE_PAT
fi

set -ex

npm install
npx lerna bootstrap
npm run build

new_version="$1"
sed -i 's/"version": ".*"/"version": "'$new_version'"/' vscode-lean4/package.json
git commit -am "Release $new_version"
git tag -a v$new_version -m "vscode-lean4 $new_version"

npx lerna exec --scope=lean4 npx -- vsce publish

npx lerna exec --scope=lean4 npx -- ovsx publish

git push
git push --tags

npx lerna run --scope=lean4 package
hub release create -m "vscode-lean4 $new_version" v$new_version -a vscode-lean4/lean4-$new_version.vsix
