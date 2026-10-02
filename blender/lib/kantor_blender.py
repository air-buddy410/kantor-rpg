"""Shared Blender helpers for the building and furniture generators.

Geometry is accumulated in a Builder (plain lists) and turned into one mesh
object at the end, which keeps generation deterministic and fast. Colours are
parsed from app/src/world/palette.ts so Blender and the runtime share one
palette source.
"""
from __future__ import annotations

import math
import re
import struct
import zlib
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
PALETTE_TS = ROOT / "app" / "src" / "world" / "palette.ts"
TAU = math.tau


# ------------------------------------------------------------------ palette
def parse_palette():
    """Return (ENV, FINISH_COLOR) as {name: '#rrggbb'} parsed from palette.ts."""
    src = PALETTE_TS.read_text(encoding="utf-8")

    def block(name):
        m = re.search(rf"export const {name}[^=]*=\s*\{{(.*?)\n\}}", src, re.S)
        if not m:
            raise ValueError(f"{name} not found in {PALETTE_TS}")
        return m.group(1)
    env = {k: "#" + v.upper() for k, v in re.findall(r"(\w+):\s*0x([0-9a-fA-F]{6})", block("ENV"))}
    # keys may be quoted ('karpet tile matte') or bare identifiers (epoxy)
    fin = {(q or b): "#" + v.upper()
           for q, b, v in re.findall(r"(?:'([^']+)'|(\w+)):\s*0x([0-9a-fA-F]{6})", block("FINISH_COLOR"))}
    art = {}
    for k, vals in re.findall(r"'(ART-\d+)':\s*\[([^\]]+)\]", block("ARTWORK")):
        art[k] = ["#" + v.upper() for v in re.findall(r"0x([0-9a-fA-F]{6})", vals)]
    return env, fin, art


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h, a=1.0):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (a,)


def slug(s):
    s = s.lower().replace("(", "").replace(")", "")
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_") or "none"


class Materials:
    """Name -> bpy material, created once per name (matte Principled BSDF)."""

    def __init__(self):
        self.cache = {}

    def get(self, name, hexc, rough=0.82, emit=0.0):
        m = self.cache.get(name)
        if m is not None:
            return m
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bs = m.node_tree.nodes.get("Principled BSDF")
        bs.inputs["Base Color"].default_value = hex_lin(hexc)
        bs.inputs["Roughness"].default_value = rough
        bs.inputs["Metallic"].default_value = 0.0
        if "Specular IOR Level" in bs.inputs:
            bs.inputs["Specular IOR Level"].default_value = 0.3
        if emit > 0:
            bs.inputs["Emission Color"].default_value = hex_lin(hexc)
            bs.inputs["Emission Strength"].default_value = emit
        m.diffuse_color = hex_lin(hexc)
        m["hex"] = hexc
        self.cache[name] = m
        return m


# ------------------------------------------------------------------ geometry
class Builder:
    def __init__(self, name):
        self.name = name
        self.verts, self.faces, self.mats, self.smooth = [], [], [], []

    def add(self, geom, mat, xf=None, smooth=True):
        verts, faces = geom
        base = len(self.verts)
        for v in verts:
            self.verts.append((xf @ Vector(v)) if xf is not None else Vector(v))
        for f in faces:
            self.faces.append(tuple(base + i for i in f))
            self.mats.append(mat)
            self.smooth.append(smooth)
        return self

    def tri_count(self):
        return sum(len(f) - 2 for f in self.faces)


def box(x0, y0, z0, x1, y1, z1):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return v, f


