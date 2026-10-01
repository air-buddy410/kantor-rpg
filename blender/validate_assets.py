"""Reopen generated character sources and GLBs and check them against design/characters.json.

Run:
  blender -b --factory-startup -noaudio --python blender/validate_assets.py -- [--only CH-CEO] [--no-registry]

Checks per character
  .blend: armature + shared bone set, skinned meshes with no unweighted
          vertices, exact action set and clip lengths, LOD0 triangle budget,
          rest-pose height within tolerance, feet on Z=0, facing -Y, one
          material (kantor_atlas) on every mesh, packed 32 px atlas whose cells
          hold the zone colours, every UV on a cell centre, zones in the rig
          extras cover every zone used, five expression shape keys with
          non-zero deltas on head-weighted vertices only, lod1 (skinned,
          <= 5k triangles, no shape keys) that follows LOD0 through every clip,
          floor contact in every clip, seat height for seated clips, measured
          foot slip during walk/run stance, and a morph applied on top of a clip.
  .glb:   GLB header/chunks, animation names, skin joints, hair/prop/lod1 nodes,
          one material + one embedded PNG (decoded, cell colours compared),
          NEAREST sampler, one primitive per mesh node, visible LOD0 primitive
          count, morph target names (mesh extras targetNames) and their sparse
          deltas confined to vertices skinned 100 percent to the head joint,
          scene + rig extras, size budget; then a re-import into an empty scene
          to re-measure height, feet, facing, shape keys and lod1 after the
          round trip.
Writes docs/evidence/HARDENING/blender-characters-validate.json and .txt and
(unless --no-registry) merges measured values into design/asset-registry.json.
Exit code 1 on any failure.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "blender" / "lib"))
sys.path.insert(0, str(ROOT / "blender" / "characters"))
import build_characters as BC  # noqa: E402  (pure helpers only; main() is guarded)
import glb_read as G  # noqa: E402

DATA = ROOT / "design" / "characters.json"
REGISTRY = ROOT / "design" / "asset-registry.json"
EVID = ROOT / "docs" / "evidence" / "HARDENING"
REPORT = EVID / "blender-characters-validate.json"
REPORT_TXT = EVID / "blender-characters-validate.txt"
SCRIPT = "blender/characters/build_characters.py"
SEATED = {"sit", "type", "game"}
MIN_MORPH_M = 0.002  # an expression must move some face vertex at least 2 mm
LOD_BBOX_TOL = 0.03  # lod1 world bbox vs LOD0 world bbox in every sampled pose


def rel(p: Path) -> str:
    return p.relative_to(ROOT).as_posix()


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


def strip_suffix(name):
    # the glTF importer may add .001 style suffixes when names collide
    return name.split(".")[0]


def is_char_mesh(o):
    # the glTF importer adds helper meshes (bone display shapes); only count our nodes
    n = strip_suffix(o.name)
    return o.type == "MESH" and (n in ("body", "lod1") or n.startswith("hair_") or n.startswith("prop_"))


def lod0_visible(o, default_hair):
    n = strip_suffix(o.name)
    return is_char_mesh(o) and n != "lod1" and (not n.startswith("hair_") or n == default_hair)


class Zones:
    """Atlas layout from the rig extras: UV -> zone name."""

    def __init__(self, meta):
        self.size, self.cell = int(meta["size"]), int(meta["cell"])
        self.cells = {z: tuple(int(c) for c in v) for z, v in meta["zones"].items()}
        self.at = {v: z for z, v in self.cells.items()}

    def of_blender_uv(self, u, v):
        return self.at.get((int(u * self.size // self.cell), int((1.0 - v) * self.size // self.cell)))

    def poly_zones(self, me):
        """Zone per polygon from the first loop UV, plus the max distance of any loop UV to its cell centre."""
        n = len(me.polygons)
        starts = np.zeros(n, dtype=np.int32)
        me.polygons.foreach_get("loop_start", starts)
        uv = np.zeros(len(me.loops) * 2, dtype=np.float32)
        me.uv_layers.active.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        k = self.size / self.cell
        centre = (np.floor(uv * k) + 0.5) / k
        off = float(np.abs(uv - centre).max()) if len(uv) else 0.0
        first = uv[starts]
        zones = [self.of_blender_uv(float(u), float(v)) for u, v in first]
        return zones, off


def eval_mesh_world(ob, dg, zones: Zones | None = None):
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ob.matrix_world
    pts = [mw @ v.co for v in me.vertices]
    me.calc_loop_triangles()
    tris = len(me.loop_triangles)
    zone_of_vert = {}
    if zones is not None and me.uv_layers:
        pz, _ = zones.poly_zones(me)
        for poly, z in zip(me.polygons, pz):
            for vi in poly.vertices:
                zone_of_vert.setdefault(vi, z)
    ev.to_mesh_clear()
    return pts, tris, zone_of_vert


def bbox(pts):
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def measure_static(objs, default_hair, zones: Zones):
    dg = bpy.context.evaluated_depsgraph_get()
    all_pts, tri_visible, tri_total = [], 0, 0
    eye_pts, body_pts, used = [], [], set()
    per_node = {}
    for o in objs:
        if not is_char_mesh(o):
            continue
        pts, tris, zov = eval_mesh_world(o, dg, zones)
        name = strip_suffix(o.name)
        per_node[name] = tris
        used |= {z for z in zov.values()}
        if name == "lod1":
            continue
        tri_total += tris
        if lod0_visible(o, default_hair):
            tri_visible += tris
            all_pts += pts
            for i, p in enumerate(pts):
                if zov.get(i) == "eye_iris":
                    eye_pts.append(p)
            if name == "body":
                body_pts = pts
    mn, mx = bbox(all_pts)
    eye_c = sum(eye_pts, Vector()) / max(1, len(eye_pts))
    body_c = sum(body_pts, Vector()) / max(1, len(body_pts))
    return {
        "bbox_min": [round(v, 4) for v in mn], "bbox_max": [round(v, 4) for v in mx],
        "height": round(mx.z - mn.z, 4), "feet_z": round(mn.z, 4),
        "dimensions": [round(mx.x - mn.x, 3), round(mx.y - mn.y, 3), round(mx.z - mn.z, 3)],
        "eye_centroid": [round(v, 4) for v in eye_c], "body_centroid": [round(v, 4) for v in body_c],
        "eye_vertices": len(eye_pts),
        "tri_visible": tri_visible, "tri_total": tri_total, "tri_lod1": per_node.get("lod1"), "per_node": per_node,
        "zones_used": sorted(z for z in used if z), "unmapped_zone": None in used,
    }


def expected_layout(data):
    a = data["atlas"]
    return {z: (i % a["columns"], i // a["columns"]) for i, z in enumerate(a["zoneOrder"])}


def check_atlas_blend(C, data, spec, rig):
    a = data["atlas"]
    meta = rig.get("kantor_atlas")
    if not C("rig extras kantor_atlas present", meta is not None):
        return None
    meta = meta.to_dict()
    zones = Zones(meta)
    C("atlas extras size/cell match spec", (zones.size, zones.cell) == (a["sizePx"], a["cellPx"]),
      [zones.size, zones.cell])
    C("atlas extras layout matches characters.json zoneOrder", zones.cells == expected_layout(data), meta["zones"])
    C("scene extras kantor_atlas equals rig extras",
      bpy.context.scene.get("kantor_atlas") is not None and bpy.context.scene["kantor_atlas"].to_dict() == meta)
    used_mats = sorted({m.name for m in bpy.data.materials if m.users})
    C("one material in the file (kantor_atlas)", used_mats == [a["material"]], used_mats)
    img = bpy.data.images.get(a["material"])
    if not C("atlas image present and packed", img is not None and img.packed_file is not None,
             img.name if img else None):
        return zones
    C(f"atlas image {a['sizePx']} x {a['sizePx']} px", tuple(img.size) == (a["sizePx"], a["sizePx"]), list(img.size))
    mat = bpy.data.materials[a["material"]]
    tex = [n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE"]
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    C("atlas texture nearest (Closest) and linked to Base Color",
      len(tex) == 1 and tex[0].interpolation == "Closest" and tex[0].image == img
      and bsdf.inputs["Base Color"].is_linked)
    C("atlas material matte (metallic 0, roughness 0.8 to 0.9)",
      bsdf.inputs["Metallic"].default_value == 0.0 and 0.8 <= bsdf.inputs["Roughness"].default_value <= 0.9,
      round(bsdf.inputs["Roughness"].default_value, 3))
    n = a["sizePx"]
    px = np.array(img.pixels[:], dtype=np.float32).reshape(n, n, 4)
    want = BC.zone_colors(spec)
    bad = []
    for z, (col, row) in zones.cells.items():
        if z not in want:
            continue
        y0 = n - (row + 1) * zones.cell
        cell = px[y0:y0 + zones.cell, col * zones.cell:(col + 1) * zones.cell, :3]
        rgb = np.array(G.hex_rgb(want[z])) / 255.0
        if float(np.abs(cell - rgb).max()) > 0.6 / 255:
            bad.append(z)
    C("atlas cells hold the characters.json zone colours", not bad, bad)
    return zones


def check_shape_keys(C, data, body):
    names = data["expressions"]["names"]
    keys = body.data.shape_keys.key_blocks if body.data.shape_keys else []
    C("body shape keys are Basis + expressions in order", [k.name for k in keys] == ["Basis"] + names,
      [k.name for k in keys])
    if not keys:
        return {}
    gi = body.vertex_groups["head"].index
    head_w = np.zeros(len(body.data.vertices), dtype=np.float32)
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == gi:
                head_w[v.index] = g.weight
    basis = np.zeros(len(body.data.vertices) * 3, dtype=np.float32)
    keys["Basis"].data.foreach_get("co", basis)
    basis = basis.reshape(-1, 3)
    out = {}
    for name in names:
        kb = keys.get(name)
        if kb is None:
            continue
        co = np.zeros(basis.size, dtype=np.float32)
        kb.data.foreach_get("co", co)
        d = np.linalg.norm(co.reshape(-1, 3) - basis, axis=1)
        moved = np.nonzero(d > 1e-6)[0]
        off_face = int((head_w[moved] < 0.999).sum())
        out[name] = {"moved_vertices": int(len(moved)), "max_delta_m": round(float(d.max()), 4),
                     "moved_not_head": off_face}
        C(f"shape key {name}: visible delta (>= {MIN_MORPH_M * 1000:.0f} mm)", d.max() >= MIN_MORPH_M, out[name])
        C(f"shape key {name}: only head-weighted (face) vertices move", len(moved) > 0 and off_face == 0, out[name])
    return out


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
    mats_per_mesh = {o.name: [m.name for m in o.data.materials] for o in meshes}
    C("every mesh uses only kantor_atlas", all(v == [data["atlas"]["material"]] for v in mats_per_mesh.values()),
      mats_per_mesh)
    zones = check_atlas_blend(C, data, spec, rig)
    if zones is None:
        return {}
    uv_off = {}
    for o in meshes:
        pz, off = zones.poly_zones(o.data)
        uv_off[o.name] = round(off, 6)
    C("every UV sits on its cell centre", all(v < 1e-4 for v in uv_off.values()), uv_off)
    # lod1
    lod1 = bpy.data.objects.get("lod1")
    lod_budget = data["budgets"]["npcTrianglesLOD1"]
    if C("lod1 node present", lod1 is not None):
        lod_tris = BC.tri_count_mesh(lod1.data)
        C(f"lod1 triangles <= {lod_budget}", lod_tris <= lod_budget, lod_tris)
        C("lod1 has no shape keys", lod1.data.shape_keys is None)
        C("lod1 parented to rig and hidden in renders", lod1.parent == rig and lod1.hide_render)
        C("rig extras kantor_lod1_tris equals lod1", rig.get("kantor_lod1_tris") == lod_tris,
          [rig.get("kantor_lod1_tris"), lod_tris])
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
    body = bpy.data.objects["body"]
    morph = check_shape_keys(C, data, body)
    # static measures in rest pose
    rig.animation_data.action = None
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    m = measure_static(bpy.data.objects, default_hair, zones)
    H = spec["body"]["heightM"]
    tol = data["budgets"]["heightTolerance"]
    budget = data["budgets"]["playerTrianglesLOD0" if spec["kind"] == "player" else "npcTrianglesLOD0"]
    C("LOD0 triangles within budget", m["tri_visible"] <= budget, {"visible": m["tri_visible"], "budget": budget})
    C("rig extras kantor_lod0_tris equals LOD0", rig.get("kantor_lod0_tris") == m["tri_visible"],
      [rig.get("kantor_lod0_tris"), m["tri_visible"]])
    if var:
        C("all-variant triangles within player budget", m["tri_total"] <= budget, m["tri_total"])
    lod0_objs = [o for o in bpy.data.objects if lod0_visible(o, default_hair)]
    props = [o.name for o in lod0_objs if o.name.startswith("prop_")]
    prims = len(lod0_objs)
    C(f"visible LOD0 primitives = body + hair ({data['budgets']['visiblePrimitivesLOD0']}) + held props",
      prims == data["budgets"]["visiblePrimitivesLOD0"] + len(props), {"primitives": prims, "props": props})
    zone_req = set(data["materialNames"]["required"])
    C("extras zones cover every zone used and every required zone",
      not m["unmapped_zone"] and set(m["zones_used"]) | zone_req <= set(zones.cells),
      {"used": m["zones_used"], "unmapped": m["unmapped_zone"]})
    C("height within tolerance", abs(m["height"] - H) <= tol * H, {"measured": m["height"], "spec": H})
    C("feet on floor", -0.004 <= m["feet_z"] <= 0.004, m["feet_z"])
    C("faces -Y", m["eye_vertices"] > 0 and m["eye_centroid"][1] < m["body_centroid"][1] - 0.08
      and abs(m["eye_centroid"][0]) < 0.02, {"eyes": m["eye_centroid"], "body": m["body_centroid"]})
    # pose checks
    rig.data.pose_position = "POSE"
    sc = bpy.context.scene
    pb = rig.pose.bones
    clip = {}
    ankle_rest = rig.data.bones["foot_L"].head_local.z
    worst_lod = 0.0
    for name, meta in req.items():
        a = acts[name]
        rig.animation_data.action = a
        n = int(a.frame_range[1])
        min_z, floor_touch, lod_min_z = 1e9, 1e9, 1e9
        hips_min = 1e9
        lod_dev = 0.0
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
                if lod1 is not None and f % 6 == 0:
                    lp, _, _ = eval_mesh_world(lod1, dg)
                    full = []
                    for o in lod0_objs:
                        full += eval_mesh_world(o, dg)[0]
                    a0, a1 = bbox(full)
                    b0, b1 = bbox(lp)
                    lod_dev = max(lod_dev, max(abs(u - v) for u, v in zip(list(a0) + list(a1), list(b0) + list(b1))))
                    lod_min_z = min(lod_min_z, b0.z)
            samples.append((f, (rig.matrix_world @ pb["foot_L"].head).copy()))
        info = {"min_z": round(min_z, 4), "lod1_bbox_dev_m": round(lod_dev, 4), "lod1_min_z": round(lod_min_z, 4)}
        worst_lod = max(worst_lod, lod_dev)
        if lod1 is not None:
            C(f"{name}: lod1 deforms with LOD0 (bbox within {LOD_BBOX_TOL * 100:.0f} cm)", lod_dev <= LOD_BBOX_TOL,
              info["lod1_bbox_dev_m"])
        if name in SEATED:
            # pelvis underside relative to the hips joint is fixed by the rig
            pelvis_drop = rig.data.bones["hips"].head_local.z - (spec_hip_bottom(rig))
            info["pelvis_underside_z"] = round(hips_min - pelvis_drop, 4)
            C(f"{name}: pelvis on {data['rig']['seatHeightM']} m seat",
              abs(info["pelvis_underside_z"] - data["rig"]["seatHeightM"]) <= 0.03, info["pelvis_underside_z"])
        else:
            C(f"{name}: no floor penetration (6 mm tolerance)", min_z >= -0.006, round(min_z, 4))
            C(f"{name}: a foot touches the floor", floor_touch <= 0.03, round(floor_touch, 4))
            if lod1 is not None:
                C(f"{name}: lod1 no floor penetration (6 mm tolerance)", lod_min_z >= -0.006, round(lod_min_z, 4))
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
    # a morph on top of a running clip: talk while the talk clip nods the head
    keys = body.data.shape_keys.key_blocks
    rig.animation_data.action = acts["talk"]
    sc.frame_set(9)
    dg = bpy.context.evaluated_depsgraph_get()
    p0, _, _ = eval_mesh_world(body, dg)
    keys["talk"].value = 1.0
    dg = bpy.context.evaluated_depsgraph_get()
    p1, _, _ = eval_mesh_world(body, dg)
    keys["talk"].value = 0.0
    d = np.linalg.norm(np.array(p1) - np.array(p0), axis=1)
    moved = np.nonzero(d > 1e-6)[0]
    gi = body.vertex_groups["head"].index
    head = {v.index for v in body.data.vertices if any(g.group == gi and g.weight >= 0.999 for g in v.groups)}
    C("talk morph combined with talk clip moves only head vertices",
      len(moved) > 0 and d.max() >= MIN_MORPH_M and all(int(i) in head for i in moved),
      {"moved": int(len(moved)), "max_delta_m": round(float(d.max()), 4)})
    rig.animation_data.action = None
    return {"blend": rel(path), "static": m, "clips": clip, "default_hair": default_hair, "morph": morph,
            "lod1_worst_bbox_dev_m": round(worst_lod, 4), "uv_max_offset": max(uv_off.values()),
            "loco": {k: rig[k] for k in rig.keys() if k.startswith("kantor_") and "speed" in k},
            "atlas": rig["kantor_atlas"].to_dict()}


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
    g = G.Glb(path)
    j = g.doc
    C("glb has BIN chunk", len(g.bin) > 0)
    anims = sorted(a["name"] for a in j.get("animations", []))
    C("glb animation names exact", anims == sorted(data["animations"]), anims)
    skins = j.get("skins", [])
    C("glb has a skin", len(skins) >= 1, len(skins))
    nodes = [n.get("name") for n in j["nodes"]]
    joints = sorted(nodes[i] for i in skins[0]["joints"]) if skins else []
    C("glb joints are the shared skeleton", joints == sorted(data["rig"]["bones"]), joints)
    var = data.get("avatarVariants", {}).get(cid)
    hair_expected = sorted("hair_" + h for h in (var["hairStyles"] if var else [spec["hair"]["style"]]))
    default_hair = "hair_" + (var["defaultHair"] if var else spec["hair"]["style"])
    C("glb hair nodes", sorted(n for n in nodes if n and n.startswith("hair_")) == hair_expected, nodes)
    a = data["atlas"]
    mats = [m["name"] for m in j.get("materials", [])]
    C("glb has exactly one material kantor_atlas", mats == [a["material"]], mats)
    mat = j["materials"][0] if mats else {}
    pbr = mat.get("pbrMetallicRoughness", {})
    C("glb material matte (metallic 0, roughness 0.8 to 0.9) with baseColorTexture",
      pbr.get("metallicFactor", 1.0) == 0.0 and 0.8 <= pbr.get("roughnessFactor", 1.0) <= 0.9
      and "baseColorTexture" in pbr, pbr)
    imgs = j.get("images", [])
    C("glb embeds one PNG image", len(imgs) == 1 and imgs[0].get("mimeType") == "image/png", imgs)
    samplers = j.get("samplers", [])
    C("glb sampler is nearest (mag NEAREST, min NEAREST or NEAREST_MIPMAP_NEAREST)",
      len(samplers) == 1 and samplers[0].get("magFilter") == 9728 and samplers[0].get("minFilter") in (9728, 9984),
      samplers)
    meta = (j["scenes"][0].get("extras") or {}).get("kantor_atlas")
    rig_node = next((n for n in j["nodes"] if n.get("name") == "rig"), {})
    rex = rig_node.get("extras", {})
    C("glb scene extras kantor_atlas equals rig extras", meta is not None and meta == rex.get("kantor_atlas"), meta)
    zones_ok = meta is not None and {z: tuple(v) for z, v in meta["zones"].items()} == expected_layout(data) \
        and meta["size"] == a["sizePx"] and meta["cell"] == a["cellPx"]
    C("glb atlas extras = {size, cell, zones: {zone: [col, row]}} per characters.json", zones_ok, meta)
    png = {}
    if imgs and meta:
        w, h, rows = G.decode_png(g.image_bytes(0))
        png = {"width": w, "height": h, "bytes": len(g.image_bytes(0))}
        C(f"glb atlas PNG {a['sizePx']} x {a['sizePx']}", (w, h) == (a["sizePx"], a["sizePx"]), png)
        want = BC.zone_colors(spec)
        bad = []
        for z, (col, row) in meta["zones"].items():
            if z in want:
                cells = {rows[y][x][:3] for y in range(row * meta["cell"], (row + 1) * meta["cell"])
                         for x in range(col * meta["cell"], (col + 1) * meta["cell"])}
                if cells != {G.hex_rgb(want[z])}:
                    bad.append(z)
        C("glb atlas cells (decoded PNG, row 0 at top) hold the zone colours", not bad, bad)
    # meshes, primitives, UV zones
    zone_at = {tuple(v): z for z, v in (meta or {"zones": {}})["zones"].items()}
    by_name = g.nodes_by_name()
    prims = {n: len(g.mesh_primitives(n)) for n, v in by_name.items() if "mesh" in v}
    C("glb one primitive per mesh node", all(v == 1 for v in prims.values()), prims)
    used, uv_bad = set(), []
    eye = []
    for nname in prims:
        for p in g.mesh_primitives(nname):
            if "TEXCOORD_0" not in p["attributes"]:
                uv_bad.append(nname)
                continue
            uv = g.accessor(p["attributes"]["TEXCOORD_0"])
            pos = g.accessor(p["attributes"]["POSITION"]) if nname == "body" else None
            for i, (u, v) in enumerate(uv):
                z = G.atlas_zone_of_uv(u, v, meta["size"], meta["cell"], zone_at) if meta else None
                used.add(z)
                k = meta["size"] / meta["cell"] if meta else 1
                if abs(u * k - int(u * k) - 0.5) > 1e-3 or abs(v * k - int(v * k) - 0.5) > 1e-3:
                    uv_bad.append(nname)
                    break
                if pos is not None and z == "eye_iris":
                    eye.append(pos[i])
    C("glb every UV on a cell centre", not uv_bad, sorted(set(uv_bad)))
    C("glb UV zones are all in the atlas extras", None not in used, sorted(str(z) for z in used))
    C("glb eyes (eye_iris zone) on the +Z (forward) side", eye and min(p[2] for p in eye) > 0.05,
      round(min(p[2] for p in eye), 4) if eye else None)
    lod0_nodes = ["body", default_hair] + sorted(n for n in prims if n.startswith("prop_"))
    vis_prims = sum(prims.get(n, 0) for n in lod0_nodes)
    props = [n for n in lod0_nodes if n.startswith("prop_")]
    C("glb visible LOD0 primitives = body + one hair + held props",
      vis_prims == data["budgets"]["visiblePrimitivesLOD0"] + len(props), {"primitives": vis_prims, "nodes": lod0_nodes})
    lod0_tris = sum(g.node_triangles(n) for n in lod0_nodes if n in prims)
    C("glb extras kantor_lod0_tris equals body + default hair + props", rex.get("kantor_lod0_tris") == lod0_tris,
      [rex.get("kantor_lod0_tris"), lod0_tris])
    # morph targets
    names = data["expressions"]["names"]
    body_node = by_name.get("body", {})
    body_mesh = j["meshes"][body_node["mesh"]] if "mesh" in body_node else {}
    tnames = (body_mesh.get("extras") or {}).get("targetNames")
    C("glb body mesh extras targetNames = expressions", tnames == names, tnames)
    morph = {}
    bp = body_mesh.get("primitives", [{}])[0]
    targets = bp.get("targets", [])
    C("glb body has 5 morph targets", len(targets) == len(names), len(targets))
    if targets:
        joints_of = g.accessor(bp["attributes"]["JOINTS_0"])
        weights_of = g.accessor(bp["attributes"]["WEIGHTS_0"])
        head_j = [nodes[i] for i in skins[0]["joints"]].index("head")

        def head_only(i):
            return sum(w for jj, w in zip(joints_of[i], weights_of[i]) if jj == head_j) >= 0.999
        for name, t in zip(tnames or names, targets):
            d = g.accessor(t["POSITION"])
            idx = [i for i, v in enumerate(d) if any(abs(c) > 1e-7 for c in v)]
            mx = max((sum(c * c for c in d[i]) ** 0.5 for i in idx), default=0.0)
            off = [i for i in idx if not head_only(i)]
            morph[name] = {"moved_vertices": len(idx), "max_delta_m": round(mx, 4), "sparse": "sparse" in
                           j["accessors"][t["POSITION"]], "moved_not_head": len(off)}
            C(f"glb morph {name}: non-zero (>= {MIN_MORPH_M * 1000:.0f} mm) and head-only",
              mx >= MIN_MORPH_M and not off and idx, morph[name])
    for nname in prims:
        if nname != "body":
            m = j["meshes"][by_name[nname]["mesh"]]
            C(f"glb {nname} has no morph targets", not any(p.get("targets") for p in m["primitives"]))
    # lod1
    lod = by_name.get("lod1")
    lod_tris = g.node_triangles("lod1") if lod and "mesh" in lod else None
    if C("glb lod1 node present and skinned", lod is not None and "skin" in lod and "mesh" in lod):
        C(f"glb lod1 triangles <= {data['budgets']['npcTrianglesLOD1']}",
          lod_tris <= data["budgets"]["npcTrianglesLOD1"], lod_tris)
        C("glb extras kantor_lod1_tris equals lod1", rex.get("kantor_lod1_tris") == lod_tris,
          [rex.get("kantor_lod1_tris"), lod_tris])
    C("glb rig extras keep locomotion speeds",
      all(isinstance(rex.get(k), (int, float)) for k in ("kantor_walk_native_speed_mps", "kantor_run_native_speed_mps")),
      {k: rex.get(k) for k in ("kantor_walk_native_speed_mps", "kantor_run_native_speed_mps")})
    durations = {}
    for an in j.get("animations", []):
        tmax = max(j["accessors"][s["input"]]["max"][0] for s in an["samplers"])
        durations[an["name"]] = round(tmax, 4)
        exp = data["animations"][an["name"]]["durationS"]
        C(f"glb clip duration {an['name']}", abs(tmax - exp) < 1.01 / data["rig"]["fps"], round(tmax, 4))
    # round trip through the importer
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    C("reimport: one armature", len(arms) == 1, [o.name for o in arms])
    for ar in arms:
        ar.data.pose_position = "REST"
        if ar.animation_data:
            ar.animation_data.action = None
    bpy.context.view_layer.update()
    rm = None
    if arms and "kantor_atlas" in arms[0]:
        rm = measure_static(bpy.data.objects, default_hair, Zones(arms[0]["kantor_atlas"].to_dict()))
        H = spec["body"]["heightM"]
        tol = data["budgets"]["heightTolerance"]
        C("reimport: height within tolerance", abs(rm["height"] - H) <= tol * H, rm["height"])
        C("reimport: feet on floor", -0.004 <= rm["feet_z"] <= 0.004, rm["feet_z"])
        C("reimport: faces -Y (glTF +Z)", rm["eye_vertices"] > 0 and rm["eye_centroid"][1] < rm["body_centroid"][1] - 0.08,
          rm["eye_centroid"])
    else:
        C("reimport: rig extras carry kantor_atlas", False)
    C("reimport: actions present", len(bpy.data.actions) >= len(data["animations"]), len(bpy.data.actions))
    rbody = next((o for o in bpy.data.objects if o.type == "MESH" and strip_suffix(o.name) == "body"), None)
    rkeys = [k.name for k in rbody.data.shape_keys.key_blocks] if rbody and rbody.data.shape_keys else []
    C("reimport: body shape keys = expressions", rkeys[1:] == names, rkeys)
    rmats = sorted({m.name for o in bpy.data.objects if is_char_mesh(o) for m in o.data.materials if m})
    C("reimport: one material", [strip_suffix(n) for n in rmats] == [a["material"]], rmats)
    C("reimport: lod1 present", any(strip_suffix(o.name) == "lod1" and o.type == "MESH" for o in bpy.data.objects))
    return {"glb": rel(path), "bytes": size, "animations": anims, "durations": durations, "nodes": nodes,
            "materials": mats, "primitives": prims, "visiblePrimitivesLOD0": vis_prims, "lod0Tris": lod0_tris,
            "lod1Tris": lod_tris, "morph": morph, "targetNames": tnames, "atlasPng": png, "sampler": samplers,
            "reimport": {k: rm[k] for k in ("height", "feet_z", "tri_visible", "tri_total", "tri_lod1",
                                             "eye_centroid", "dimensions")} if rm else None}


def check_previews(cid, data, C: Check):
    out = []
    names = [f"{cid.lower()}-sheet.png"]
    if cid == "CH-CEO":
        names += ["ch-ceo-deform.png", "ch-ceo-variants.png", "character-expressions.png", "character-lod.png"]
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
            "dimensionsNote": "[w, d, h] metres, rest pose, visible LOD0 nodes only (default hair)",
            "pivot": "feet center",
            "facing": "-Y Blender / +Z glTF",
            "collider": {"type": "capsule", "radius": 0.25, "height": h},
            "materials": g.get("materials"),
            "atlas": {"material": data["atlas"]["material"], "sizePx": data["atlas"]["sizePx"],
                      "cellPx": data["atlas"]["cellPx"], "zones": (b.get("atlas") or {}).get("zones"),
                      "pngBytes": (g.get("atlasPng") or {}).get("bytes"), "filter": "nearest",
                      "extras": "scene + rig extras kantor_atlas"},
            "primitives": {"lod0Visible": g.get("visiblePrimitivesLOD0"), "perNode": g.get("primitives")},
            "triangles": {"lod0Visible": st.get("tri_visible"), "lod1": st.get("tri_lod1"),
                          "allLod0Nodes": st.get("tri_total"), "perNode": st.get("per_node"),
                          "budget": data["budgets"]["playerTrianglesLOD0" if spec["kind"] == "player"
                                                    else "npcTrianglesLOD0"],
                          "budgetLod1": data["budgets"]["npcTrianglesLOD1"]},
            "lod": {"lod0": {"nodes": ["body", b.get("default_hair")] + sorted(
                        n for n in g.get("nodes", []) if n and n.startswith("prop_")),
                        "triangles": st.get("tri_visible")},
                    "lod1": {"node": "lod1", "triangles": st.get("tri_lod1"),
                             "method": "Blender Decimate (collapse) of body + default hair + held props; no morphs",
                             "worstPoseBboxDeviationM": b.get("lod1_worst_bbox_dev_m")}},
            "expressions": {"node": "body", "names": g.get("targetNames"),
                            "format": "glTF morph targets (sparse), mesh extras targetNames",
                            "measured": g.get("morph")},
            "animations": g.get("animations"),
            "animationDurationsS": g.get("durations"),
            "locomotion": b.get("loco"),
            "nodes": {
                "hair": sorted(n for n in g.get("nodes", []) if n and n.startswith("hair_")),
                "defaultHair": b.get("default_hair"),
                "props": sorted(n for n in g.get("nodes", []) if n and n.startswith("prop_")),
                "lod1": "lod1",
            },
            "glbBytes": g.get("bytes"),
            "status": "generated+validated" if r["ok"] else "generated+validation-failed",
            "validatedBy": "blender/validate_assets.py",
            "evidence": rel(REPORT),
        }
        if cid in data.get("avatarVariants", {}):
            v = data["avatarVariants"][cid]
            entry["avatarVariants"] = {
                "approach": "single GLB; show exactly one hair_<style> node; recolour by repainting the "
                            "outfit_* cells of a cloned kantor_atlas texture",
                "hairNodes": ["hair_" + h for h in v["hairStyles"]],
                "palettes": sorted(v["palettes"]),
                "paletteZones": ["outfit_main", "outfit_inner", "outfit_bottom", "outfit_accent"],
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
    lines = []
    for cid in ids:
        spec = data["characters"][cid]
        C = Check()
        try:
            br = check_blend(cid, spec, data, C)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            C("blend checks ran", False, repr(exc))
            br = {}
        try:
            gr = check_glb(cid, spec, data, C)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            C("glb checks ran", False, repr(exc))
            gr = {}
        prev = check_previews(cid, data, C)
        results[cid] = {"ok": C.ok, "checks": C.items, "blend_report": br, "glb_report": gr, "previews": prev}
        st = br.get("static", {})
        line = (f"VALIDATE {cid}: {'PASS' if C.ok else 'FAIL'} checks={len(C.items)} failed={len(C.failures())} "
                f"materials={len(gr.get('materials') or [])} primitives_lod0={gr.get('visiblePrimitivesLOD0')} "
                f"tris_lod0={st.get('tri_visible')} tris_lod1={st.get('tri_lod1')} tris_all_lod0_nodes={st.get('tri_total')} "
                f"height={st.get('height')} morphs={gr.get('targetNames')} glb_bytes={gr.get('bytes')}")
        print(line)
        lines.append(line)
        for f in C.failures():
            print(f"  FAIL {f['check']}: {f['detail']}")
            lines.append(f"  FAIL {f['check']}: {f['detail']}")
    ok = all(r["ok"] for r in results.values())
    report = {
        "tool": "blender/validate_assets.py",
        "blender": bpy.app.version_string,
        "gitHead": git_head(),
        "worktreeNote": "gitHead is the commit the files were validated on top of; generated files may be uncommitted",
        "seconds": round(time.time() - t0, 1),
        "passed": ok,
        "checks": sum(len(r["checks"]) for r in results.values()),
        "failed": sum(1 for r in results.values() for c in r["checks"] if not c["ok"]),
        "characters": {cid: {k: v for k, v in r.items()} for cid, r in results.items()},
    }
    done = (f"VALIDATE_DONE passed={ok} characters={len(results)} checks={report['checks']} "
            f"failed={report['failed']} seconds={report['seconds']}")
    if "--only" not in argv:
        EVID.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        head = [f"# blender/validate_assets.py, Blender {bpy.app.version_string}, git_head={report['gitHead']} "
                "(generated files uncommitted on top of HEAD)"]
        REPORT_TXT.write_text("\n".join(head + lines + [done]) + "\n", encoding="utf-8")
        if "--no-registry" not in argv:
            update_registry(results, data)
    print(done)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
