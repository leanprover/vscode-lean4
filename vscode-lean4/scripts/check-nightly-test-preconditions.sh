#!/usr/bin/env bash
set -euo pipefail

# Informational sanity check for `npm run test:nightly`.
#
# The nightly tests isolate HOME/ELAN_HOME under ~/.cache/lean4-vscode-tests/,
# so they do NOT touch your real ~/.elan or ~/.vscode. But they do hit the
# real network and download ~200MB (elan + leanprover/lean4:stable). This
# script confirms the machine can actually run them.

echo "Nightly tests will:"
echo "  - create a fresh HOME under ~/.cache/lean4-vscode-tests/"
echo "  - download elan and leanprover/lean4:stable into it (~200MB)"
echo "  - NOT modify your real ~/.elan, ~/.vscode, or shell profile"
echo

if ! command -v curl >/dev/null 2>&1; then
    echo "error: curl is required" >&2
    exit 1
fi

if ! curl -fsS --max-time 10 -o /dev/null https://github.com; then
    echo "error: cannot reach github.com" >&2
    exit 1
fi

echo "Preconditions OK."