def rbox(w, d, h, r=0.03, n=2):
    """Rounded box centred on x/y with its base at z=0. Constant edge radius r."""
    r = max(1e-4, min(r, w / 2 - 1e-4, d / 2 - 1e-4, h / 2 - 1e-4))
    hx, hy, hz = w / 2 - r, d / 2 - r, h / 2 - r
    cols = []
    for q in range(4):
        sx = 1 if q in (0, 3) else -1
        sy = 1 if q in (0, 1) else -1
        for i in range(n + 1):
            a = (q * 90 + 90 * i / n) * math.pi / 180
            cols.append((math.cos(a), math.sin(a), sx, sy))
    rows = []
    for j in range(2 * (n + 1)):
        if j <= n:
            lat = -90 + 90 * j / n
            sz = -1
        else:
            lat = 90 * (j - n - 1) / n
            sz = 1
        rows.append((math.radians(lat), sz))
    verts = []
    for lat, sz in rows:
        cl = math.cos(lat)
        for cx, cy, sx, sy in cols:
            verts.append((sx * hx + r * cl * cx, sy * hy + r * cl * cy, h / 2 + sz * hz + r * math.sin(lat)))
    nc = len(cols)
    faces = []
    for j in range(len(rows) - 1):
        for i in range(nc):
            a = j * nc + i
            b = j * nc + (i + 1) % nc
            faces.append((a, b, b + nc, a + nc))
    # flat caps: one point per quadrant at the poles
    top = [(len(rows) - 1) * nc + q * (n + 1) for q in range(4)]
    bot = [q * (n + 1) for q in range(4)]
    faces.append(tuple(top))
    faces.append(tuple(reversed(bot)))
    return verts, faces


