"""Reopen generated character sources and GLBs and check them against design/characters.json.

Run:
  blender -b --factory-startup -noaudio --python blender/validate_assets.py -- [--only CH-CEO] [--no-registry]

Checks per character
  .blend: armature + shared bone set, skinned meshes with no unweighted
          vertices, exact action set and clip lengths, LOD0 triangle budget,
          rest-pose height within tolerance, feet on Z=0, facing -Y,
          required material names, floor contact in every clip, seat height
          for seated clips, and measured foot slip during walk/run stance.
  .glb:   GLB header/chunks, animation names, skin joints, hair/prop nodes,
          materials, size budget; then a re-import into an empty scene to
          re-measure height, feet, facing and triangles after the round trip.
Writes docs/evidence/M1/blender-validate.json and (unless --no-registry)
merges measured values into design/asset-registry.json. Exit code 1 on any failure.
"""
from __future__ import annotations

import json
import math
import struct
import subprocess
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "design" / "characters.json"
REGISTRY = ROOT / "design" / "asset-registry.json"
REPORT = ROOT / "docs" / "evidence" / "M1" / "blender-validate.json"
SCRIPT = "blender/characters/build_characters.py"
SEATED = {"sit", "type", "game"}


def rel(p: Path) -> str:
    return p.relative_to(ROOT).as_posix()


def read_glb_json(path: Path):
    b = path.read_bytes()
    magic, version, length = struct.unpack("<4sII", b[:12])
    if magic != b"glTF" or version != 2 or length != len(b):
        raise ValueError(f"bad GLB header magic={magic} version={version} length={length} size={len(b)}")
    clen, ctype = struct.unpack("<I4s", b[12:20])
    if ctype != b"JSON":
        raise ValueError("first chunk is not JSON")
    j = json.loads(b[20:20 + clen])
    rest = b[20 + clen:]
    has_bin = len(rest) >= 8 and struct.unpack("<I4s", rest[:8])[1] == b"BIN\x00"
    return j, has_bin


class Check:
    def __init__(self):
        self.items = []

    def __call__(self, name, ok, detail=None):
        self.items.append({"check": name, "ok": bool(ok), "detail": detail})
        return ok

    @property
    def ok(self):
        return all(i["ok"] for i in self.items)

    def failures(self):
        return [i for i in self.items if not i["ok"]]


def eval_mesh_world(ob, dg):
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ob.matrix_world
    pts = [mw @ v.co for v in me.vertices]
    tris = len(me.loop_triangles) if me.loop_triangles else 0
    if not tris:
        me.calc_loop_triangles()
        tris = len(me.loop_triangles)
    mat_of_vert = {}
    for poly in me.polygons:
        name = me.materials[poly.material_index].name if me.materials else ""
        for vi in poly.vertices:
            mat_of_vert.setdefault(vi, name)
    ev.to_mesh_clear()
    return pts, tris, mat_of_vert


def bbox(pts):
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def is_char_mesh(o):
    # the glTF importer adds helper meshes (bone display shapes); only count our nodes
    n = strip_suffix(o.name)
    return o.type == "MESH" and (n == "body" or n.startswith("hair_") or n.startswith("prop_"))


def visible_meshes(objs, default_hair):
    return [o for o in objs if is_char_mesh(o) and (not strip_suffix(o.name).startswith("hair_")
                                                    or strip_suffix(o.name) == default_hair)]


def strip_suffix(name):
    # the glTF importer may add .001 style suffixes when names collide
    return name.split(".")[0]


