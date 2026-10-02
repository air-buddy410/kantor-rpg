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
  # Builders export to blender/out/raw-glb; the app ships the optimised copies,
  # so optimise and compare before any validator reads app/public/assets.
  step "GLB optimise (KHR_mesh_quantization) + compare with the export"
  [ -d app/node_modules/@gltf-transform/functions ] || (cd app && npm ci)
  node tools/glb_optimize.mjs
  python3 tools/glb_compare.py  # writes docs/evidence/R2/glb-compare.json, read by tests/py/test_asset_size.py
  step "Blender: validate";   $B blender/validate_assets.py
  step "Blender: validate building + furniture"
  $B blender/building/validate_building.py
  $B blender/furniture/validate_furniture.py
else
  echo "SKIP Blender steps and GLB optimise: blender not found (GLB/blend in repo stay as committed)"
fi
step "Python tests"; python3 -m pytest tests/py -q
# Evidence of a rebuild goes to its own folder so milestone evidence stays as recorded.
EV="${KANTOR_REBUILD_EVIDENCE:-REBUILD}"
step "Safety + licences + contrast"; python3 tools/safety_scan.py; python3 tools/license_audit.py --out "docs/evidence/$EV/license-audit.json"; python3 tools/contrast.py "$EV"
step "App (install, unit, build)"; (cd app && npm ci && npx vitest run && npm run build)
step "App E2E (Chromium)"; (cd app && KANTOR_MILESTONE="$EV" npx playwright test tests/e2e/world.spec.ts tests/e2e/npc.spec.ts tests/e2e/activity.spec.ts tests/e2e/studio.spec.ts tests/e2e/a11y.spec.ts tests/e2e/states.spec.ts tests/e2e/budget.spec.ts tests/e2e/doors.spec.ts tests/e2e/controls.spec.ts tests/e2e/failures.spec.ts tests/e2e/device.spec.ts tests/e2e/bundle.spec.ts)
echo; echo "rebuild complete"
