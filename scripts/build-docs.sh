#!/usr/bin/env bash
# Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
# GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
#
# Generate the documentation tree of this repository.
#
# The script runs four steps in order:
#
#   1. compile the TypeScript sources into lib/;
#   2. write the documentation pages under docs/;
#   3. publish the demonstration website of every complete run under docs/results/;
#   4. write the list page docs/results.html.
#
# Run the script from any directory. The script finds the repository root from its own path.
#
# Usage:
#
#   bash scripts/build-docs.sh              # build, write the pages, publish every run
#   bash scripts/build-docs.sh <xid>        # publish the named run only
#   bash scripts/build-docs.sh --check      # run the type check and the test suite first
#
# A missing build tool stops the script with a non-zero exit status. The script never edits a raw
# reply of a run, and it never writes outside the repository.

set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(dirname "${script_directory}")"

cd "${repository_root}"

run_check=0
run_identifiers=()

for argument in "$@"; do
  case "${argument}" in
    --check)
      run_check=1
      ;;
    --help | -h)
      sed -n '4,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "The script holds no option ${argument}." >&2
      exit 2
      ;;
    *)
      run_identifiers+=("${argument}")
      ;;
  esac
done

echo "[1/4] Compile the sources."
npm run build

if [[ "${run_check}" -eq 1 ]]; then
  echo "[2/4] Run the type check and the test suite."
  npm run typecheck
  node --test test/*.test.mjs
else
  echo "[2/4] Skip the type check and the test suite. Add --check to run them."
fi

echo "[3/4] Write the documentation pages."
node scripts/build-docs.mjs

echo "[4/4] Publish the demonstration website of each complete run."
if [[ ${#run_identifiers[@]} -gt 0 ]]; then
  node scripts/publish-results.mjs "${run_identifiers[@]}"
else
  node scripts/publish-results.mjs
fi

echo "The documentation tree is ready under docs/."