def measure_static(objs, default_hair, req_mats):
    dg = bpy.context.evaluated_depsgraph_get()
    vis = visible_meshes(objs, default_hair)
    all_pts, tri_visible, tri_total = [], 0, 0
    eye_pts, body_pts, mats = [], [], set()
    per_node = {}
    for o in objs:
        if not is_char_mesh(o):
            continue
        pts, tris, mov = eval_mesh_world(o, dg)
        per_node[strip_suffix(o.name)] = tris
        tri_total += tris
        mats.update(strip_suffix(m.name) for m in o.data.materials if m)
        if o in vis:
            tri_visible += tris
            all_pts += pts
            for i, p in enumerate(pts):
                if strip_suffix(mov.get(i, "")) == "eye_iris":
                    eye_pts.append(p)
            if strip_suffix(o.name) == "body":
                body_pts = pts
    mn, mx = bbox(all_pts)
    eye_c = sum(eye_pts, Vector()) / max(1, len(eye_pts))
    body_c = sum(body_pts, Vector()) / max(1, len(body_pts))
    return {
        "bbox_min": [round(v, 4) for v in mn], "bbox_max": [round(v, 4) for v in mx],
        "height": round(mx.z - mn.z, 4), "feet_z": round(mn.z, 4),
        "dimensions": [round(mx.x - mn.x, 3), round(mx.y - mn.y, 3), round(mx.z - mn.z, 3)],
        "eye_centroid": [round(v, 4) for v in eye_c], "body_centroid": [round(v, 4) for v in body_c],
        "tri_visible": tri_visible, "tri_total": tri_total, "per_node": per_node,
        "materials": sorted(mats), "missing_materials": sorted(set(req_mats) - mats),
    }


