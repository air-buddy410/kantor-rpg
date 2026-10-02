"""Render character sheets and deform tests from the saved .blend sources.

Run:
  blender -b --factory-startup -noaudio --python blender/characters/render_sheet.py -- [--only CH-CEO] [--no-extras]

Outputs (repo-relative):
  assets/previews/<id>-sheet.png      front / side / back, orthographic
  assets/previews/ch-ceo-deform.png   walk, run, sit and type poses on blockout furniture
  assets/previews/ch-ceo-variants.png 3 hair styles x 3 palettes offered by Avatar Studio
                                      (palettes applied by repainting atlas cells, as the runtime does)
  assets/previews/character-expressions.png  7 characters x neutral + 5 shape keys
  assets/previews/character-lod.png   LOD0 vs LOD1 per character plus its palette atlas

Flags: --only ID, --no-extras (sheets only), --extras-only (skip sheets),
--sheets-only-new (only the expression and LOD sheets).

Cycles CPU is used because EEVEE and Workbench need an EGL/OpenGL context that
this headless machine does not have. Denoising is off (this Blender build has no
OpenImageDenoise), so sample counts are moderate and lighting is kept soft.
"""
from __future__ import annotations

import json
import math
import shutil
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "blender" / "lib"))
import kantor_blender as K  # noqa: E402
DATA = ROOT / "design" / "characters.json"
BLEND_DIR = ROOT / "blender" / "out"
PREVIEW_DIR = ROOT / "assets" / "previews"
CREAM = "#F3EAD7"
INK = "#3A2A22"
GREEN = "#2F5D50"


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h, a=1.0):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (a,)


def setup_render(w, h, samples=40):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.max_bounces = 4
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.compression = 90
    # default 8-bit dither adds per-pixel noise that bloats PNGs past the budget
    sc.render.dither_intensity = 0.0
    # outlines give the matte shapes an illustrated, readable edge
    sc.render.use_freestyle = True
    sc.render.line_thickness_mode = "ABSOLUTE"
    sc.render.line_thickness = 1.3
    vl = sc.view_layers[0]
    vl.use_freestyle = True
    fs = vl.freestyle_settings
    fs.crease_angle = math.radians(120)
    ls = fs.linesets[0] if fs.linesets else fs.linesets.new("outline")
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = False
    ls.select_contour = True
    # one atlas material means no material boundaries any more; zone borders
    # are Freestyle edge marks instead (mark_zone_edges)
    ls.select_material_boundary = False
    ls.select_edge_mark = True
    if ls.linestyle is None:
        ls.linestyle = bpy.data.linestyles.new("ink")
    ls.linestyle.color = hex_lin(INK)[:3]
    ls.linestyle.thickness = 1.3
    # world: the camera sees flat cream, lighting gets a softer neutral fill
    world = bpy.data.worlds.new("sheet") if not sc.world else sc.world
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    bg_cam = nt.nodes.new("ShaderNodeBackground")
    bg_cam.inputs["Color"].default_value = hex_lin(CREAM)
    bg_cam.inputs["Strength"].default_value = 1.0
    bg_light = nt.nodes.new("ShaderNodeBackground")
    bg_light.inputs["Color"].default_value = hex_lin("#F6EEE2")
    bg_light.inputs["Strength"].default_value = 0.55
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(bg_light.outputs["Background"], mix.inputs[1])
    nt.links.new(bg_cam.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])


def add_lights():
    def sun(name, rot, strength, color, angle):
        d = bpy.data.lights.new(name, "SUN")
        d.energy = strength
        d.color = hex_lin(color)[:3]
        d.angle = math.radians(angle)
        o = bpy.data.objects.new(name, d)
        o.rotation_euler = [math.radians(a) for a in rot]
        bpy.context.scene.collection.objects.link(o)
        return o
    # key from front-left above, warm; cool-ish rim from behind
    sun("key", (52, 0, -28), 2.6, "#FFF1DE", 18)
    sun("fill", (70, 0, 55), 0.6, "#F2EEE8", 30)
    sun("rim", (60, 0, 165), 1.4, "#FFF6EA", 10)


