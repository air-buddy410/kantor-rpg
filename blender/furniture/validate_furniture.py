"""Validate every furniture GLB against the world.json catalog.

Run:
  blender -b --factory-startup -noaudio --python blender/furniture/validate_furniture.py

Checks the shipped GLB (tools/glb_optimize.mjs output, KHR_mesh_quantization):
the integer positions are read through the node transform, so every size below
is in metres. Equality with the Blender export is measured by tools/glb_compare.py.

Per type: GLB header/chunks, one mesh node FURN-<type> whose only transform
is the dequantization (uniform scale + translation, no rotation), bbox equals
catalog [w, d, h] within 2 cm, footprint centred on the
origin and resting on the floor, front orientation probe (furniture_spec.FRONT_RULES),
triangle budget (small 2k / large 5k), materials drawn from the shared palette,
and a Blender re-import whose bbox matches. Also reopens furniture.blend.
Writes docs/evidence/<KANTOR_EVIDENCE, default R2>/furniture-validate.json and .txt and merges one
registry entry per type (kind "furniture"). Exit 1 on any failure.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "lib"))
import furniture_spec as FS  # noqa: E402
import glb_read as G  # noqa: E402
import kantor_blender as K  # noqa: E402
import registry  # noqa: E402

ROOT = FS.ROOT
BLEND = ROOT / "blender" / "out" / "furniture.blend"
# Evidence folder of the current round (KANTOR_EVIDENCE, default R2) so reruns never
# overwrite the evidence recorded for earlier milestones.
EVID = ROOT / "docs" / "evidence" / os.environ.get("KANTOR_EVIDENCE", "R2")
SHEET = "assets/previews/furniture-sheet.png"


def probe(g, node, material, zmin):
    """Mean world-frame Y of vertices that use `material` (and sit above zmin)."""
    ys = []
    for p in g.mesh_primitives(node):
        if g.material_name(p) != material:
            continue
        for v in g.node_positions(node, p):
            x, y, z = G.gltf_to_world(v)
            if z >= zmin:
                ys.append(y)
    return (sum(ys) / len(ys), len(ys)) if ys else (None, 0)


def check_type(t, size, palette_names):
    C = []

    def chk(name, ok, detail=None):
        C.append({"check": name, "ok": bool(ok), "detail": detail})
        return ok
    path = FS.glb_path(t)
    res = {"type": t, "glb": str(path.relative_to(ROOT)), "checks": C}
    if not chk("glb exists", path.exists()):
        return res
    g = G.Glb(path)
    nodes = g.nodes_by_name()
    name = f"FURN-{t}"
    mesh_nodes = [n for n, v in nodes.items() if "mesh" in v]
    chk("single mesh node FURN-<type>", mesh_nodes == [name], mesh_nodes)
    if name not in nodes:
        return res
    chk("glb is the optimised file (KHR_mesh_quantization required)",
        "KHR_mesh_quantization" in g.doc.get("extensionsRequired", []), g.doc.get("extensionsRequired"))
    n = nodes[name]
    sc = n.get("scale", [1.0, 1.0, 1.0])
    chk("node transform is only the dequantization (uniform scale + translation)",
        "matrix" not in n and list(n.get("rotation", [0, 0, 0, 1])) == [0, 0, 0, 1]
        and max(sc) - min(sc) <= 1e-9 * max(sc), {k: n.get(k) for k in ("translation", "rotation", "scale")})
    mn, mx = G.world_bounds(*g.node_world_bounds(name))
    dims = [mx[i] - mn[i] for i in range(3)]
    chk(f"bbox equals catalog {size} within {FS.TOL_M} m", all(abs(a - b) <= FS.TOL_M for a, b in zip(dims, size)),
        [round(v, 4) for v in dims])
    chk("footprint centred on origin", abs(mn[0] + mx[0]) / 2 <= 0.01 and abs(mn[1] + mx[1]) / 2 <= 0.01,
        [round((mn[0] + mx[0]) / 2, 4), round((mn[1] + mx[1]) / 2, 4)])
    chk("rests on floor (min z = 0)", abs(mn[2]) <= 0.002, round(mn[2], 4))
    tris = g.node_triangles(name)
    budget = FS.tri_budget(size)
    chk(f"triangles within {FS.size_class(size)} budget", tris <= budget, {"triangles": tris, "budget": budget})
    mats = sorted({m["name"] for m in g.doc.get("materials", [])})
    chk("materials from shared palette", set(mats) <= palette_names, sorted(set(mats) - palette_names))
    extras = nodes[name].get("extras", {})
    chk("extras carry type and size", extras.get("kantor_type") == t and list(extras.get("kantor_size", [])) == list(size),
        {k: extras.get(k) for k in ("kantor_type", "kantor_size")})
    if t in FS.MOUNT_HEIGHT_M:
        chk("mount height extra", abs(extras.get("kantor_mount_height_m", -1) - FS.MOUNT_HEIGHT_M[t]) < 1e-6,
            extras.get("kantor_mount_height_m"))
    if t in FS.FRONT_RULES:
        mat, side, zmin = FS.FRONT_RULES[t]
        y, n = probe(g, name, mat, zmin)
        ok = y is not None and ((y < -0.005) if side == "-" else (y > 0.005))
        chk(f"front probe: {mat} on {'front (-Y)' if side == '-' else 'back (+Y)'}", ok,
            {"meanY": round(y, 4) if y is not None else None, "vertices": n})
    else:
        chk("orientation-free type declared symmetric", t in FS.SYMMETRIC)
    # importer round trip
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    obs = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("FURN-")]
    if chk("reimport: one FURN mesh", len(obs) == 1, [o.name for o in obs]):
        a, b = K.world_bbox(obs)
        rdims = [b[i] - a[i] for i in range(3)]
        chk("reimport: bbox matches glb", all(abs(u - v) <= 0.002 for u, v in zip(rdims, dims)),
            [round(v, 4) for v in rdims])
    raw = FS.raw_glb_path(t)
    res.update({"dims": [round(v, 4) for v in dims], "triangles": tris, "budget": budget, "materials": mats,
                "bytes": g.size, "exportBytes": raw.stat().st_size if raw.exists() else None,
                "class": FS.size_class(size)})
    return res


def main():
    t0 = time.time()
    catalog, assets = FS.load_catalog()
    env, _, _ = K.parse_palette()
    palette_names = set(env) | {"art_a", "art_b", "art_c"}
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    in_blend = sorted(o["kantor_type"] for o in bpy.data.objects if o.name.startswith("FURN-"))
    blend_ok = in_blend == sorted(catalog)
    results = {}
    for t, spec in catalog.items():
        results[t] = check_type(t, spec["size"], palette_names)
    failed = {t: [c for c in r["checks"] if not c["ok"]] for t, r in results.items()}
    failed = {t: f for t, f in failed.items() if f}
    sheet_ok = (ROOT / SHEET).exists() and (ROOT / SHEET).stat().st_size <= 400_000
    ok = blend_ok and sheet_ok and not failed
    n_checks = sum(len(r["checks"]) for r in results.values()) + 2
    report = {"tool": "blender/furniture/validate_furniture.py", "blender": bpy.app.version_string, "passed": ok,
              "types": len(results), "checks": n_checks, "blendTypes": len(in_blend), "blendHasAllTypes": blend_ok,
              "contactSheet": {"path": SHEET, "ok": sheet_ok,
                               "bytes": (ROOT / SHEET).stat().st_size if (ROOT / SHEET).exists() else None},
              "failed": failed, "seconds": round(time.time() - t0, 1), "results": results}
    EVID.mkdir(parents=True, exist_ok=True)
    (EVID / "furniture-validate.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    lines = [f"furniture validation: {'PASS' if ok else 'FAIL'} types={len(results)} checks={n_checks} "
             f"failed_types={len(failed)} blend_types={len(in_blend)} sheet_ok={sheet_ok} blender={bpy.app.version_string}",
             "type | dims [w,d,h] m | catalog | triangles/budget | glb bytes"]
    for t, r in results.items():
        lines.append(f"{t} | {r.get('dims')} | {catalog[t]['size']} | {r.get('triangles')}/{r.get('budget')} | {r.get('bytes')}")
    for t, f in failed.items():
        for c in f:
            lines.append(f"FAIL {t}: {c['check']}: {c['detail']}")
    (EVID / "furniture-validate.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    entries = []
    for t, r in results.items():
        w, d, h = catalog[t]["size"]
        e = {"id": assets[t], "kind": "furniture", "catalogType": t, "displayName": catalog[t].get("label"),
             "family": catalog[t].get("family"),
             "creator": "kantor-rpg procedural script (Claude Code)", "license": "original, project license TBD by owner",
             "source": "blender/furniture/build_furniture.py", "sourceData": "design/world.json#catalog",
             "blend": "blender/out/furniture.blend", "glb": r["glb"], "preview": SHEET,
             "dimensions": r.get("dims"), "pivot": "footprint centre on the floor, front -Y (glTF +Z)",
             "collider": {"type": "box", "size": [w, d, h]}, "materials": r.get("materials"),
             "triangles": {"lod0Visible": r.get("triangles"), "budget": r.get("budget"), "class": r.get("class")},
             "lod": "LOD0 only", "glbBytes": r.get("bytes"), "glbExportBytes": r.get("exportBytes"),
             "glbOptimisedBy": "tools/glb_optimize.mjs (KHR_mesh_quantization); equality with the export: "
                               "tools/glb_compare.py",
             "status": "generated+validated" if t not in failed and blend_ok else "generated+validation-failed",
             "validatedBy": "blender/furniture/validate_furniture.py", "evidence": str((EVID / "furniture-validate.json").relative_to(ROOT))}
        if t in FS.MOUNT_HEIGHT_M:
            e["mountHeightM"] = FS.MOUNT_HEIGHT_M[t]
        entries.append(e)
    registry.merge(entries)
    print("\n".join(lines[:1] + [ln for ln in lines if ln.startswith("FAIL")]))
    print(f"FURNITURE_VALIDATE_DONE passed={ok}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
