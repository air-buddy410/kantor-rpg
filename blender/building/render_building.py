"""Concept renders of the building (Cycles CPU, low samples).

Run after build_building.py (and build_furniture.py if furnished interiors are wanted):
  blender -b --factory-startup -noaudio --python blender/building/render_building.py

Writes assets/previews/building-exterior.png, building-L1-interior.png and
building-L2-interior.png, each labelled "konsep". When blender/out/furniture.blend
exists, every world.json fixture except stair/lift is placed as a linked copy
of its furniture mesh so the interiors read as furnished rooms.
"""
from __future__ import annotations

import json
import math
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Matrix

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "lib"))
import building_spec as S  # noqa: E402
import kantor_blender as K  # noqa: E402

ROOT = S.ROOT
BLEND = ROOT / "blender" / "out" / "building.blend"
FURN = ROOT / "blender" / "out" / "furniture.blend"
PREV = ROOT / "assets" / "previews"
MAX_BYTES = 400_000


def furnish(world):
    if not FURN.exists():
        print("RENDER note: furniture.blend missing, interiors render without furniture")
        return {f["id"]: 0 for f in world["floors"]}
    with bpy.data.libraries.load(str(FURN), link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith("FURN-")]
    protos = {o.name[5:]: o for o in dst.objects if o is not None}
    col = bpy.data.collections.new("furniture")
    bpy.context.scene.collection.children.link(col)
    elev = {f["id"]: f["elevation"] for f in world["floors"]}
    n = {f["id"]: 0 for f in world["floors"]}
    for fx in world["fixtures"]:
        if fx["type"] in ("stair_u", "lift") or fx["type"] not in protos:
            continue
        p = protos[fx["type"]]
        ob = bpy.data.objects.new(f"{fx['id']}", p.data)
        z = elev[fx["floor"]] + float(p.get("kantor_mount_height_m", 0.0))
        ob.matrix_world = Matrix.Translation((fx["pos"][0], fx["pos"][1], z)) @ Matrix.Rotation(
            math.radians(fx["rot"]), 4, "Z")
        ob["kantor_floor"] = fx["floor"]
        col.objects.link(ob)
        n[fx["floor"]] = n.get(fx["floor"], 0) + 1
    return n


def ground(env):
    m = K.Materials().get("ground_render", env["ground"])
    B = K.Builder("GROUND_RENDER_ONLY")
    B.add(K.box(-60, -60, -0.32, 92, 84, -0.31), "g", smooth=False)
    ob = K.make_object(B, {"g": m}, clean=False)
    return ob


def shot(name, cam_loc, target, lens, label, hide, w=1200, h=760, samples=32):
    for o in bpy.data.objects:
        if o.type in ("MESH", "FONT"):
            o.hide_render = hide(o)
    cam = K.look_at_camera(cam_loc, target, lens=lens, name="cam_" + name)
    lab = K.camera_label(cam, label, size=0.028, offset=(0.0, -0.31))
    K.setup_cycles(w, h, samples)
    tmp = Path(tempfile.mkdtemp(prefix="kantor-bld-")) / f"{name}.png"
    arr = K.median3(K.render_pixels(tmp))
    out = PREV / f"{name}.png"
    K.save_png(arr, out, quant=5)
    size = out.stat().st_size
    bpy.data.objects.remove(lab, do_unlink=True)
    print(f"RENDER {name} -> {out.relative_to(ROOT)} bytes={size} {'OK' if size <= MAX_BYTES else 'OVER_BUDGET'}")
    return size


def main():
    world = S.load_world()
    env, _, _ = K.parse_palette()
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    n = furnish(world)
    ground(env)
    K.world_bg("#F3EAD7", "#F4ECDF", 0.75)
    K.sun("key", (48, 0, -35), 3.2, "#FFF1DE", 6)
    K.sun("fill", (70, 0, 140), 0.5, "#EEF0F2", 20)

    def floor_of(o):
        if "kantor_floor" in o:
            return o["kantor_floor"]
        return None
    sizes = {}
    sizes["building-exterior"] = shot(
        "building-exterior", (-17.0, -24.0, 22.0), (16.0, 11.0, 2.5), 30,
        "kantor-rpg  |  eksterior konsep  |  bukan gambar konstruksi", lambda o: False)
    for f in world["floors"]:
        fid = f["id"]

        def hide(o, fid=fid):
            if o.name == "GROUND_RENDER_ONLY":
                return False
            fl = floor_of(o)
            if fl is None:
                return True
            if fl != fid:
                return True
            return o.name.startswith(("ROOF", "FASCIA"))
        e = f["elevation"]
        sizes[f"building-{fid}-interior"] = shot(
            f"building-{fid}-interior", (16.0, -13.5, e + 27.0), (16.0, 10.5, e), 32,
            f"kantor-rpg  |  {f['name']}  |  interior konsep, {n[fid]} fixture", hide)
    ok = all(v <= MAX_BYTES for v in sizes.values())
    print(f"RENDER_DONE ok={ok}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