def add_camera(center_z, ortho, x=0.0):
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = ortho
    cd.sensor_fit = "AUTO"
    cam = bpy.data.objects.new("cam", cd)
    cam.location = (x, -12.0, center_z)
    cam.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def emission_mat(name, hexc):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = hex_lin(hexc)
    e.inputs["Strength"].default_value = 1.0
    nt.links.new(e.outputs["Emission"], o.inputs["Surface"])
    return m


def add_text(body, size, loc, hexc=GREEN):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = body
    cu.size = size
    cu.align_x = "CENTER"
    ob = bpy.data.objects.new("txt", cu)
    ob.location = loc
    ob.rotation_euler = (math.radians(90), 0, 0)
    ob.data.materials.append(emission_mat("txt_" + hexc, hexc))
    bpy.context.scene.collection.objects.link(ob)
    # no outline on labels
    ob.visible_shadow = False
    return ob


def block(name, size, loc, hexc="#C9B48F"):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = hex_lin(hexc)
    bs.inputs["Roughness"].default_value = 0.9
    ob.data.materials.append(m)
    bev = ob.modifiers.new("bevel", "BEVEL")
    bev.width = 0.03
    bev.segments = 3
    return ob


def render_to_array(path):
    sc = bpy.context.scene
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(path))
    w, h = img.size
    arr = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return arr


