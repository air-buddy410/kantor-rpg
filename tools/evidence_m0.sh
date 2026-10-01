#!/usr/bin/env bash
# Re-run the M0 gates and write receipts with exit codes into docs/evidence/M0.
set -u
cd "$(dirname "$0")/.."
E=docs/evidence/M0
mkdir -p "$E"
{ echo "# safety scan $(date -u +%FT%TZ) HEAD $(git rev-parse HEAD)"; python3 tools/safety_scan.py; echo "exit=$?"; } > "$E/safety-scan.txt" 2>&1
{ echo "# validate $(date -u +%FT%TZ) HEAD $(git rev-parse HEAD)"; python3 tools/validate_world.py --report "$E/validate-world.json"; echo "exit=$?"; } > "$E/validate-world.txt" 2>&1
{ echo "# pytest $(date -u +%FT%TZ) HEAD $(git rev-parse HEAD)"; python3 -m pytest tests/py -v 2>&1; echo "exit=$?"; } > "$E/pytest.txt"
tail -n 3 "$E/safety-scan.txt" "$E/validate-world.txt" "$E/pytest.txt"