def check_blend(cid, spec, data, C: Check):
    path = ROOT / "blender" / "out" / f"{cid.lower()}.blend"
    if not C("blend exists", path.exists(), rel(path)):
        return {}
    bpy.ops.wm.open_mainfile(filepath=str(path))
    rig = bpy.data.objects.get("rig")
    C("armature present", rig is not None and rig.type == "ARMATURE")
    if rig is None:
        return {}
    bones = [b.name for b in rig.data.bones]
    C("bone set matches shared skeleton", sorted(bones) == sorted(data["rig"]["bones"]), bones)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    names = sorted(o.name for o in meshes)
    var = data.get("avatarVariants", {}).get(cid)
    hair_expected = sorted("hair_" + h for h in (var["hairStyles"] if var else [spec["hair"]["style"]]))
    default_hair = "hair_" + (var["defaultHair"] if var else spec["hair"]["style"])
    C("hair nodes", sorted(n for n in names if n.startswith("hair_")) == hair_expected, names)
    C("default hair extra", rig.get("kantor_default_hair") == default_hair, rig.get("kantor_default_hair"))
    unweighted, bad_groups, no_mod = 0, set(), []
    for o in meshes:
        mod = next((m for m in o.modifiers if m.type == "ARMATURE"), None)
        if mod is None or mod.object != rig:
            no_mod.append(o.name)
        gnames = {g.index: g.name for g in o.vertex_groups}
        bad_groups |= {n for n in gnames.values() if n not in bones}
        for v in o.data.vertices:
            if sum(g.weight for g in v.groups) <= 1e-6:
                unweighted += 1
    C("every mesh skinned to rig", not no_mod, no_mod)
    C("no unweighted vertices", unweighted == 0, unweighted)
    C("vertex groups are bones", not bad_groups, sorted(bad_groups))
    # actions
    req = data["animations"]
    acts = {a.name: a for a in bpy.data.actions}
    C("action names exact", sorted(acts) == sorted(req), sorted(acts))
    fps = data["rig"]["fps"]
    for name, meta in req.items():
        a = acts.get(name)
        if a is None:
            continue
        n = a.frame_range[1] - a.frame_range[0]
        C(f"clip length {name}", abs(n / fps - meta["durationS"]) < 1.01 / fps, round(n / fps, 3))
    nla = [t.name for t in rig.animation_data.nla_tracks] if rig.animation_data else []
    C("NLA tracks hold every clip", sorted(nla) == sorted(req), nla)
    # static measures in rest pose
    rig.animation_data.action = None
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    req_mats = data["materialNames"]["required"]
    m = measure_static(bpy.data.objects, default_hair, req_mats)
    H = spec["body"]["heightM"]
    tol = data["budgets"]["heightTolerance"]
    budget = data["budgets"]["playerTrianglesLOD0" if spec["kind"] == "player" else "npcTrianglesLOD0"]
    C("LOD0 triangles within budget", m["tri_visible"] <= budget, {"visible": m["tri_visible"], "budget": budget})
    if var:
        C("all-variant triangles within player budget", m["tri_total"] <= budget, m["tri_total"])
    C("height within tolerance", abs(m["height"] - H) <= tol * H, {"measured": m["height"], "spec": H})
    C("feet on floor", -0.004 <= m["feet_z"] <= 0.004, m["feet_z"])
    C("faces -Y", m["eye_centroid"][1] < m["body_centroid"][1] - 0.08 and abs(m["eye_centroid"][0]) < 0.02,
      {"eyes": m["eye_centroid"], "body": m["body_centroid"]})
    C("required materials", not m["missing_materials"], m["missing_materials"])
    # pose checks
    rig.data.pose_position = "POSE"
    sc = bpy.context.scene
    body = bpy.data.objects["body"]
    pb = rig.pose.bones
    clip = {}
    ankle_rest = rig.data.bones["foot_L"].head_local.z
    for name, meta in req.items():
        a = acts[name]
        rig.animation_data.action = a
        n = int(a.frame_range[1])
        min_z, floor_touch = 1e9, 1e9
        hips_min = 1e9
        samples = []
        for f in range(0, n + 1):
            sc.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            if f % 3 == 0 or f == n:
                pts, _, _ = eval_mesh_world(body, dg)
                z = min(p.z for p in pts)
                min_z = min(min_z, z)
                floor_touch = min(floor_touch, z)
                if name in SEATED:
                    hz = rig.matrix_world @ pb["hips"].head
                    hips_min = min(hips_min, hz.z)
            samples.append((f, (rig.matrix_world @ pb["foot_L"].head).copy()))
        info = {"min_z": round(min_z, 4)}
        if name in SEATED:
            # pelvis underside relative to the hips joint is fixed by the rig
            pelvis_drop = rig.data.bones["hips"].head_local.z - (spec_hip_bottom(rig))
            info["pelvis_underside_z"] = round(hips_min - pelvis_drop, 4)
            C(f"{name}: pelvis on {data['rig']['seatHeightM']} m seat",
              abs(info["pelvis_underside_z"] - data["rig"]["seatHeightM"]) <= 0.03, info["pelvis_underside_z"])
        else:
            C(f"{name}: no floor penetration (6 mm tolerance)", min_z >= -0.006, round(min_z, 4))
            C(f"{name}: a foot touches the floor", floor_touch <= 0.03, round(floor_touch, 4))
        if name in ("walk", "run"):
            speed = rig.get(f"kantor_{name}_native_speed_mps")
            planted = [(f, p) for f, p in samples if p.z <= ankle_rest + 0.002]
            vels = []
            for (f0, p0), (f1, p1) in zip(planted, planted[1:]):
                if f1 == f0 + 1:
                    vels.append((p1.y - p0.y) * fps)
            slip = (sum(abs(v - speed) for v in vels) / len(vels) / speed) if vels else None
            info.update({"native_speed_mps": speed, "planted_frames": len(planted),
                         "mean_stance_speed_mps": round(sum(vels) / len(vels), 3) if vels else None,
                         "slip_ratio": round(slip, 4) if slip is not None else None})
            C(f"{name}: planted foot speed matches root speed (slip < 5%)", slip is not None and slip < 0.05, info)
        clip[name] = info
    rig.animation_data.action = None
    return {"blend": rel(path), "static": m, "clips": clip, "default_hair": default_hair,
            "loco": {k: rig[k] for k in rig.keys() if k.startswith("kantor_") and "speed" in k}}


def spec_hip_bottom(rig):
    """Lowest rest-pose vertex dominated by the hips group (pelvis underside)."""
    body = bpy.data.objects["body"]
    gi = body.vertex_groups["hips"].index
    zs = []
    for v in body.data.vertices:
        w = {g.group: g.weight for g in v.groups}
        if w.get(gi, 0) > 0.99:
            zs.append(v.co.z)
    return min(zs)


