"""Validate building.blend and building-L*.glb against design/world.json.

Run:
  blender -b --factory-startup -noaudio --python blender/building/validate_building.py

Checks: every derived wall piece exists with its box (length, thickness,
position, height) within 1 cm; every door opening exists with a clear gap of
its width within 1 cm and no wall piece below the door head inside it; slab
extents and top elevation; room plates; stair/lift at their fixture positions;
glTF node names and bounds; the world (x, y, z) -> glTF (x, z, -y) mapping on
sample vertices from the binary buffer; a re-import round trip; triangle
counts per floor. Writes docs/evidence/M3/building-validate.json and .txt and
merges BLD-L* entries into design/asset-registry.json. Exit 1 on failure.
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
import time
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "lib"))
import building_spec as S  # noqa: E402
import glb_read as G  # noqa: E402
import registry  # noqa: E402

ROOT = S.ROOT
BLEND = ROOT / "blender" / "out" / "building.blend"
GLB_DIR = ROOT / "app" / "public" / "assets" / "building"
EVID = ROOT / "docs" / "evidence" / "M3"
TOL = 0.01


class Checks:
    def __init__(self):
        self.items = []

    def __call__(self, name, ok, detail=None):
        self.items.append({"check": name, "ok": bool(ok), "detail": detail})
        return ok

    def failed(self):
        return [i for i in self.items if not i["ok"]]


def box_of(spec):
    return (spec["x0"], spec["y0"], spec["z0"]), (spec["x1"], spec["y1"], spec["z1"])


def close(a, b, tol=TOL):
    return all(abs(u - v) <= tol for u, v in zip(a, b))


def obj_bounds(ob):
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    return (min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)), \
           (max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))


def expected_names(exp_floor, world, fid):
    names = {exp_floor["slab"]["id"], f"FASCIA-{fid}"}
    names |= {f"ROOM-{r}" for r in exp_floor["rooms"]}
    names |= {w["id"] for w in exp_floor["walls"]}
    names |= {o["id"] for o in exp_floor["openings"]}
    for v in exp_floor["vertical"]:
        if v["type"] == "stair_u":
            names.add(f"STAIR-{v['id']}" if exp_floor["elevation"] == 0 else f"STAIRWELL-{v['id']}")
        else:
            names.add(f"LIFT-{v['id']}")
    if fid == world["floors"][-1]["id"]:
        names.add("ROOF")
    return names


def check_floor_geometry(C, exp_floor, fid, bounds_of, label):
    """bounds_of(name) -> ((min), (max)) in world metres or None if missing."""
    for w in exp_floor["walls"]:
        b = bounds_of(w["id"])
        if not C(f"{label} {w['id']} present", b is not None):
            continue
        C(f"{label} {w['id']} box within 1 cm", close(b[0], box_of(w)[0]) and close(b[1], box_of(w)[1]),
          {"got": [list(map(lambda v: round(v, 4), b[0])), list(map(lambda v: round(v, 4), b[1]))],
           "want": [list(box_of(w)[0]), list(box_of(w)[1])]})
    walls_by_line = {}
    for w in exp_floor["walls"]:
        walls_by_line.setdefault((w["axis"], round((w["y0"] + w["y1"]) / 2 if w["axis"] == "x" else (w["x0"] + w["x1"]) / 2, 4)), []).append(w)
    for o in exp_floor["openings"]:
        b = bounds_of(o["id"])
        if not C(f"{label} {o['id']} present", b is not None):
            continue
        ax = 0 if o["axis"] == "x" else 1
        width = b[1][ax] - b[0][ax]
        C(f"{label} {o['id']} width {o['width']:.3f} within 1 cm", abs(width - o["width"]) <= TOL, round(width, 4))
        if o["part"] != "threshold":
            continue
        # clear gap: nearest wall faces on the same line either side of the opening
        lo, hi = b[0][ax], b[1][ax]
        line = [w for w in exp_floor["walls"] if w["axis"] == o["axis"]
                and abs(((w["y0"] + w["y1"]) / 2 if o["axis"] == "x" else (w["x0"] + w["x1"]) / 2)
                        - ((o["y0"] + o["y1"]) / 2 if o["axis"] == "x" else (o["x0"] + o["x1"]) / 2)) < 1e-6]
        left = [bounds_of(w["id"])[1][ax] for w in line if bounds_of(w["id"]) and bounds_of(w["id"])[1][ax] <= lo + TOL]
        right = [bounds_of(w["id"])[0][ax] for w in line if bounds_of(w["id"]) and bounds_of(w["id"])[0][ax] >= hi - TOL]
        if left and right:
            gap = min(right) - max(left)
            C(f"{label} {o['door']} clear gap within 1 cm", abs(gap - o["width"]) <= TOL, round(gap, 4))
        intrude = [w["id"] for w in exp_floor["walls"] if bounds_of(w["id"])
                   and _overlap(bounds_of(w["id"]), b, o)]
        C(f"{label} {o['door']} opening free of wall pieces", not intrude, intrude)
    sl = exp_floor["slab"]
    b = bounds_of(sl["id"])
    if C(f"{label} {sl['id']} present", b is not None):
        C(f"{label} {sl['id']} extents 32 x 24", abs((b[1][0] - b[0][0]) - (sl["x1"] - sl["x0"])) <= TOL and
          abs((b[1][1] - b[0][1]) - (sl["y1"] - sl["y0"])) <= TOL,
          [round(b[1][0] - b[0][0], 4), round(b[1][1] - b[0][1], 4)])
        C(f"{label} {sl['id']} top at elevation {exp_floor['elevation']}", abs(b[1][2] - exp_floor["elevation"]) <= TOL,
          round(b[1][2], 4))
    for v in exp_floor["vertical"]:
        name = (f"STAIR-{v['id']}" if exp_floor["elevation"] == 0 else f"STAIRWELL-{v['id']}") \
            if v["type"] == "stair_u" else f"LIFT-{v['id']}"
        b = bounds_of(name)
        if not C(f"{label} {name} present", b is not None):
            continue
        cx, cy = (b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2
        w_, d_ = (v["size"][0], v["size"][1]) if v["rot"] % 180 == 0 else (v["size"][1], v["size"][0])
        C(f"{label} {name} centred on fixture", abs(cx - v["pos"][0]) <= TOL and abs(cy - v["pos"][1]) <= TOL,
          [round(cx, 4), round(cy, 4), v["pos"]])
        C(f"{label} {name} footprint", abs((b[1][0] - b[0][0]) - w_) <= TOL and abs((b[1][1] - b[0][1]) - d_) <= TOL,
          [round(b[1][0] - b[0][0], 4), round(b[1][1] - b[0][1], 4)])
        C(f"{label} {name} base at floor", abs(b[0][2] - exp_floor["elevation"]) <= TOL, round(b[0][2], 4))


def _overlap(wb, ob, o):
    """Wall box intrudes into the opening's clear prism (below the door head)?"""
    eps = 0.002
    x_ok = wb[0][0] < ob[1][0] - eps and wb[1][0] > ob[0][0] + eps
    y_ok = wb[0][1] < ob[1][1] - eps and wb[1][1] > ob[0][1] + eps
    z_ok = wb[0][2] < o["z0"] + S.DOOR_HEAD - eps
    return x_ok and y_ok and z_ok


