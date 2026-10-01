"""Build the two-floor concept building from design/world.json + design/derived/walls.json.

Run (repo root):
  python3 tools/export_runtime.py          # only if design/derived/walls.json is missing or stale
  blender -b --factory-startup -noaudio --python blender/building/build_building.py

Writes blender/out/building.blend, app/public/assets/building/building-L1.glb and
building-L2.glb. Object names are stable IDs: SLAB-<floor>, ROOM-<roomId>,
WALL-<floor>-<index> (index into walls.json floors.<floor>.walls), OPEN-<doorId>
(threshold), LINTEL-<doorId>, STAIR-<fixtureId>, STAIRWELL-<fixtureId>,
LIFT-<fixtureId>, FASCIA-<floor>, ROOF. Mesh vertices are stored in world
coordinates with identity object transforms, so glTF positions are exactly
world (x, y, z) -> glTF (x, z, -y). Status: concept geometry, not a construction model.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "lib"))
import building_spec as S  # noqa: E402
import kantor_blender as K  # noqa: E402

ROOT = S.ROOT
OUT_BLEND = ROOT / "blender" / "out" / "building.blend"
OUT_GLB = ROOT / "app" / "public" / "assets" / "building"


def wall_faces_materials(wb, fi):
    """Exterior walls: outward face gets the exterior colour, the rest interior."""
    mats = ["wall_interior"] * 6
    if not wb["exterior"]:
        return mats
    cx, cy = (fi["x0"] + fi["x1"]) / 2, (fi["y0"] + fi["y1"]) / 2
    if wb["axis"] == "x":
        outward = 2 if (wb["y0"] + wb["y1"]) / 2 < cy else 4  # -Y face or +Y face
        # x-walls own the building corners: their corner end faces are facade too,
        # so they share the facade colour with the coplanar y-wall face behind them
        if wb["x0"] < fi["x0"] - 1e-6:
            mats[5] = "wall_exterior"
        if wb["x1"] > fi["x1"] + 1e-6:
            mats[3] = "wall_exterior"
    else:
        outward = 5 if (wb["x0"] + wb["x1"]) / 2 < cx else 3  # -X face or +X face
    mats[outward] = "wall_exterior"
    mats[1] = "wall_top"
    return mats


def add_box_multi(B, bx, mats):
    v, f = K.box(bx["x0"], bx["y0"], bx["z0"], bx["x1"], bx["y1"], bx["z1"])
    base = len(B.verts)
    for p in v:
        B.verts.append(Vector(p))
    for face, m in zip(f, mats):
        B.faces.append(tuple(base + i for i in face))
        B.mats.append(m)
        B.smooth.append(False)


def stair_mesh(B, size, rise_total=4.0, xf=None, rail_cap=None):
    """Concept U stair in the fixture frame (also used by the furniture kit)."""
    parts, meta = S.stair_parts(size, rise_total=rise_total)
    w, d, _ = size
    rail_cap = rise_total if rail_cap is None else rail_cap
    for name, (cx, cy, z0), (sx, sy, sz) in parts:
        mat = "stair_tread" if name.startswith(("tread", "landing")) else "stair_core"
        B.add(K.box(cx - sx / 2, cy - sy / 2, z0, cx + sx / 2, cy + sy / 2, z0 + sz), mat, xf, smooth=False)
        if name.startswith("tread"):
            # contrasting nosing strip so each step reads from the 3/4 camera
            ny = cy - sy / 2 if name.startswith("tread1") else cy + sy / 2 - 0.04
            B.add(K.box(cx - sx / 2, ny, z0 + sz - 0.012, cx + sx / 2, ny + 0.04, z0 + sz + 0.004),
                  "stair_nosing", xf, smooth=False)
    # top arrival nosing at full height on the flight 2 side
    fw, gap = meta["flight_width_m"], 0.10
    B.add(K.box(gap / 2, -d / 2, rise_total - 0.03, w / 2, -d / 2 + 0.05, rise_total), "stair_nosing", xf, smooth=False)
    # sloped cheek parapets on the outer edges, capped so the bbox stays within rise_total
    landing = meta["landing_m"]
    for side, z_a, z_b in ((-1, 0.0, rise_total / 2), (1, rise_total, rise_total / 2)):
        x0, x1 = (-w / 2, -w / 2 + 0.06) if side < 0 else (w / 2 - 0.06, w / 2)
        ya, yb = -d / 2, d / 2 - landing
        ta, tb = min(z_a + 0.9, rail_cap), min(z_b + 0.9, rail_cap)
        verts = [(x0, ya, 0), (x1, ya, 0), (x1, yb, 0), (x0, yb, 0), (x0, ya, ta), (x1, ya, ta), (x1, yb, tb), (x0, yb, tb)]
        B.add((verts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]),
              "stair_core", xf, smooth=False)
    # landing back parapet
    B.add(K.box(-w / 2, d / 2 - 0.06, rise_total / 2, w / 2, d / 2, min(rise_total / 2 + 0.9, rail_cap)),
          "stair_core", xf, smooth=False)
    return meta


def lift_mesh(B, size, height=3.0, xf=None):
    """Concept lift shaft: 0.15 m walls, front door 1.0 x 2.1 m, closed door leaves."""
    w, d = size[0], size[1]
    t = 0.15
    door = 1.0
    f0 = -d / 2 + 0.02  # front wall face; frame and call button sit flush in front of it
    walls = [(-w / 2, d / 2 - t, w / 2, d / 2), (-w / 2, f0, -w / 2 + t, d / 2), (w / 2 - t, f0, w / 2, d / 2),
             (-w / 2, f0, -door / 2, f0 + t), (door / 2, f0, w / 2, f0 + t)]
    for x0, y0, x1, y1 in walls:
        B.add(K.box(x0, y0, 0, x1, y1, height), "lift_shaft", xf, smooth=False)
    B.add(K.box(-door / 2, f0, 2.1, door / 2, f0 + t, height), "lift_shaft", xf, smooth=False)
    for sx in (-1, 1):
        B.add(K.box(min(0, sx * door / 2), f0 + 0.05, 0.0, max(0, sx * door / 2), f0 + 0.09, 2.1),
              "lift_door", xf, smooth=False)
    B.add(K.box(-door / 2 - 0.08, -d / 2, 0.0, -door / 2 - 0.02, f0, 2.16), "lift_frame", xf, smooth=False)
    B.add(K.box(door / 2 + 0.02, -d / 2, 0.0, door / 2 + 0.08, f0, 2.16), "lift_frame", xf, smooth=False)
    B.add(K.box(-door / 2 - 0.08, -d / 2, 2.1, door / 2 + 0.08, f0, 2.16), "lift_frame", xf, smooth=False)
    B.add(K.box(door / 2 + 0.14, -d / 2, 1.0, door / 2 + 0.24, f0, 1.2), "accent", xf, smooth=False)
    B.add(K.box(-w / 2 + t, -d / 2 + t, 0.0, w / 2 - t, d / 2 - t, 0.03), "lift_door", xf, smooth=False)


def fixture_xf(fx, z):
    from mathutils import Matrix
    return Matrix.Translation((fx["pos"][0], fx["pos"][1], z)) @ Matrix.Rotation(math.radians(fx["rot"]), 4, "Z")


def materials(env, fin):
    M = K.Materials()
    mats = {
        "wall_interior": M.get("wall_interior", env["wallInterior"]),
        "wall_exterior": M.get("wall_exterior", env["wallExterior"]),
        "wall_top": M.get("wall_top", env["wallCap"]),
        "lintel": M.get("lintel", env["wallInterior"]),
        "threshold": M.get("threshold", env["woodDark"]),
        "slab": M.get("slab", env["slab"]),
        "fascia": M.get("fascia", env["wallCap"]),
        "roof": M.get("roof", env["metalLight"]),
        "stair_tread": M.get("stair_tread", env["wood"]),
        "stair_nosing": M.get("stair_nosing", env["woodDark"]),
        "stair_core": M.get("stair_core", env["wallInterior"]),
        "lift_shaft": M.get("lift_shaft", env["wallExterior"]),
        "lift_door": M.get("lift_door", env["metalLight"], rough=0.6),
        "lift_frame": M.get("lift_frame", env["metal"], rough=0.6),
        "accent": M.get("accent", env["accent"]),
        "guard": M.get("guard", env["woodLight"]),
    }
    for name, hexc in fin.items():
        key = "floor_" + K.slug(name)
        mats[key] = M.get(key, hexc)
    return mats


def build():
    world = S.load_world()
    walls = S.load_walls(world)
    env, fin, _ = K.parse_palette()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    mats = materials(env, fin)
    exp = S.building_expectations(world, walls)
    report = {}
    cols = {}
    for f in world["floors"]:
        fid = f["id"]
        col = bpy.data.collections.new(fid)
        sc.collection.children.link(col)
        cols[fid] = col
        fi = S.floor_info(world, fid)
        e = fi["elevation"]
        objs = []

        def emit(B, kind, extra=None):
            ob = K.make_object(B, mats, col, clean=False)
            ob["kantor_id"] = B.name
            ob["kantor_kind"] = kind
            ob["kantor_floor"] = fid
            for k, v in (extra or {}).items():
                ob[k] = v
            objs.append(ob)
            return ob

        # slab, with voids over vertical circulation on upper floors
        sl = exp[fid]["slab"]
        xs = sorted({sl["x0"], sl["x1"], *[h[0] for h in sl["holes"]], *[h[2] for h in sl["holes"]]})
        ys = sorted({sl["y0"], sl["y1"], *[h[1] for h in sl["holes"]], *[h[3] for h in sl["holes"]]})
        B = K.Builder(sl["id"])
        for xa, xb in zip(xs, xs[1:]):
            for ya, yb in zip(ys, ys[1:]):
                cx, cy = (xa + xb) / 2, (ya + yb) / 2
                if any(h[0] < cx < h[2] and h[1] < cy < h[3] for h in sl["holes"]):
                    continue
                B.add(K.box(xa, ya, sl["z0"], xb, yb, sl["z1"]), "slab", smooth=False)
        emit(B, "slab", {"kantor_holes": len(sl["holes"])})
        # room finish plates (flat polygon 6 mm above the slab, like the runtime)
        for r in world["rooms"]:
            if r["floor"] != fid:
                continue
            B = K.Builder(f"ROOM-{r['id']}")
            poly = r["polygon"]
            area2 = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))
            if area2 < 0:
                poly = poly[::-1]  # CCW so the plate normal points up
            B.add(([(x, y, e + 0.006) for x, y in poly], [tuple(range(len(poly)))]),
                  "floor_" + K.slug(r["finish"]["floor"]), smooth=False)
            emit(B, "room", {"kantor_finish": r["finish"]["floor"]})
        # walls
        for wb in exp[fid]["walls"]:
            B = K.Builder(wb["id"])
            add_box_multi(B, wb, wall_faces_materials(wb, fi))
            emit(B, "wall", {"kantor_exterior": wb["exterior"], "kantor_thickness": wb["thickness"]})
        # door thresholds and lintels
        for ob_spec in exp[fid]["openings"]:
            B = K.Builder(ob_spec["id"])
            mat = "threshold" if ob_spec["part"] == "threshold" else "lintel"
            if ob_spec["part"] == "lintel":
                add_box_multi(B, ob_spec, wall_faces_materials(dict(ob_spec, exterior=ob_spec["exterior"]), fi))
            else:
                B.add(K.box(ob_spec["x0"], ob_spec["y0"], ob_spec["z0"], ob_spec["x1"], ob_spec["y1"], ob_spec["z1"]),
                      mat, smooth=False)
            emit(B, "opening" if ob_spec["part"] == "threshold" else "lintel",
                 {"kantor_door": ob_spec["door"], "kantor_width": round(ob_spec["width"], 4)})
        # vertical circulation
        for fx in S.vertical_fixtures(world, fid):
            if fx["type"] == "stair_u":
                if e == 0:
                    B = K.Builder(f"STAIR-{fx['id']}")
                    meta = stair_mesh(B, fx["size"], world["building"]["floorToFloor"], fixture_xf(fx, e))
                    emit(B, "stair", {"kantor_fixture": fx["id"], **{f"kantor_{k}": v for k, v in meta.items()}})
                else:
                    # guard around the stair void, open where flight 2 arrives (front, +X half)
                    w, d = fx["size"][0], fx["size"][1]
                    B = K.Builder(f"STAIRWELL-{fx['id']}")
                    xf = fixture_xf(fx, e)
                    for x0, y0, x1, y1 in ((-w / 2, d / 2 - 0.06, w / 2, d / 2), (-w / 2, -d / 2, -w / 2 + 0.06, d / 2),
                                           (w / 2 - 0.06, -d / 2 + 0.9, w / 2, d / 2), (-w / 2, -d / 2, -0.05, -d / 2 + 0.06),
                                           (-0.05, -d / 2, 0.05, d / 2 - 1.2)):
                        B.add(K.box(x0, y0, 0.0, x1, y1, 0.95), "guard", xf, smooth=False)
                    emit(B, "stairwell", {"kantor_fixture": fx["id"]})
            else:
                B = K.Builder(f"LIFT-{fx['id']}")
                lift_mesh(B, fx["size"], world["building"]["ceilingHeight"], fixture_xf(fx, e))
                emit(B, "lift", {"kantor_fixture": fx["id"]})
        # exterior fascia band between the ceiling line and the next slab
        h = world["building"]["ceilingHeight"]
        t = world["building"]["wall"]["exterior"]
        top = e + world["building"]["floorToFloor"] - world["building"]["slab"]
        B = K.Builder(f"FASCIA-{fid}")
        for x0, y0, x1, y1 in ((fi["x0"] - t / 2, fi["y0"] - t / 2, fi["x1"] + t / 2, fi["y0"] + t / 2),
                               (fi["x0"] - t / 2, fi["y1"] - t / 2, fi["x1"] + t / 2, fi["y1"] + t / 2),
                               (fi["x0"] - t / 2, fi["y0"] + t / 2, fi["x0"] + t / 2, fi["y1"] - t / 2),
                               (fi["x1"] - t / 2, fi["y0"] + t / 2, fi["x1"] + t / 2, fi["y1"] - t / 2)):
            B.add(K.box(x0, y0, e + h, x1, y1, top), "fascia", smooth=False)
        emit(B, "fascia")
        if f is world["floors"][-1]:
            rs = S.roof_spec(world)
            B = K.Builder("ROOF")
            B.add(K.box(rs["x0"], rs["y0"], rs["z0"], rs["x1"], rs["y1"], rs["z1"]), "roof", smooth=False)
            p = 0.2
            for x0, y0, x1, y1 in ((rs["x0"], rs["y0"], rs["x1"], rs["y0"] + p), (rs["x0"], rs["y1"] - p, rs["x1"], rs["y1"]),
                                   (rs["x0"], rs["y0"] + p, rs["x0"] + p, rs["y1"] - p),
                                   (rs["x1"] - p, rs["y0"] + p, rs["x1"], rs["y1"] - p)):
                B.add(K.box(x0, y0, rs["z1"], x1, y1, rs["z1"] + 0.4), "fascia", smooth=False)
            emit(B, "roof", {"kantor_note": "concept roof; hide for cutaway"})
        report[fid] = {"objects": len(objs), "triangles": sum(K.tri_count(o) for o in objs)}
    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    sc["kantor_world_revision"] = world["revision"]["id"]
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND), compress=True)
    for fid, col in cols.items():
        path = OUT_GLB / f"building-{fid}.glb"
        K.export_glb(path, list(col.objects))
        report[fid]["glb_bytes"] = path.stat().st_size
        print(f"BUILDING {fid}: objects={report[fid]['objects']} triangles={report[fid]['triangles']} "
              f"glb={path.relative_to(ROOT)} bytes={report[fid]['glb_bytes']}")
    print(f"BUILDING_DONE blend={OUT_BLEND.relative_to(ROOT)} world_revision={world['revision']['id']}")


if __name__ == "__main__":
    try:
        build()
    except Exception:
        import traceback
        traceback.print_exc()
        print("BUILDING_FAILED")
        sys.exit(1)