def check_glb(cid, spec, data, C: Check):
    path = ROOT / "app" / "public" / "assets" / "characters" / f"{cid.lower()}.glb"
    if not C("glb exists", path.exists(), rel(path)):
        return {}
    size = path.stat().st_size
    C("glb size within target", size <= data["budgets"]["glbBytesTarget"], size)
    j, has_bin = read_glb_json(path)
    C("glb has BIN chunk", has_bin)
    anims = sorted(a["name"] for a in j.get("animations", []))
    C("glb animation names exact", anims == sorted(data["animations"]), anims)
    skins = j.get("skins", [])
    C("glb has a skin", len(skins) >= 1, len(skins))
    nodes = [n.get("name") for n in j["nodes"]]
    joints = sorted(nodes[i] for i in skins[0]["joints"]) if skins else []
    C("glb joints are the shared skeleton", joints == sorted(data["rig"]["bones"]), joints)
    var = data.get("avatarVariants", {}).get(cid)
    hair_expected = sorted("hair_" + h for h in (var["hairStyles"] if var else [spec["hair"]["style"]]))
    C("glb hair nodes", sorted(n for n in nodes if n and n.startswith("hair_")) == hair_expected, nodes)
    mats = sorted(m["name"] for m in j.get("materials", []))
    missing = sorted(set(data["materialNames"]["required"]) - set(mats))
    C("glb required materials", not missing, missing)
    durations = {}
    for a in j.get("animations", []):
        tmax = max(j["accessors"][s["input"]]["max"][0] for s in a["samplers"])
        durations[a["name"]] = round(tmax, 4)
        exp = data["animations"][a["name"]]["durationS"]
        C(f"glb clip duration {a['name']}", abs(tmax - exp) < 1.01 / data["rig"]["fps"], round(tmax, 4))
    # round trip through the importer
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    C("reimport: one armature", len(arms) == 1, [o.name for o in arms])
    for a in arms:
        a.data.pose_position = "REST"
        if a.animation_data:
            a.animation_data.action = None
    bpy.context.view_layer.update()
    default_hair = "hair_" + (var["defaultHair"] if var else spec["hair"]["style"])
    m = measure_static(bpy.data.objects, default_hair, data["materialNames"]["required"])
    H = spec["body"]["heightM"]
    tol = data["budgets"]["heightTolerance"]
    C("reimport: height within tolerance", abs(m["height"] - H) <= tol * H, m["height"])
    C("reimport: feet on floor", -0.004 <= m["feet_z"] <= 0.004, m["feet_z"])
    C("reimport: faces -Y (glTF +Z)", m["eye_centroid"][1] < m["body_centroid"][1] - 0.08, m["eye_centroid"])
    C("reimport: actions present", len(bpy.data.actions) >= len(data["animations"]), len(bpy.data.actions))
    return {"glb": rel(path), "bytes": size, "animations": anims, "durations": durations, "nodes": nodes,
            "materials": mats, "reimport": {k: m[k] for k in ("height", "feet_z", "tri_visible", "tri_total",
                                                               "eye_centroid", "dimensions")}}


def check_previews(cid, data, C: Check):
    out = []
    names = [f"{cid.lower()}-sheet.png"]
    if cid == "CH-CEO":
        names += ["ch-ceo-deform.png", "ch-ceo-variants.png"]
    for n in names:
        p = ROOT / "assets" / "previews" / n
        ok = p.exists() and p.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
        C(f"preview {n}", ok and p.stat().st_size <= data["budgets"]["previewBytesMax"],
          p.stat().st_size if p.exists() else "missing")
        out.append(rel(p))
    return out


def git_head():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception:
        return None


