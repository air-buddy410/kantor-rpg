#!/usr/bin/env bash
# Clean rebuild of every generated artefact from design/world.json, in
# dependency order. Stops at the first failure. Blender steps are skipped
# (and reported) when the blender executable is missing.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { echo; echo "== $*"; }

step "Python toolchain"; python3 -m pip install -q -r requirements-dev.txt
step "Design data (seed, validate, capacity, schedule, ICT, matrix, PRD PDF)"; python3 tools/build_design.py
step "Drawings (DXF + PDF + previews)"; python3 cad/generate.py --all-available
step "Signage and poster"; python3 tools/make_signage.py
if command -v blender >/dev/null 2>&1; then
  B="blender -b --factory-startup -noaudio --python"
  step "Blender: building";   $B blender/building/build_building.py
  step "Blender: furniture";  $B blender/furniture/build_furniture.py
  step "Blender: characters"; $B blender/characters/build_characters.py -- --variants
  step "Blender: validate";   $B blender/validate_assets.py
  [ -f blender/building/validate_building.py ] && $B blender/building/validate_building.py
else
  echo "SKIP Blender steps: blender not found (GLB/blend in repo stay as committed)"
fi
step "Python tests"; python3 -m pytest tests/py -q
step "Safety + licences + contrast"; python3 tools/safety_scan.py; python3 tools/license_audit.py; python3 tools/contrast.py M3
step "App (install, unit, build)"; (cd app && npm ci && npx vitest run && npm run build)
step "App E2E (Chromium)"; (cd app && npx playwright test tests/e2e/world.spec.ts tests/e2e/npc.spec.ts tests/e2e/activity.spec.ts tests/e2e/studio.spec.ts tests/e2e/a11y.spec.ts)
echo; echo "rebuild complete"
