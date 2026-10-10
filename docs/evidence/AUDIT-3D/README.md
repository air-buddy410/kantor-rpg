# AUDIT-3D — z-fighting / flicker audit (branch max/audit-3d)

Trigger: Budi's phone video (live e480894) showed flicker on (1) the stair GLB
divider wall, blue glass and white rail, (2) brown door frames in the corridor,
(3) the server-room red partition and desk shadows.

## Fixes (in source, no polygonOffset)
- `furniture-kit.ts` `separateCoplanar`: GLB parts that share a plane with
  another part (stair wall vs treads, rack, reception desk, media console, cue
  rack, shower glass, plant pot vs soil...) get the smallest mitered offset
  (n x 1.5 mm) that clears every part placed before them. Corners stay shared,
  so no cracks. Cost: ~0.37 s total across 54 GLBs (Node, desktop).
- `door-meshes.ts` + `build.ts`: door leaves use the cutaway occluder material
  (with instance matrices); before, a leaf stayed whole inside a cut wall.
- `build.ts`: glass materials have `depthWrite: false` (shower vs window glass
  sort flips); floor plates step 2 mm (+4..+18 mm); threshold top at +34 mm.
- `furniture.ts`: 5 procedural coplanar pairs inset (shelf back panel,
  poster stripe, arcade top, lift seam, small bar).
- `game.ts`: sun/shadow camera follows the CEO in whole shadow texels.

## Gates
- `app/tests/unit/coplanar.test.ts`: scans the built world (L1/L2, procedural
  and GLB kit, doors closed and open, instanced leaves, double-sided faces
  facing opposite ways) for overlapping faces < 1 mm (also run at 2 mm) with
  different colours. After: 0 hits. Before: see `before/coplanar-*.json`.
- Per-asset reports: `after/coplanar-assets-{furniture,building}.json`
  (raw GLB, before the runtime offset). building-L*.glb are not loaded by the
  app (no reference in src), so their hits are informational.

## Flicker probe (`tools/flicker_probe.mjs`)
Manual rAF/performance.now driver; bursts of 8 micro-frames (1/4000 s) after
12 normal frames; hot = pixel with A->B->A luminance flip in >= 2 triplets.
Profiles: desktop 1280x720 high/low, phone 464x848 dpr 3 (auto -> low tier on
SwiftShader). Results: `before/flicker-probe.json`, `after/flicker-probe.json`,
heatmaps per profile. Table: `probe-table.txt`.

Residual phone hits are scattered single pixels along edges (dpr-3 sub-pixel
aliasing in SwiftShader), not filled patches; the filled patches on the stair
divider, desks and walls are gone (compare `*/phone-auto/stair-core-rotate-heat.png`).

## Weight
`glb-audit-before.json` == `glb-audit-after.json` totals (assets untouched;
runtime GLB 5.92 MB, gzip 2.10 MB). Bundle and draw-call budget e2e pass.