def update_registry(results, data):
    reg = json.loads(REGISTRY.read_text()) if REGISTRY.exists() else {}
    reg.setdefault("schemaVersion", 1)
    reg.setdefault("description", "Asset registry (PRD section 6). Paths are repo-relative. Measured fields come "
                                  "from blender/validate_assets.py; do not edit them by hand.")
    assets = [a for a in reg.get("assets", []) if a.get("id") not in results]
    for cid, r in results.items():
        spec = data["characters"][cid]
        b, g = r.get("blend_report", {}), r.get("glb_report", {})
        st = b.get("static", {})
        h = st.get("height")
        entry = {
            "id": cid,
            "kind": "character",
            "displayName": spec["displayName"],
            "role": spec["role"],
            "actor": spec.get("actor"),
            "creator": "kantor-rpg procedural script (Claude Code)",
            "license": "original, project license TBD by owner",
            "source": SCRIPT,
            "sourceData": "design/characters.json",
            "blend": b.get("blend"),
            "glb": g.get("glb"),
            "preview": r["previews"][0] if r.get("previews") else None,
            "previewsExtra": r.get("previews", [])[1:],
            "dimensions": st.get("dimensions"),
            "dimensionsNote": "[w, d, h] metres, rest pose, visible nodes only (default hair)",
            "pivot": "feet center",
            "facing": "-Y Blender / +Z glTF",
            "collider": {"type": "capsule", "radius": 0.25, "height": h},
            "materials": g.get("materials"),
            "triangles": {"lod0Visible": st.get("tri_visible"), "allNodes": st.get("tri_total"),
                          "perNode": st.get("per_node"),
                          "budget": data["budgets"]["playerTrianglesLOD0" if spec["kind"] == "player"
                                                    else "npcTrianglesLOD0"]},
            "lod": "LOD0 only",
            "animations": g.get("animations"),
            "animationDurationsS": g.get("durations"),
            "locomotion": b.get("loco"),
            "nodes": {
                "hair": sorted(n for n in g.get("nodes", []) if n and n.startswith("hair_")),
                "defaultHair": b.get("default_hair"),
                "props": sorted(n for n in g.get("nodes", []) if n and n.startswith("prop_")),
            },
            "glbBytes": g.get("bytes"),
            "status": "generated+validated" if r["ok"] else "generated+validation-failed",
            "validatedBy": "blender/validate_assets.py",
            "evidence": rel(REPORT),
        }
        if cid in data.get("avatarVariants", {}):
            v = data["avatarVariants"][cid]
            entry["avatarVariants"] = {
                "approach": "single GLB; show exactly one hair_<style> node; recolor materials by name",
                "hairNodes": ["hair_" + h for h in v["hairStyles"]],
                "palettes": sorted(v["palettes"]),
                "paletteMaterials": ["outfit_main", "outfit_inner", "outfit_bottom", "outfit_accent"],
                "source": "design/characters.json#avatarVariants",
            }
        assets.append(entry)
    order = list(data["characters"])
    assets.sort(key=lambda a: (order.index(a["id"]) if a.get("id") in order else len(order), a.get("id", "")))
    reg["assets"] = assets
    REGISTRY.write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    data = json.loads(DATA.read_text(encoding="utf-8"))
    ids = [argv[argv.index("--only") + 1]] if "--only" in argv else list(data["characters"])
    t0 = time.time()
    results = {}
    for cid in ids:
        spec = data["characters"][cid]
        C = Check()
        try:
            br = check_blend(cid, spec, data, C)
        except Exception as exc:
            C("blend checks ran", False, repr(exc))
            br = {}
        try:
            gr = check_glb(cid, spec, data, C)
        except Exception as exc:
            C("glb checks ran", False, repr(exc))
            gr = {}
        prev = check_previews(cid, data, C)
        results[cid] = {"ok": C.ok, "checks": C.items, "blend_report": br, "glb_report": gr, "previews": prev}
        st = br.get("static", {})
        print(f"VALIDATE {cid}: {'PASS' if C.ok else 'FAIL'} checks={len(C.items)} failed={len(C.failures())} "
              f"tris_lod0={st.get('tri_visible')} tris_all={st.get('tri_total')} height={st.get('height')} "
              f"glb_bytes={gr.get('bytes')}")
        for f in C.failures():
            print(f"  FAIL {f['check']}: {f['detail']}")
    ok = all(r["ok"] for r in results.values())
    report = {
        "tool": "blender/validate_assets.py",
        "blender": bpy.app.version_string,
        "gitHead": git_head(),
        "worktreeNote": "gitHead is the commit the files were validated on top of; generated files may be uncommitted",
        "seconds": round(time.time() - t0, 1),
        "passed": ok,
        "characters": {cid: {k: v for k, v in r.items()} for cid, r in results.items()},
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    if "--only" not in argv:
        REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        if "--no-registry" not in argv:
            update_registry(results, data)
    print(f"VALIDATE_DONE passed={ok} characters={len(results)} seconds={report['seconds']}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
