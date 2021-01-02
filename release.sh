#!/bin/sh
if [ $# != 1 ]; then
  echo Usage: ./release.sh 1.2.3
  exit 1
fi

if [ -z "$OVSX_PAT" ]; then
  OVSX_PAT="$(pass pat/openvsx)" || exit 1
  export OVSX_PAT
fi

set -ex
new_version="$1"
sed -i 's/"version": ".*"/"version": "'$new_version'"/' package.json
npm i
git commit -am "Release $new_version"
git tag -a v$new_version -m "vscode-lean $new_version"

./node_modules/.bin/vsce publish

./node_modules/.bin/ovsx publish

git push
git push --tags

./node_modules/.bin/vsce package
hub release create -m "vscode-lean $new_version" v$new_version -a lean-$new_version.vsix