def cyl(r, h, seg=16, r_top=None, bevel=0.0):
    """Cylinder with base at z=0 along +Z; optional rounded rim via a bevel ring."""
    r_top = r if r_top is None else r_top
    rings = [(0.0, r - bevel)]
    if bevel:
        rings += [(bevel * 0.3, r - bevel * 0.3), (bevel, r)]
    rings += [(h - bevel, r_top)] if bevel else [(h, r_top)]
    if bevel:
        rings += [(h - bevel * 0.3, r_top - bevel * 0.3), (h, r_top - bevel)]
    verts, faces = [], []
    for z, rr in rings:
        for k in range(seg):
            a = TAU * k / seg
            verts.append((rr * math.cos(a), rr * math.sin(a), z))
    for j in range(len(rings) - 1):
        for k in range(seg):
            a = j * seg + k
            b = j * seg + (k + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    faces.append(tuple(range(seg - 1, -1, -1)))
    faces.append(tuple((len(rings) - 1) * seg + k for k in range(seg)))
    return verts, faces


def ellipsoid(rx, ry, rz, seg=16, rings=10):
    verts = [(0, 0, -rz)]
    for i in range(1, rings):
        v = -math.pi / 2 + math.pi * i / rings
        for k in range(seg):
            u = TAU * k / seg
            verts.append((rx * math.cos(v) * math.cos(u), ry * math.cos(v) * math.sin(u), rz * math.sin(v)))
    verts.append((0, 0, rz))
    faces = []
    for k in range(seg):
        faces.append((0, 1 + (k + 1) % seg, 1 + k))
    for i in range(rings - 2):
        for k in range(seg):
            a = 1 + i * seg + k
            b = 1 + i * seg + (k + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    top = len(verts) - 1
    base = 1 + (rings - 2) * seg
    for k in range(seg):
        faces.append((base + k, base + (k + 1) % seg, top))
    return verts, faces


def torus(R, r, seg=20, segr=8):
    verts, faces = [], []
    for i in range(seg):
        a = TAU * i / seg
        for j in range(segr):
            b = TAU * j / segr
            rr = R + r * math.cos(b)
            verts.append((rr * math.cos(a), rr * math.sin(a), r * math.sin(b)))
    for i in range(seg):
        for j in range(segr):
            a = i * segr + j
            b = i * segr + (j + 1) % segr
            c = ((i + 1) % seg) * segr + (j + 1) % segr
            d = ((i + 1) % seg) * segr + j
            faces.append((a, b, c, d))
    return verts, faces


def rod(p0, p1, r, seg=8):
    """Cylinder between two points."""
    p0, p1 = Vector(p0), Vector(p1)
    axis = p1 - p0
    v, f = cyl(r, axis.length, seg)
    m = Matrix.Translation(p0) @ axis.to_track_quat("Z", "Y").to_matrix().to_4x4()
    return [tuple(m @ Vector(x)) for x in v], f


def prism(poly, z0, z1):
    """Vertical extrusion of a CCW polygon [(x, y)] between z0 and z1."""
    n = len(poly)
    verts = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return verts, faces


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def R(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def make_object(B: Builder, mats: dict, collection=None, clean=True, autosmooth=None):
    me = bpy.data.meshes.new(B.name)
    me.from_pydata([tuple(v) for v in B.verts], [], B.faces)
    used = []
    for n in B.mats:
        if n not in used:
            used.append(n)
    for n in used:
        me.materials.append(mats[n])
    idx = {n: i for i, n in enumerate(used)}
    me.polygons.foreach_set("material_index", [idx[n] for n in B.mats])
    me.polygons.foreach_set("use_smooth", B.smooth)
    bm = bmesh.new()
    bm.from_mesh(me)
    if clean:
        # generated winding is already outward for boxes and plates; cleaning
        # is for rounded primitives whose poles collapse into duplicates
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-7)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    if autosmooth is not None:
        # Blender 4.0 auto smooth: rounded parts shade soft, flat faces stay crisp;
        # the glTF exporter writes the resulting split normals
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        if hasattr(me, 'set_sharp_from_angle'):
            me.set_sharp_from_angle(angle=math.radians(autosmooth))
        else:
            me.use_auto_smooth = True
            me.auto_smooth_angle = math.radians(autosmooth)
    me.update()
    ob = bpy.data.objects.new(B.name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def world_bbox(obs):
    pts = [o.matrix_world @ v.co for o in obs for v in o.data.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


# ------------------------------------------------------------------ rendering
def setup_cycles(w, h, samples=32, outline=False):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False  # this Blender build has no OpenImageDenoise
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.max_bounces = 4
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.dither_intensity = 0.0
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.use_freestyle = outline
    if outline:
        sc.render.line_thickness_mode = "ABSOLUTE"
        sc.render.line_thickness = 1.0
        vl = sc.view_layers[0]
        vl.use_freestyle = True
        fs = vl.freestyle_settings
        ls = fs.linesets[0] if fs.linesets else fs.linesets.new("outline")
        if ls.linestyle is None:
            ls.linestyle = bpy.data.linestyles.new("ink")
        ls.select_silhouette = True
        ls.select_border = True
        ls.select_crease = False
        ls.select_contour = True
        ls.select_material_boundary = False
        ls.linestyle.color = hex_lin("#3A2A22")[:3]


def world_bg(cam_hex="#F3EAD7", light_hex="#F6EEE2", strength=0.6):
    sc = bpy.context.scene
    world = sc.world or bpy.data.worlds.new("bg")
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    a = nt.nodes.new("ShaderNodeBackground")
    a.inputs["Color"].default_value = hex_lin(light_hex)
    a.inputs["Strength"].default_value = strength
    b = nt.nodes.new("ShaderNodeBackground")
    b.inputs["Color"].default_value = hex_lin(cam_hex)
    b.inputs["Strength"].default_value = 1.0
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(a.outputs["Background"], mix.inputs[1])
    nt.links.new(b.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])


def sun(name, rot_deg, energy, hexc="#FFF1DE", angle=12):
    d = bpy.data.lights.new(name, "SUN")
    d.energy = energy
    d.color = hex_lin(hexc)[:3]
    d.angle = math.radians(angle)
    o = bpy.data.objects.new(name, d)
    o.rotation_euler = [math.radians(a) for a in rot_deg]
    bpy.context.scene.collection.objects.link(o)
    return o


def look_at_camera(loc, target, ortho=None, lens=35.0, name="cam"):
    cd = bpy.data.cameras.new(name)
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    else:
        cd.lens = lens
    cd.clip_end = 500
    cam = bpy.data.objects.new(name, cd)
    cam.location = loc
    direction = Vector(target) - Vector(loc)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
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
    nt.links.new(e.outputs["Emission"], o.inputs["Surface"])
    return m


def camera_label(cam, text, size=0.05, hexc="#2F5D50", offset=(0.0, -0.42)):
    """Text glued to the camera (works for ortho and perspective framing)."""
    cu = bpy.data.curves.new("label", "FONT")
    cu.body = text
    cu.size = size
    cu.align_x = "CENTER"
    ob = bpy.data.objects.new("label", cu)
    ob.data.materials.append(emission_mat("label_" + hexc, hexc))
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = cam
    ob.location = (offset[0], offset[1], -1.0)
    ob.visible_shadow = False
    return ob


def render_pixels(path):
    """Render to a temp path and return float RGBA rows (bottom-up)."""
    import numpy as np
    sc = bpy.context.scene
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(path))
    w, h = img.size
    arr = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return arr


def median3(arr):
    """3x3 median per channel: removes Cycles speckle (no OIDN here) while
    keeping edges, which also keeps PNGs inside the size budget."""
    import numpy as np
    h, w, c = arr.shape
    pad = np.pad(arr, ((1, 1), (1, 1), (0, 0)), mode="edge")
    stack = np.stack([pad[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3)])
    return np.median(stack, axis=0).astype(np.float32)


def median3_keep_lines(arr, darker=0.12):
    """Median denoise that keeps outline pixels: wherever the original is much
    darker than its 3x3 median (a Freestyle stroke) the original survives."""
    import numpy as np
    med = median3(arr)
    lum = arr[..., :3].mean(axis=2)
    mlum = med[..., :3].mean(axis=2)
    keep = (lum < mlum - darker)[..., None]
    return np.where(keep, arr, med).astype(np.float32)


def save_png(arr, path, quant=1):
    """Deterministic 8-bit RGB PNG (per-row filter choice, zlib level 9).

    quant > 1 rounds channels to that step; on noisy Cycles output it acts like
    light posterisation and roughly halves the file size."""
    import numpy as np
    h, w, _ = arr.shape
    v = np.round(arr[::-1, :, :3] * 255.0)
    if quant > 1:
        v = np.round(v / quant) * quant
    px = np.clip(v, 0, 255).astype(np.uint8).reshape(h, w * 3)
    x = px.astype(np.int16)
    left = np.zeros_like(x)
    left[:, 3:] = x[:, :-3]
    up = np.zeros_like(x)
    up[1:] = x[:-1]
    ul = np.zeros_like(x)
    ul[1:, 3:] = x[:-1, :-3]
    p = left + up - ul
    pa, pb, pc = np.abs(p - left), np.abs(p - up), np.abs(p - ul)
    paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, up, ul))
    cands = [(c % 256).astype(np.uint8) for c in (x, x - left, x - up, x - (left + up) // 2, x - paeth)]
    scores = np.stack([np.minimum(c, 256 - c.astype(np.int16)).sum(axis=1) for c in cands])
    best = scores.argmin(axis=0)
    raw = bytearray()
    for r in range(h):
        raw.append(int(best[r]))
        raw += cands[best[r]][r].tobytes()

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(png)


def export_glb(path, objects, extras=True):
    import sys
    sys.path.insert(0, str(ROOT))
    from tools.kantor.blender_compat import without_vertex_colors
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_extras=extras, export_yup=True,
        export_apply=False, export_texcoords=False, export_normals=True, export_tangents=False,
        **without_vertex_colors(bpy.ops.export_scene.gltf.get_rna_type().properties),
        export_materials="EXPORT", export_cameras=False, export_lights=False,
        export_skins=False, export_morph=False, export_animations=False, export_image_format="NONE")


def read_glb_json(path):
    import json
    b = Path(path).read_bytes()
    magic, version, length = struct.unpack("<4sII", b[:12])
    if magic != b"glTF" or version != 2 or length != len(b):
        raise ValueError(f"bad GLB header {path}")
    clen, ctype = struct.unpack("<I4s", b[12:20])
    return json.loads(b[20:20 + clen]), b[20 + clen + 8:]