def _filter_rows(px):
    """PNG filter selection per row (minimum sum of absolute differences)."""
    x = px.astype(np.int16)
    h, wb = x.shape
    left = np.zeros_like(x)
    left[:, 3:] = x[:, :-3]
    up = np.zeros_like(x)
    up[1:] = x[:-1]
    ul = np.zeros_like(x)
    ul[1:, 3:] = x[:-1, :-3]
    p = left + up - ul
    pa, pb, pc = np.abs(p - left), np.abs(p - up), np.abs(p - ul)
    paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, up, ul))
    cands = [x, x - left, x - up, x - (left + up) // 2, x - paeth]
    cands = [(c % 256).astype(np.uint8) for c in cands]
    scores = np.stack([np.minimum(c, 256 - c.astype(np.int16)).sum(axis=1) for c in cands])
    best = scores.argmin(axis=0)
    out = bytearray()
    for r in range(h):
        out.append(int(best[r]))
        out += cands[best[r]][r].tobytes()
    return bytes(out)


def save_array(arr, path):
    """Write an 8-bit RGB PNG with zlib level 9; deterministic for equal pixels."""
    h, w, _ = arr.shape
    rgb = np.clip(np.round(arr[::-1, :, :3] * 255.0), 0, 255).astype(np.uint8)
    raw = _filter_rows(rgb.reshape(h, w * 3))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    Path(path).write_bytes(png)


def mark_zone_edges(ob):
    """Freestyle edge mark on every edge between faces of different atlas zones."""
    me = ob.data
    if "kantor_zone" not in me.attributes:
        return 0
    zones = np.zeros(len(me.polygons), dtype=np.int32)
    me.attributes["kantor_zone"].data.foreach_get("value", zones)
    totals = np.zeros(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_total", totals)
    edge_of_loop = np.zeros(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("edge_index", edge_of_loop)
    zl = np.repeat(zones, totals)
    lo = np.full(len(me.edges), 1 << 20, dtype=np.int32)
    hi = np.full(len(me.edges), -1, dtype=np.int32)
    np.minimum.at(lo, edge_of_loop, zl)
    np.maximum.at(hi, edge_of_loop, zl)
    marks = (hi >= 0) & (lo != hi)
    me.edges.foreach_set("use_freestyle_mark", marks.tolist())
    return int(marks.sum())


def open_char(cid):
    bpy.ops.wm.open_mainfile(filepath=str(BLEND_DIR / f"{cid.lower()}.blend"))
    rig = bpy.data.objects["rig"]
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            mark_zone_edges(ob)
    return rig


def paint_cells(rig, colors):
    """Repaint atlas cells {zone: '#hex'} in place (what the runtime does on a cloned texture)."""
    img = bpy.data.images["kantor_atlas"]
    meta = rig["kantor_atlas"]
    n, cell = int(meta["size"]), int(meta["cell"])
    px = np.array(img.pixels[:], dtype=np.float32).reshape(n, n, 4)
    for zone, hexc in colors.items():
        col, row = list(meta["zones"][zone])
        h = hexc.lstrip("#")
        rgb = [int(h[k:k + 2], 16) / 255.0 for k in (0, 2, 4)]
        y0 = n - (row + 1) * cell  # pixel rows start at the bottom
        px[y0:y0 + cell, col * cell:(col + 1) * cell, :3] = rgb
    img.pixels = px.ravel().tolist()
    img.update()


_TMP = None


def tmp_path(name):
    """Per-panel renders go to a temp dir outside the repo; only composites are kept."""
    global _TMP
    if _TMP is None:
        _TMP = Path(tempfile.mkdtemp(prefix="kantor-render-"))
    return _TMP / name


def sheet(cid, spec):
    rig = open_char(cid)
    H = spec["body"]["heightM"]
    pw, ph = 400, 500
    setup_render(pw, ph, 64)
    add_lights()
    ortho = 2.0
    floor_frac = 0.13
    cz = -floor_frac * ortho + ortho / 2
    add_camera(cz, ortho)
    panels = []
    labels = [("front", 0, f"{spec['displayName']}, {spec['role']}"), ("side", 90, f"{cid}  {H:.2f} m"),
              ("back", 180, "kantor-rpg original")]
    for i, (lab, rot, cap) in enumerate(labels):
        rig.rotation_euler = (0, 0, math.radians(rot))
        txt = [add_text(lab, 0.06, (0, -1.0, -0.11)), add_text(cap, 0.05, (0, -1.0, -0.19), INK)]
        panels.append(render_to_array(tmp_path(f"{cid}_{lab}.png")))
        for t in txt:
            bpy.data.objects.remove(t, do_unlink=True)
    # rows are bottom-up in Blender pixel buffers; horizontal concat is unaffected
    out = np.concatenate(panels, axis=1)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    path = PREVIEW_DIR / f"{cid.lower()}-sheet.png"
    save_array(out, path)
    print(f"SHEET {cid} -> {path.relative_to(ROOT)} bytes={path.stat().st_size}")


def deform(cid, spec, seat_h):
    rig = open_char(cid)
    pw, ph = 300, 500
    setup_render(pw, ph, 40)
    add_lights()
    ortho = 2.0
    cz = -0.12 * ortho + ortho / 2
    add_camera(cz, ortho)
    acts = bpy.data.actions
    shots = [
        ("walk", 0, 90, "walk: heel strike"),
        ("walk", 7, 35, "walk: passing"),
        ("sit", 0, 90, f"sit: seat {seat_h:.2f} m"),
        ("type", 6, 35, "type: desk 0.75 m"),
    ]
    panels = []
    for act, frame, rot, label in shots:
        objs = []
        rig.rotation_euler = (0, 0, math.radians(rot))
        rig.animation_data.action = acts[act]
        bpy.context.scene.frame_set(frame)
        if act in ("sit", "type"):
            # blockout seat whose top is at seat height, rotated with the character
            seat = block("seat", (0.46, 0.44, seat_h), (0, 0.02, seat_h / 2))
            back = block("back", (0.46, 0.06, 0.42), (0, 0.25, seat_h + 0.21))
            objs += [seat, back]
            if act == "type":
                desk = block("desk", (0.9, 0.55, 0.04), (0, -0.62, 0.73), "#A57C55")
                objs.append(desk)
            for o in objs:
                o.location = rig.matrix_world @ o.location
                o.rotation_euler = rig.rotation_euler
        objs.append(add_text(label, 0.07, (0, -1.0, -0.14)))
        panels.append(render_to_array(tmp_path(f"deform_{act}_{frame}.png")))
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
    out = np.concatenate(panels, axis=1)
    path = PREVIEW_DIR / f"{cid.lower()}-deform.png"
    save_array(out, path)
    print(f"DEFORM {cid} -> {path.relative_to(ROOT)} bytes={path.stat().st_size}")


def variants(cid, vspec):
    rig = open_char(cid)
    pw, ph = 260, 320
    setup_render(pw, ph, 32)
    add_lights()
    ortho = 2.0
    add_camera(-0.08 * ortho + ortho / 2, ortho)
    rig.rotation_euler = (0, 0, math.radians(-22))
    rows = []
    for hair in vspec["hairStyles"]:
        for ob in bpy.data.objects:
            if ob.name.startswith("hair_"):
                ob.hide_render = ob.name != "hair_" + hair
        row = []
        for pal_name, pal in vspec["palettes"].items():
            paint_cells(rig, {k: v for k, v in pal.items() if k.startswith("outfit_")})
            t = add_text(f"{hair} / {pal_name}", 0.075, (0, -1.0, -0.10))
            row.append(render_to_array(tmp_path(f"var_{hair}_{pal_name}.png")))
            bpy.data.objects.remove(t, do_unlink=True)
        rows.append(np.concatenate(row, axis=1))
    # first hair style on top: Blender buffers start at the bottom row
    out = np.concatenate(rows[::-1], axis=0)
    path = PREVIEW_DIR / f"{cid.lower()}-variants.png"
    save_array(out, path)
    print(f"VARIANTS {cid} -> {path.relative_to(ROOT)} bytes={path.stat().st_size}")


def head_frame(rig):
    """(centre z, ortho scale) that frames the head plus any hair volume."""
    hb = rig.data.bones["head"]
    z0, z1 = hb.head_local.z, hb.tail_local.z
    return (z0 + z1) / 2 + 0.03, (z1 - z0) * 1.75


def expressions(data, ids):
    """Rows: characters; columns: neutral + every shape key at 1.0 (rest pose)."""
    names = ["neutral"] + data["expressions"]["names"]
    pw, ph = 150, 170
    rows = []
    for cid in ids:
        rig = open_char(cid)
        rig.data.pose_position = "REST"
        setup_render(pw, ph, 32)
        add_lights()
        cz, ortho = head_frame(rig)
        add_camera(cz, ortho)
        rig.rotation_euler = (0, 0, math.radians(-14))
        keys = bpy.data.objects["body"].data.shape_keys.key_blocks
        spec = data["characters"][cid]
        # cream label band in front of the shoulders keeps captions legible
        band_h = ortho * 0.16
        bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, -0.9, cz - ortho / 2 + band_h / 2),
                                         rotation=(math.radians(90), 0, 0))
        band = bpy.context.active_object
        band.scale = (ortho, band_h, 1.0)
        band.data.materials.append(emission_mat("band", CREAM))
        row = []
        for name in names:
            for kb in keys:
                kb.value = 1.0 if kb.name == name else 0.0
            label = name if name != "neutral" else f"{spec['displayName']}: neutral"
            t = add_text(label, ortho * 0.085, (0, -1.0, cz - ortho / 2 + band_h * 0.30), INK)
            row.append(render_to_array(tmp_path(f"expr_{cid}_{name}.png")))
            bpy.data.objects.remove(t, do_unlink=True)
        rows.append(np.concatenate(row, axis=1))
        print(f"EXPRESSIONS {cid}: {names}")
    out = np.concatenate(rows[::-1], axis=0)  # first character on top (buffers are bottom-up)
    out = K.median3_keep_lines(out)
    path = PREVIEW_DIR / "character-expressions.png"
    K.save_png(out, path, quant=4)
    print(f"EXPRESSION_SHEET -> {path.relative_to(ROOT)} bytes={path.stat().st_size}")


def lod_sheet(data, ids):
    """Columns: characters. Rows: LOD0 (body + default hair + props), LOD1, palette atlas."""
    pw, ph, ah = 180, 330, 200
    cols = []
    for cid in ids:
        rig = open_char(cid)
        rig.rotation_euler = (0, 0, math.radians(-25))
        spec = data["characters"][cid]
        default_hair = rig["kantor_default_hair"]
        lod0 = [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render]
        lod1 = bpy.data.objects["lod1"]
        panels = []
        setup_render(pw, ph, 32)
        add_lights()
        add_camera(0.75, 2.0)
        for label, show in ((f"LOD0 {rig['kantor_lod0_tris']} tris", lod0),
                            (f"LOD1 {rig['kantor_lod1_tris']} tris", [lod1])):
            for o in bpy.data.objects:
                if o.type == "MESH":
                    o.hide_render = o not in show
            txt = [add_text(spec["displayName"], 0.075, (0, -1.0, -0.10)), add_text(label, 0.065, (0, -1.0, -0.19), INK)]
            panels.append(render_to_array(tmp_path(f"lod_{cid}_{len(panels)}.png")))
            for t in txt:
                bpy.data.objects.remove(t, do_unlink=True)
        # atlas swatch: the real texture on an emissive plane, nearest filtering
        for o in bpy.data.objects:
            if o.type == "MESH":
                o.hide_render = True
        bpy.context.scene.render.use_freestyle = False
        bpy.context.scene.render.resolution_y = ah
        bpy.context.scene.camera.data.ortho_scale = 1.0
        bpy.context.scene.camera.location = (0, -12.0, 0.04)
        bpy.ops.mesh.primitive_plane_add(size=0.62, location=(0, 0, 0.10), rotation=(math.radians(90), 0, 0))
        plane = bpy.context.active_object
        m = bpy.data.materials.new("atlas_view")
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        o_ = nt.nodes.new("ShaderNodeOutputMaterial")
        e = nt.nodes.new("ShaderNodeEmission")
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images["kantor_atlas"]
        tex.interpolation = "Closest"
        nt.links.new(tex.outputs["Color"], e.inputs["Color"])
        nt.links.new(e.outputs["Emission"], o_.inputs["Surface"])
        plane.data.materials.append(m)
        meta = rig["kantor_atlas"]
        t = add_text(f"atlas {meta['size']} px, {len(meta['zones'])} zones", 0.07, (0, -1.0, -0.34), INK)
        t.rotation_euler = (math.radians(90), 0, 0)
        panels.append(render_to_array(tmp_path(f"lod_{cid}_atlas.png")))
        # panels are bottom-up buffers: stack atlas (bottom), LOD1, LOD0 (top)
        cols.append(np.concatenate([panels[2], panels[1], panels[0]], axis=0))
        print(f"LOD {cid}: lod0={rig['kantor_lod0_tris']} lod1={rig['kantor_lod1_tris']} hair={default_hair}")
    out = K.median3_keep_lines(np.concatenate(cols, axis=1))
    path = PREVIEW_DIR / "character-lod.png"
    K.save_png(out, path, quant=4)
    print(f"LOD_SHEET -> {path.relative_to(ROOT)} bytes={path.stat().st_size}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    data = json.loads(DATA.read_text(encoding="utf-8"))
    ids = list(data["characters"])
    if "--only" in argv:
        ids = [argv[argv.index("--only") + 1]]
    new_only = "--sheets-only-new" in argv
    if "--extras-only" not in argv and not new_only:
        for cid in ids:
            sheet(cid, data["characters"][cid])
    if "--no-extras" not in argv and "CH-CEO" in ids and not new_only:
        deform("CH-CEO", data["characters"]["CH-CEO"], data["rig"]["seatHeightM"])
        variants("CH-CEO", data["avatarVariants"]["CH-CEO"])
    if "--no-extras" not in argv:
        expressions(data, ids)
        lod_sheet(data, ids)
    if _TMP is not None:
        shutil.rmtree(_TMP, ignore_errors=True)
    print("RENDER_DONE")


if __name__ == "__main__":
    main()
