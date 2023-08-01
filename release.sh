#!/bin/sh
if [ $# != 1 ]; then
  echo Usage: ./release.sh 1.2.3
  exit 1
fi

new_version="$1"
sed -i 's/"version": ".*"/"version": "'$new_version'"/' vscode-lean4/package.json
git commit -am "Release $new_version"
git tag -a v$new_version -m "vscode-lean4 $new_version"

git push
git push --tags