def main():
    t0 = time.time()
    world = S.load_world()
    walls = S.load_walls(world)
    exp = S.building_expectations(world, walls)
    C = Checks()
    report = {"tool": "blender/building/validate_building.py", "blender": bpy.app.version_string,
              "worldRevision": world["revision"]["id"], "floors": {}}
    # 1. reopened .blend
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    blend_bounds = {o.name: obj_bounds(o) for o in bpy.data.objects if o.type == "MESH"}
    blend_tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH"}
    sample = {o.name: [tuple(o.matrix_world @ v.co) for v in o.data.vertices[:8]] for o in bpy.data.objects
              if o.type == "MESH" and o.name.startswith("WALL-")}
    C("blend world revision", bpy.context.scene.get("kantor_world_revision") == world["revision"]["id"],
      bpy.context.scene.get("kantor_world_revision"))
    for f in world["floors"]:
        fid = f["id"]
        ef = exp[fid]
        names = expected_names(ef, world, fid)
        floor_objs = {o.name for o in bpy.data.objects if o.get("kantor_floor") == fid}
        C(f"blend {fid} object set equals spec", floor_objs == names,
          {"missing": sorted(names - floor_objs), "extra": sorted(floor_objs - names)})
        check_floor_geometry(C, ef, fid, lambda n: blend_bounds.get(n), f"blend {fid}")
        for r in ef["rooms"]:
            b = blend_bounds.get(f"ROOM-{r}")
            if C(f"blend {fid} ROOM-{r} present", b is not None):
                C(f"blend {fid} ROOM-{r} at floor finish level", abs(b[0][2] - (f["elevation"] + 0.006)) <= 0.002, round(b[0][2], 4))
        report["floors"][fid] = {"blendTriangles": sum(blend_tris[n] for n in names if n in blend_tris),
                                 "objects": len(names), "walls": len(ef["walls"]),
                                 "openings": len(ef["openings"]) // 2}
    # 2. GLB parse (stdlib) and axis mapping on sample vertices
    for f in world["floors"]:
        fid = f["id"]
        ef = exp[fid]
        path = GLB_DIR / f"building-{fid}.glb"
        if not C(f"glb {fid} exists", path.exists(), str(path.relative_to(ROOT))):
            continue
        g = G.Glb(path)
        nodes = g.nodes_by_name()
        names = expected_names(ef, world, fid)
        mesh_nodes = {n for n, v in nodes.items() if "mesh" in v}
        C(f"glb {fid} node names equal spec", mesh_nodes == names,
          {"missing": sorted(names - mesh_nodes), "extra": sorted(mesh_nodes - names)})
        C(f"glb {fid} nodes carry no transform", all(not any(k in v for k in ("translation", "rotation", "scale", "matrix"))
                                                    for v in nodes.values()))

        def gb(n, g=g, nodes=nodes):
            if n not in nodes or "mesh" not in nodes[n]:
                return None
            return G.world_bounds(*g.node_bounds(n))
        check_floor_geometry(C, ef, fid, gb, f"glb {fid}")
        mapped, total = 0, 0
        for wname, pts in sample.items():
            if wname not in nodes:
                continue
            pos = set()
            for p in g.mesh_primitives(wname):
                pos |= {tuple(round(c, 4) for c in v) for v in g.accessor(p["attributes"]["POSITION"])}
            for p in pts:
                total += 1
                q = tuple(round(c, 4) for c in S.world_to_gltf(p))
                mapped += q in pos
        C(f"glb {fid} axis mapping world (x,y,z) -> gltf (x,z,-y) on sample vertices", total > 0 and mapped == total,
          {"matched": mapped, "sampled": total})
        tris = sum(g.node_triangles(n) for n in mesh_nodes)
        report["floors"][fid].update({"glb": str(path.relative_to(ROOT)), "glbBytes": g.size, "glbTriangles": tris})
    # 3. importer round trip
    for f in world["floors"]:
        fid = f["id"]
        path = GLB_DIR / f"building-{fid}.glb"
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(path))
        imp = {o.name.split(".")[0]: obj_bounds(o) for o in bpy.data.objects if o.type == "MESH"}
        bad = [n for n, b in imp.items() if n in blend_bounds and not (close(b[0], blend_bounds[n][0]) and close(b[1], blend_bounds[n][1]))]
        C(f"reimport {fid} bounds match .blend within 1 cm", not bad and len(imp) == report["floors"][fid]["objects"],
          {"mismatch": bad[:10], "imported": len(imp)})
    ok = not C.failed()
    report.update({"passed": ok, "checks": len(C.items), "failed": C.failed(), "seconds": round(time.time() - t0, 1),
                   "gitHead": _git_head(), "items": C.items})
    EVID.mkdir(parents=True, exist_ok=True)
    (EVID / "building-validate.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    lines = [f"building validation: {'PASS' if ok else 'FAIL'} checks={len(C.items)} failed={len(C.failed())} "
             f"world={world['revision']['id']} blender={bpy.app.version_string}"]
    for fid, r in report["floors"].items():
        lines.append(f"{fid}: objects={r['objects']} walls={r['walls']} openings={r['openings']} "
                     f"triangles_blend={r['blendTriangles']} triangles_glb={r.get('glbTriangles')} glb_bytes={r.get('glbBytes')}")
    for item in C.failed():
        lines.append(f"FAIL {item['check']}: {item['detail']}")
    (EVID / "building-validate.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    entries = []
    for f in world["floors"]:
        fid = f["id"]
        r = report["floors"][fid]
        entries.append({
            "id": f"BLD-{fid}", "kind": "building", "displayName": f["name"],
            "creator": "kantor-rpg procedural script (Claude Code)", "license": "original, project license TBD by owner",
            "source": "blender/building/build_building.py", "sourceData": "design/world.json + design/derived/walls.json",
            "blend": "blender/out/building.blend", "glb": r.get("glb"),
            "preview": f"assets/previews/building-{fid}-interior.png",
            "previewsExtra": ["assets/previews/building-exterior.png"],
            "dimensions": [32, 24, world["building"]["floorToFloor"]], "pivot": "world origin (south-west corner of L1)",
            "collider": {"type": "derived", "source": "design/derived/walls.json"},
            "materials": None, "triangles": {"lod0Visible": r.get("glbTriangles")}, "lod": "LOD0 only",
            "status": "generated+validated" if ok else "generated+validation-failed",
            "validatedBy": "blender/building/validate_building.py", "evidence": "docs/evidence/M3/building-validate.json",
            "note": "concept geometry, not a construction model; walls full 3.0 m height (runtime cuts away)"})
    if ok:
        g = G.Glb(GLB_DIR / "building-L1.glb")
        mats = sorted({m["name"] for m in g.doc.get("materials", [])})
        for e in entries:
            e["materials"] = mats if e["id"] == "BLD-L1" else sorted({m["name"] for m in G.Glb(GLB_DIR / "building-L2.glb").doc["materials"]})
    registry.merge(entries)
    print("\n".join(lines))
    print(f"BUILDING_VALIDATE_DONE passed={ok}")
    sys.exit(0 if ok else 1)


def _git_head():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return None


if __name__ == "__main__":
    main()
