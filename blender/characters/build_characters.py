"""Procedural builder for the original kantor-rpg characters.

Run:
  blender -b --factory-startup -noaudio --python blender/characters/build_characters.py -- [--only CH-CEO] [--variants]

Reads design/characters.json, builds every character from smooth primitives,
rigs it on the shared skeleton, keys the required actions, then writes
blender/out/<id>.blend and app/public/assets/characters/<id>.glb.

The CEO avatar variants are always embedded in ch-ceo.glb as hair_<style>
nodes (single-GLB approach, see blender/README.md); --variants is accepted so
the documented command stays stable, and only adds a variant summary print.
No randomness is used except a fixed-seed RNG for hair lock jitter and paint
smudges, so reruns produce the same geometry.
"""
from __future__ import annotations

import json
import math
import random
import sys
import time
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "design" / "characters.json"
OUT_BLEND = ROOT / "blender" / "out"
OUT_GLB = ROOT / "app" / "public" / "assets" / "characters"
TAU = math.tau


# --------------------------------------------------------------------------
# small math helpers
# --------------------------------------------------------------------------
def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h: str):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


def mix_hex(a: str, b: str, t: float) -> str:
    a, b = a.lstrip("#"), b.lstrip("#")
    out = []
    for i in (0, 2, 4):
        va, vb = int(a[i:i + 2], 16), int(b[i:i + 2], 16)
        out.append(round(va + (vb - va) * t))
    return "#" + "".join(f"{v:02X}" for v in out)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    if e1 == e0:
        return 0.0 if x < e0 else 1.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def spow(v, e):
    return math.copysign(abs(v) ** e, v)


def bezier(pts, n):
    """Evaluate a Bezier curve of any degree at n+1 points (de Casteljau)."""
    out = []
    for i in range(n + 1):
        t = i / n
        tmp = [Vector(p) for p in pts]
        while len(tmp) > 1:
            tmp = [tmp[j].lerp(tmp[j + 1], t) for j in range(len(tmp) - 1)]
        out.append(tmp[0])
    return out


# --------------------------------------------------------------------------
# geometry primitives: each returns (verts, faces) in local coordinates
# --------------------------------------------------------------------------
def loft_rings(rings, pole_bottom=None, pole_top=None):
    """rings: list of equal-length point lists ordered bottom to top."""
    seg = len(rings[0])
    verts = [v for ring in rings for v in ring]
    faces, band = [], []
    for i in range(len(rings) - 1):
        for k in range(seg):
            a = i * seg + k
            b = i * seg + (k + 1) % seg
            faces.append((a, b, b + seg, a + seg))
            band.append(i)
    if pole_bottom is not None:
        pi = len(verts)
        verts.append(Vector(pole_bottom))
        for k in range(seg):
            faces.append((pi, (k + 1) % seg, k))
            band.append(-1)
    if pole_top is not None:
        pi = len(verts)
        verts.append(Vector(pole_top))
        base = (len(rings) - 1) * seg
        for k in range(seg):
            faces.append((base + k, base + (k + 1) % seg, pi))
            band.append(len(rings) - 1)
    return verts, faces, band


def ellipse_ring(z, rx, ry, seg, cx=0.0, cy=0.0):
    return [Vector((cx + rx * math.cos(TAU * k / seg), cy + ry * math.sin(TAU * k / seg), z)) for k in range(seg)]


def loft(profile, seg, cap_bottom=True, cap_top=True):
    """profile: [(z, rx, ry[, cx, cy])] bottom to top. Caps close with a pole."""
    rings = []
    for p in profile:
        z, rx, ry = p[0], p[1], p[2]
        cx = p[3] if len(p) > 3 else 0.0
        cy = p[4] if len(p) > 4 else 0.0
        rings.append(ellipse_ring(z, rx, ry, seg, cx, cy))
    pb = None
    pt = None
    if cap_bottom:
        p = profile[0]
        pb = (p[3] if len(p) > 3 else 0.0, p[4] if len(p) > 4 else 0.0, p[0])
    if cap_top:
        p = profile[-1]
        pt = (p[3] if len(p) > 3 else 0.0, p[4] if len(p) > 4 else 0.0, p[0])
    return loft_rings(rings, pb, pt)


def superq(a, b, c, e1=1.0, e2=1.0, seg=16, rings=10):
    """Superquadric (ellipsoid when e1=e2=1). Low exponents give rounded boxes."""
    rr = []
    for i in range(1, rings):
        v = -math.pi / 2 + math.pi * i / rings
        z = c * spow(math.sin(v), e1)
        r = spow(math.cos(v), e1)
        ring = []
        for k in range(seg):
            u = TAU * k / seg
            ring.append(Vector((a * r * spow(math.cos(u), e2), b * r * spow(math.sin(u), e2), z)))
        rr.append(ring)
    return loft_rings(rr, (0, 0, -c), (0, 0, c))


def tube(path, widths, thick=None, seg=8, radial_center=None, cap=True):
    """Sweep an ellipse along path. widths/thick: per-point half sizes.

    radial_center: when given (hair locks), the thickness axis points away from
    that center so locks lie flat against the head instead of twisting.
    """
    n = len(path)
    thick = thick or widths
    tangents = []
    for i in range(n):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, n - 1)]
        t = (b - a)
        tangents.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))
    normals = []
    if radial_center is not None:
        for i in range(n):
            r = path[i] - radial_center
            r = r - tangents[i] * r.dot(tangents[i])
            if r.length < 1e-6:
                r = tangents[i].orthogonal()
            normals.append(r.normalized())
    else:
        nrm = tangents[0].orthogonal().normalized()
        for i in range(n):
            if i > 0:
                q = tangents[i - 1].rotation_difference(tangents[i])
                nrm = q @ nrm
            nrm = (nrm - tangents[i] * nrm.dot(tangents[i])).normalized()
            normals.append(nrm.copy())
    rings = []
    for i in range(n):
        side = tangents[i].cross(normals[i]).normalized()
        ring = []
        for k in range(seg):
            th = TAU * k / seg
            ring.append(path[i] + side * (widths[i] * math.cos(th)) + normals[i] * (thick[i] * math.sin(th)))
        rings.append(ring)
    pb = pt = None
    if cap:
        pb = path[0] - tangents[0] * (thick[0] * 0.6)
        pt = path[-1] + tangents[-1] * (thick[-1] * 0.6)
    v, f, band = loft_rings(rings, pb, pt)
    return v, f, band


def torus(R, r, seg_major=24, seg_minor=8):
    verts, faces = [], []
    for i in range(seg_major):
        a = TAU * i / seg_major
        c, s = math.cos(a), math.sin(a)
        for j in range(seg_minor):
            b = TAU * j / seg_minor
            rr = R + r * math.cos(b)
            verts.append(Vector((rr * c, rr * s, r * math.sin(b))))
    for i in range(seg_major):
        for j in range(seg_minor):
            a = i * seg_minor + j
            b = i * seg_minor + (j + 1) % seg_minor
            c2 = ((i + 1) % seg_major) * seg_minor + (j + 1) % seg_minor
            d = ((i + 1) % seg_major) * seg_minor + j
            faces.append((a, b, c2, d))
    return verts, faces, [0] * len(faces)


def frame_from(forward: Vector, up_hint=Vector((0, 0, 1))) -> Matrix:
    """Rotation whose local -Y points along `forward` (feature faces outward)."""
    f = forward.normalized()
    z = (up_hint - f * up_hint.dot(f))
    if z.length < 1e-6:
        z = f.orthogonal()
    z.normalize()
    x = z.cross(f).normalized()
    m = Matrix((x, -f, z)).transposed()
    return m.to_4x4()


# --------------------------------------------------------------------------
# mesh accumulator
# --------------------------------------------------------------------------
class Builder:
    def __init__(self, name):
        self.name = name
        self.verts: list[Vector] = []
        self.faces: list[tuple] = []
        self.mats: list[str] = []
        self.weights: list[dict] = []

    def add(self, geom, mat, weight, xf: Matrix | None = None, keep=None):
        """mat: str or callable(band, centroid_local)->str; weight: dict or callable(world_pos)->dict."""
        verts, faces, band = geom
        if keep is not None:
            kept = [(f, b) for f, b in zip(faces, band) if keep(sum((verts[i] for i in f), Vector()) / len(f))]
            faces = [f for f, _ in kept]
            band = [b for _, b in kept]
            used = sorted({i for f in faces for i in f})
            remap = {old: new for new, old in enumerate(used)}
            verts = [verts[i] for i in used]
            faces = [tuple(remap[i] for i in f) for f in faces]
        base = len(self.verts)
        for v in verts:
            w = xf @ v if xf is not None else v.copy()
            self.verts.append(w)
            self.weights.append(weight(w) if callable(weight) else weight)
        for f, b in zip(faces, band):
            self.faces.append(tuple(base + i for i in f))
            if callable(mat):
                c = sum((verts[i] for i in f), Vector()) / len(f)
                self.mats.append(mat(b, c))
            else:
                self.mats.append(mat)

    def tri_count(self):
        return sum(len(f) - 2 for f in self.faces)


# --------------------------------------------------------------------------
# proportions
# --------------------------------------------------------------------------
class Props:
    pass


def proportions(spec):
    b = spec["body"]
    P = Props()
    P.H = b["heightM"]
    P.s = P.H / 1.55
    s = P.s
    # base radii below were tuned on the first render: x1.14/x1.22 gives the
    # rounder, cozier torso; arms and legs are thickened separately so thighs
    # do not fuse into one mass
    P.tw = b.get("torsoWidth", 1.0) * s * 1.14
    P.td = b.get("torsoDepth", 1.0) * s * 1.22
    P.ls = b.get("limbScale", 1.0) * s * 1.18
    P.lg = b.get("limbScale", 1.0) * s * 1.20
    P.head_h = P.H / b["headRatio"]
    P.skull_top = P.H - 0.024 * s
    P.rz = P.head_h / 2
    P.hc = P.skull_top - P.rz
    P.rx = P.rz * 0.97 * b.get("headWidth", 1.0)
    P.ry = P.rz * 0.90
    P.chin = P.skull_top - P.head_h
    P.shoulder_z = P.chin - 0.022 * s
    P.hip_z = P.H * b["legRatio"]
    P.ankle_z = 0.078 * s
    P.leg_len = P.hip_z - P.ankle_z
    P.L1 = P.leg_len * 0.51
    P.L2 = P.leg_len - P.L1
    P.hip_x = 0.066 * P.tw
    P.sh_jz = P.shoulder_z - 0.05 * s
    P.apose = math.radians(10.0)
    P.Lu = 0.180 * s
    P.Lf = 0.155 * s
    P.Lh = 0.075 * s
    P.spine_z = P.hip_z + 0.085 * s
    P.chest_z = P.spine_z + 0.5 * (P.shoulder_z - P.spine_z)
    P.neck_z = P.shoulder_z - 0.005 * s
    P.headb_z = P.chin + 0.04 * s
    P.belt_z = P.hip_z + 0.05 * s
    P.toe_y = -0.105 * s
    P.foot_len = 0.10 * s
    # shoulderWidth in the JSON is the outer shoulder line; the joint sits just
    # inside the torso surface so the shoulder ball reads as a deltoid, not a pad
    arm_r = 0.045 * P.ls
    P.sh_x = min(b["shoulderWidth"] / 2 - arm_r * 0.7, torso_radius_at(P, P.sh_jz)[0] + 0.15 * arm_r)
    return P


def torso_profile(P, off=0.0):
    s, tw, td = P.s, P.tw, P.td
    h, sh = P.hip_z, P.shoulder_z
    waist = h + 0.12 * s
    mid = lerp(waist, sh, 0.45)
    rows = [
        (h - 0.096 * s, 0.050 * tw, 0.040 * td),
        (h - 0.075 * s, 0.100 * tw, 0.078 * td),
        (h - 0.040 * s, 0.127 * tw, 0.095 * td),
        (h + 0.010 * s, 0.133 * tw, 0.099 * td),
        (P.belt_z, 0.130 * tw, 0.097 * td),
        (h + 0.075 * s, 0.126 * tw, 0.094 * td),
        (waist, 0.121 * tw, 0.090 * td),
        (mid, 0.125 * tw, 0.095 * td),
        (sh - 0.075 * s, 0.131 * tw, 0.098 * td),
        (sh - 0.035 * s, 0.124 * tw, 0.091 * td),
        (sh - 0.005 * s, 0.102 * tw, 0.076 * td),
        (sh + 0.016 * s, 0.062 * tw, 0.052 * td),
    ]
    return [(z, rx + off, ry + off) for z, rx, ry in rows]


def torso_radius_at(P, z, off=0.0):
    prof = torso_profile(P, off)
    if z <= prof[0][0]:
        return prof[0][1], prof[0][2]
    for (z0, x0, y0), (z1, x1, y1) in zip(prof, prof[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return lerp(x0, x1, t), lerp(y0, y1, t)
    return prof[-1][1], prof[-1][2]


# --------------------------------------------------------------------------
# weights
# --------------------------------------------------------------------------
def blend2(a, b, t):
    if t <= 0.0:
        return {a: 1.0}
    if t >= 1.0:
        return {b: 1.0}
    return {a: 1.0 - t, b: t}


def torso_weight(P):
    def w(p):
        z = p.z
        if z < P.spine_z + 0.04 * P.s:
            return blend2("hips", "spine", smoothstep(P.spine_z - 0.03 * P.s, P.spine_z + 0.04 * P.s, z))
        if z < P.chest_z + 0.05 * P.s:
            return blend2("spine", "chest", smoothstep(P.chest_z - 0.05 * P.s, P.chest_z + 0.05 * P.s, z))
        return {"chest": 1.0}
    return w


def limb_weight(origin, direction, j1, j2, b0, b1, b2, blend=0.03):
    """Along a straight limb: b0 until joint j1, b1 until j2, then b2 (distances)."""
    def w(p):
        d = (p - origin).dot(direction)
        if d < j1 + blend:
            return blend2(b0, b1, smoothstep(j1 - blend, j1 + blend, d))
        if b2 is None:
            return {b1: 1.0}
        return blend2(b1, b2, smoothstep(j2 - blend * 0.5, j2 + blend * 0.5, d))
    return w


# --------------------------------------------------------------------------
# head
# --------------------------------------------------------------------------
class Head:
    def __init__(self, P, jaw=0.24):
        self.P = P
        self.c = Vector((0, 0, P.hc))
        self.rx, self.ry, self.rz = P.rx, P.ry, P.rz
        self.jaw = jaw

    def squeeze(self, zr):
        return 1.0 - self.jaw * max(0.0, -zr) ** 2

    def deform(self, p):
        k = self.squeeze(p.z / self.rz)
        # cheeks stay round while the chin narrows: squeeze x more than y
        return Vector((p.x * k, p.y * (1 - (1 - k) * 0.6), p.z))

    def on_dir(self, az, el, off=0.0, deform=True):
        d = Vector((math.sin(math.radians(az)) * math.cos(math.radians(el)),
                    -math.cos(math.radians(az)) * math.cos(math.radians(el)),
                    math.sin(math.radians(el))))
        t = 1.0 / math.sqrt((d.x / self.rx) ** 2 + (d.y / self.ry) ** 2 + (d.z / self.rz) ** 2)
        p = d * t
        n = Vector((p.x / self.rx ** 2, p.y / self.ry ** 2, p.z / self.rz ** 2)).normalized()
        p = p + n * off
        if deform:
            p = self.deform(p)
        return p, n

    def front(self, x, z, off=0.0):
        """Point on the (deformed) front surface at head-relative x,z plus normal offset."""
        k = self.squeeze(z / self.rz)
        xs = x / k
        val = max(1e-4, 1 - (xs / self.rx) ** 2 - (z / self.rz) ** 2)
        ys = -self.ry * math.sqrt(val)
        n = Vector((xs / self.rx ** 2, ys / self.ry ** 2, z / self.rz ** 2)).normalized()
        p = self.deform(Vector((xs, ys, z))) + n * off
        return p, n


def build_head(B: Builder, P, spec, colors):
    H = Head(P)
    seg, rings = 32, 22
    v, f, band = superq(P.rx, P.ry, P.rz, 1.0, 1.0, seg, rings)
    v = [H.deform(p) for p in v]
    B.add((v, f, band), "skin", {"head": 1.0}, Matrix.Translation(H.c))
    hw = {"head": 1.0}
    rz, rx = P.rz, P.rx
    # eyes: dark oval, coloured iris, two highlights and an upper lash line
    ez = -0.17 * rz
    ehx, ehz = 0.150 * rx, 0.195 * rz
    H.ez, H.ex = ez, 0.385 * rx
    for side in (1, -1):
        ex = side * 0.385 * rx
        p, n = H.front(ex, ez, 0.0)
        m = Matrix.Translation(H.c + p) @ frame_from(n)
        B.add(superq(ehx, 0.012, ehz, 1, 1, 14, 9), "eyes", hw, m @ Matrix.Translation((0, -0.0015, 0)))
        B.add(superq(ehx * 0.80, 0.008, ehz * 0.64, 1, 1, 12, 7), "eye_iris", hw,
              m @ Matrix.Translation((0, -0.0105, -ehz * 0.24)))
        B.add(superq(ehx * 0.42, 0.006, ehz * 0.36, 1, 1, 10, 6), "eyes", hw,
              m @ Matrix.Translation((0, -0.0135, -ehz * 0.20)))
        hx = -0.30 * ehx  # same side on both eyes: one consistent key light
        B.add(superq(ehx * 0.36, 0.005, ehx * 0.40, 1, 1, 10, 6), "eye_highlight", hw,
              m @ Matrix.Translation((hx, -0.0165, ehz * 0.38)))
        B.add(superq(ehx * 0.17, 0.004, ehx * 0.17, 1, 1, 8, 5), "eye_highlight", hw,
              m @ Matrix.Translation((-hx * 0.9, -0.0160, -ehz * 0.48)))
        # lash: arc over the top of the eye, thicker toward the outer corner
        pts, wd = [], []
        for i in range(9):
            a = math.radians(lerp(160, 20, i / 8)) if side > 0 else math.radians(lerp(20, 160, i / 8))
            lx = ex + math.cos(a) * ehx * 1.08
            lz = ez + math.sin(a) * ehz * 1.02
            pp, _ = H.front(lx, lz, 0.010)
            pts.append(H.c + pp)
            outer = i / 8
            wd.append(0.0028 + 0.0030 * outer)
        B.add(tube(pts, wd, [w * 0.8 for w in wd], 6), "eyes", hw)
        # brows in hair colour
        bpts = []
        for i in range(5):
            t = i / 4
            bx = ex + side * lerp(-0.85, 0.85, t) * ehx
            bz = ez + ehz + 0.050 * rz * 2 + 0.010 * math.sin(math.pi * t)
            pp, _ = H.front(bx, bz, 0.006)
            bpts.append(H.c + pp)
        B.add(tube(bpts, [0.0030, 0.0042, 0.0045, 0.0040, 0.0026], [0.0022] * 5, 6), "hair", hw)
        # cheek blush and ears
        p, n = H.front(side * 0.60 * rx, -0.46 * rz, -0.002)
        B.add(superq(0.030 * P.s, 0.004, 0.015 * P.s, 1, 1, 12, 6), "blush", hw,
              Matrix.Translation(H.c + p) @ frame_from(n))
        ep, en = H.on_dir(side * 92, -12, -0.004)
        B.add(superq(0.020 * P.s, 0.030 * P.s, 0.040 * P.s, 1, 1, 10, 8), "skin", hw,
              Matrix.Translation(H.c + ep) @ Matrix.Rotation(side * math.radians(12), 4, "Z"))
    # nose bump and a small smile
    p, n = H.front(0.0, -0.40 * rz, -0.004)
    B.add(superq(0.011 * P.s, 0.010 * P.s, 0.009 * P.s, 1, 1, 10, 6), "skin", hw, Matrix.Translation(H.c + p))
    mpts = []
    for i in range(7):
        t = i / 6
        mx = lerp(-0.075, 0.075, t) * rx
        mz = -0.585 * rz - 0.030 * rz * math.sin(math.pi * t)
        pp, _ = H.front(mx, mz, 0.002)
        mpts.append(H.c + pp)
    B.add(tube(mpts, [0.0030, 0.0042, 0.0048, 0.0050, 0.0048, 0.0042, 0.0030], [0.0024] * 7, 6), "mouth", hw)
    return H


# --------------------------------------------------------------------------
# hair styles: each returns a Builder with head weights
# --------------------------------------------------------------------------
def hair_lock(H: Head, B: Builder, a0, e0, a1, e1, w0, length_bulge=0.022, off0=0.012, off1=0.010,
              n=9, mat="hair", w_tip=0.003, thick=0.42, tip_out=0.0):
    pts, wd = [], []
    for i in range(n):
        t = i / (n - 1)
        az = lerp(a0, a1, t)
        el = lerp(e0, e1, t)
        off = lerp(off0, off1, t) + length_bulge * math.sin(math.pi * t) + tip_out * t * t
        p, _ = H.on_dir(az, el, off)
        pts.append(H.c + p)
        wd.append(lerp(w0, w_tip, t ** 1.3))
    B.add(tube(pts, wd, [w * thick for w in wd], 8, radial_center=H.c), mat, {"head": 1.0})


def hair_cap(H: Head, B: Builder, off, mask, mat="hair", shape=None, seg=32, rings=20, cut_ring=0):
    """Hair shell around the head.

    mask(x, y, z) on the unit direction returns 0..1; masked vertices sink just
    under the scalp so the hairline is a smooth slope instead of the stair-step
    edge that deleting whole faces produced. Fully masked faces are dropped.
    Rings below cut_ring are removed (open hem for longer styles); the returned
    function gives the points of any ring so a hem can follow it exactly.
    """
    def point(i, k):
        v = -math.pi / 2 + math.pi * i / rings
        u = TAU * k / seg
        d = Vector((math.cos(v) * math.cos(u), math.cos(v) * math.sin(u), math.sin(v)))
        m = mask(d.x, d.y, d.z)
        base = Vector((H.rx * d.x, H.ry * d.y, H.rz * d.z))
        n = Vector((base.x / H.rx ** 2, base.y / H.ry ** 2, base.z / H.rz ** 2)).normalized()
        o = off * (1 - m) - 0.008 * m
        p = base + n * o + Vector((0, off * 0.25, off * 0.35)) * (1 - m)
        p = shape(p) if shape else H.deform(p)
        return p, m
    rows, masks = [], []
    for i in range(max(1, cut_ring), rings):
        row, mrow = [], []
        for k in range(seg):
            p, m = point(i, k)
            row.append(p)
            mrow.append(m)
        rows.append(row)
        masks.append(mrow)
    top = Vector((0, off * 0.25, H.rz + off * 1.35))
    verts, faces, band = loft_rings(rows, None if cut_ring else Vector((0, 0, -H.rz + 0.01)), top)
    flat = [m for r in masks for m in r] + ([1.0] if not cut_ring else []) + [0.0]
    keep = [f for f in faces if not all(flat[i] > 0.97 for i in f)]
    used = sorted({i for f in keep for i in f})
    remap = {o: n for n, o in enumerate(used)}
    geom = ([verts[i] for i in used], [tuple(remap[i] for i in f) for f in keep], [0] * len(keep))
    B.add(geom, mat, {"head": 1.0}, Matrix.Translation(H.c))

    def ring(i):
        """Unmasked points of ring i as one arc, starting at the back of the head."""
        out = []
        for j in range(seg + 1):
            k = (seg // 4 + j) % seg  # u = 90 deg is the back (+Y)
            p, m = point(i, k)
            if m < 0.5:
                out.append(H.c + p)
        return out
    return ring


def short_mask(fringe_z=0.42, nape=-0.62, side=-0.05):
    """Hairline height varies smoothly from forehead to temple to nape, so the
    edge curves around the head instead of forming an L-shaped step."""
    def m(x, y, z):
        thr = lerp(nape, side, smoothstep(0.50, 0.28, y))
        thr = lerp(thr, fringe_z, smoothstep(-0.08, -0.62, y))
        return smoothstep(thr + 0.07, thr - 0.07, z)
    return m


def nape_locks(H, B, n=4, spread=45, w=0.032):
    for i in range(n):
        az = 180 + lerp(-spread, spread, i / (n - 1))
        hair_lock(H, B, az, -22, az + (az - 180) * 0.2, -46, w, 0.006, off0=0.014, off1=0.006)


def crown_locks(H, B, n=6, el0=84, el1=38, w=0.050, bulge=0.016, twist=-18, phase=0.0):
    """Locks radiating from the crown: breaks the helmet look and rounds the top."""
    for i in range(n):
        az = phase + 360.0 * i / n
        hair_lock(H, B, az, el0, az + twist, el1, w, bulge, off0=0.014, off1=0.016, w_tip=0.006)


def build_hair(style, P, H: Head, rng: random.Random):
    B = Builder("hair_" + style)
    if style == "short_tuft":
        hair_cap(H, B, 0.016, short_mask())
        crown_locks(H, B, 7, phase=10)
        for i, az in enumerate((-44, -24, -4, 16, 36)):
            hair_lock(H, B, az, 62, az + 6, 16 + rng.uniform(-3, 4), 0.040, 0.010, off1=0.006)
        for sd in (1, -1):
            hair_lock(H, B, sd * 70, 30, sd * 76, -8, 0.026, 0.010, w_tip=0.004)
            hair_lock(H, B, sd * 118, 30, sd * 126, -26, 0.040, 0.012)
        nape_locks(H, B)
        # signature crown tuft, curls forward
        r = H.rz
        pts = bezier([H.c + Vector((0, 0.03, r + 0.005)), H.c + Vector((0, 0.0, r + 0.085)),
                      H.c + Vector((0, -0.085, r + 0.10)), H.c + Vector((0, -0.07, r + 0.045))], 10)
        wd = [lerp(0.020, 0.003, (i / 10) ** 1.2) for i in range(11)]
        B.add(tube(pts, wd, [w * 0.5 for w in wd], 8), "hair", {"head": 1.0})
    elif style == "swept":
        hair_cap(H, B, 0.018, short_mask(0.45))
        for i, az in enumerate((-50, -30, -10, 10, 28)):
            hair_lock(H, B, az, 70, az - 34, 8 + i * 2.5, 0.050, 0.014, off1=0.007, w_tip=0.004)
        hair_lock(H, B, -48, 60, -78, -10, 0.046, 0.020)
        for az in (-10, 30, 70, 110, 150):
            hair_lock(H, B, az, 82, az - 40, 40, 0.060, 0.030, off0=0.018, off1=0.020)
        for sd in (1, -1):
            hair_lock(H, B, sd * 120, 35, sd * 126, -26, 0.042, 0.012)
        nape_locks(H, B)
    elif style == "side_part":
        hair_cap(H, B, 0.015, short_mask(0.48, -0.60))
        part = 32
        for i, az in enumerate((-40, -20, 0, 18)):
            hair_lock(H, B, part, 74, az - 6, 18 + i * 3, 0.048, 0.012, off1=0.007, n=10)
        for az in (52, 74):
            hair_lock(H, B, part + 6, 74, az + 14, 22, 0.042, 0.016)
        for sd in (1, -1):
            hair_lock(H, B, sd * 112, 40, sd * 118, -24, 0.038, 0.010)
        hair_lock(H, B, part - 10, 80, -60, 52, 0.060, 0.026)
        crown_locks(H, B, 5, el0=80, el1=30, phase=150, twist=10)
        nape_locks(H, B)
    elif style == "spiky_soft":
        hair_cap(H, B, 0.016, short_mask(0.40, -0.58))
        for i, az in enumerate((-46, -24, -2, 20, 42)):
            hair_lock(H, B, az, 60, az + rng.uniform(-6, 6), 12 + rng.uniform(-2, 5), 0.044, 0.012, off1=0.007)
        # (start az, start el, tip az, tip el, outward reach): tips flow up and
        # back on the crown and down at the sides so none read as horns
        spikes = [(0, 66, -8, 92, 0.050), (-42, 62, -56, 84, 0.050), (42, 62, 56, 84, 0.050),
                  (-92, 52, -108, 64, 0.042), (92, 52, 108, 64, 0.042), (-138, 48, -152, 54, 0.048),
                  (138, 48, 152, 54, 0.048), (180, 54, 180, 62, 0.050)]
        for a0, e0, a1, e1, reach in spikes:
            hair_lock(H, B, a0, e0 - 14, a1 + rng.uniform(-4, 4), e1, 0.068, 0.010,
                      off0=0.004, off1=0.020, tip_out=reach, thick=0.58, w_tip=0.009, n=8)
        for sd in (1, -1):
            hair_lock(H, B, sd * 116, 30, sd * 124, -22, 0.042, 0.012)
        nape_locks(H, B, 5, spread=50, w=0.036)
    elif style == "bob":
        cut = 6  # ring index of the hem (about 0.8 of the way down the head)

        def bob_mask(x, y, z):
            return (smoothstep(-0.12, -0.32, y) * smoothstep(0.46, 0.32, z) * smoothstep(0.88, 0.70, abs(x)))

        def bob_shape(p):
            zr = p.z / H.rz
            k = 1.0 + 0.08 * smoothstep(0.15, -0.45, zr) - 0.06 * smoothstep(-0.45, -0.80, zr)
            # A-line: the hem dips toward the front
            dip = 0.07 * H.rz * smoothstep(-0.35, -0.80, zr) * smoothstep(0.3, -0.7, p.y / H.ry)
            return Vector((p.x * k, p.y * k, p.z - dip))
        ring = hair_cap(H, B, 0.020, bob_mask, shape=bob_shape, cut_ring=cut)
        for az in range(-48, 49, 12):
            hair_lock(H, B, az, 64, az * 1.05, 10 + abs(az) * 0.05, 0.046, 0.012, off1=0.008, w_tip=0.020, thick=0.40)
        # rolled hem tucked slightly inside the open edge
        pts = ring(cut)
        pts = [H.c + (p - H.c) * Vector((0.975, 0.975, 1.0)) + Vector((0, 0, 0.004)) for p in pts]
        # the arc is split by the face window; draw each contiguous run separately
        runs, cur = [], [pts[0]]
        for a, b in zip(pts, pts[1:]):
            if (b - a).length > 0.08:
                runs.append(cur)
                cur = []
            cur.append(b)
        runs.append(cur)
        for r in runs:
            if len(r) >= 3:
                B.add(tube(r, [0.011] * len(r), [0.010] * len(r), 8), "hair", {"head": 1.0})
        crown_locks(H, B, 6, el0=70, el1=-30, w=0.055, bulge=0.010, twist=0, phase=120)
        for sd in (1, -1):
            hair_lock(H, B, sd * 58, 46, sd * 66, -52, 0.040, 0.016, off0=0.018, off1=0.012, w_tip=0.012)
    elif style == "bun":
        hair_cap(H, B, 0.016, short_mask(0.46, -0.55))
        for sd in (1, -1):
            hair_lock(H, B, sd * 6, 70, sd * 34, 4, 0.046, 0.014, off1=0.007, w_tip=0.006)
            hair_lock(H, B, sd * 40, 62, sd * 58, -30, 0.036, 0.012, off1=0.008, w_tip=0.005)
            hair_lock(H, B, sd * 110, 40, sd * 116, -22, 0.040, 0.010)
        crown_locks(H, B, 6, el0=60, el1=88, twist=0, phase=150, w=0.045, bulge=0.010)
        bp, bn = H.on_dir(180, 52, 0.05)
        B.add(superq(0.072 * P.s, 0.068 * P.s, 0.070 * P.s, 1, 1, 20, 12), "hair", {"head": 1.0},
              Matrix.Translation(H.c + bp))
        tp, tn = H.on_dir(180, 50, 0.017)
        m = Matrix.Translation(H.c + tp) @ frame_from(-bn) @ Matrix.Rotation(math.pi / 2, 4, "X")
        B.add(torus(0.042 * P.s, 0.011 * P.s, 16, 6), "prop_accent", {"head": 1.0}, m)
    elif style == "cap":
        hair_cap(H, B, 0.010, short_mask(0.30, -0.58, -0.20), seg=24, rings=16)
        for sd in (1, -1):
            hair_lock(H, B, sd * 74, 18, sd * 82, -20, 0.028, 0.008)
        for az in (-24, -4, 16):
            hair_lock(H, B, az, 30, az + 8, 18, 0.030, 0.008, w_tip=0.004)
        # six-panel crown, sand seams, long brim tipped down a little
        cz = 0.26
        v, f, band = superq(H.rx + 0.026, H.ry + 0.026, H.rz + 0.014, 1, 1, 28, 14)
        v = [Vector((p.x, p.y + 0.006, p.z + 0.010)) for p in v]
        B.add((v, f, band), "outfit_accent", {"head": 1.0}, Matrix.Translation(H.c),
              keep=lambda c: c.z / H.rz > cz)
        for i in range(6):
            a = TAU * i / 6 + math.pi / 6
            if math.sin(a) < -0.4:
                continue  # leave the front panel clean; seams there read as dots
            pts = []
            for j in range(9):
                el = lerp(80, 22, j / 8)
                d = Vector((math.cos(a) * math.cos(math.radians(el)), math.sin(a) * math.cos(math.radians(el)),
                            math.sin(math.radians(el))))
                t = 1.0 / math.sqrt((d.x / (H.rx + 0.026)) ** 2 + (d.y / (H.ry + 0.026)) ** 2 + (d.z / (H.rz + 0.014)) ** 2)
                pts.append(H.c + d * (t + 0.002) + Vector((0, 0.006, 0.010)))
            B.add(tube(pts, [0.0026] * 9, [0.0018] * 9, 5, cap=False), "prop_detail", {"head": 1.0})
        brim_c = H.c + Vector((0, -(H.ry + 0.085), cz * H.rz + 0.004))
        m = Matrix.Translation(brim_c) @ Matrix.Rotation(math.radians(13), 4, "X")
        B.add(superq(0.150 * P.s, 0.115 * P.s, 0.013, 0.3, 1.0, 24, 6), "outfit_accent", {"head": 1.0}, m,
              keep=lambda c: c.y < 0.035)
        B.add(superq(0.016, 0.016, 0.010, 1, 1, 10, 6), "prop_detail", {"head": 1.0},
              Matrix.Translation(H.c + Vector((0, 0.006, H.rz + 0.026))))
    else:
        raise ValueError(f"unknown hair style {style}")
    return B


# --------------------------------------------------------------------------
# body, outfit and props
# --------------------------------------------------------------------------
TOP = {
    # base torso top material, sleeve material, sleeve end (fraction of arm), cuff material, belt
    "blazer": ("outfit_inner", "outfit_main", 0.97, "outfit_inner", False),
    "cardigan": ("outfit_inner", "outfit_main", 0.95, "outfit_accent", True),
    "sweater": ("outfit_main", "outfit_main", 0.95, "outfit_accent", False),
    "jacket": ("outfit_inner", "outfit_main", 0.96, "outfit_main", True),
    "workvest": ("outfit_inner", "outfit_inner", 0.30, "outfit_inner", False),
    "apron": ("outfit_main", "outfit_main", 0.62, "outfit_main", True),
    "sweater_vest": ("outfit_inner", "outfit_inner", 0.97, "outfit_inner", True),
}


def build_body(B: Builder, P, spec, rng):
    top = spec["outfit"]["top"]
    base_mat, sleeve_mat, sleeve_end, cuff_mat, belt = TOP[top]
    tw = torso_weight(P)
    s = P.s
    # torso
    prof = torso_profile(P)
    geom = loft(prof, 28)

    def torso_mat(band, c):
        return "outfit_bottom" if c.z < P.belt_z else base_mat
    B.add(geom, torso_mat, tw)
    # neck
    nprof = [(P.shoulder_z - 0.03 * s, 0.046 * s, 0.042 * s), (P.chin + 0.01, 0.040 * s, 0.038 * s),
             (P.chin + 0.06 * s, 0.040 * s, 0.038 * s)]

    def neck_w(p):
        return blend2("neck", "head", smoothstep(P.chin - 0.005, P.chin + 0.03 * s, p.z))
    B.add(loft(nprof, 14), "skin", neck_w)
    if belt:
        bz = P.belt_z + 0.004
        rx, ry = torso_radius_at(P, bz, 0.006)
        B.add(loft([(bz - 0.016 * s, rx, ry), (bz + 0.016 * s, rx, ry)], 28, False, False), "shoes", {"hips": 1.0})
        B.add(superq(0.022 * s, 0.006, 0.017 * s, 0.4, 0.4, 10, 6), "outfit_accent", {"hips": 1.0},
              Matrix.Translation((0, -ry - 0.003, bz)))
    build_top(B, P, spec, top, tw)
    # arms
    for side in (1, -1):
        build_arm(B, P, side, sleeve_mat, sleeve_end, cuff_mat, top)
        build_leg(B, P, side, spec)


def shell(B, P, z0, z1, off, keep, mat, weight, seg=24, flare=0.0):
    prof = [row for row in torso_profile(P, off) if z0 - 1e-6 <= row[0] <= z1 + 1e-6]
    first = torso_radius_at(P, z0, off)
    if not prof or prof[0][0] > z0 + 1e-6:
        prof.insert(0, (z0, first[0] + flare, first[1] + flare * 0.7))
    else:
        prof[0] = (prof[0][0], prof[0][1] + flare, prof[0][2] + flare * 0.7)
    if prof[-1][0] < z1 - 1e-6:
        last = torso_radius_at(P, z1, off)
        prof.append((z1, last[0], last[1]))
    B.add(loft(prof, seg, False, False), mat, weight, keep=keep)
    return prof


def hem(B, P, prof_row, mat, weight, r=0.008, cut=None):
    z, rx, ry = prof_row
    pts = []
    for i in range(41):
        # start at the front centre so a front gap leaves one contiguous strip
        a = -math.pi / 2 + TAU * i / 40
        p = Vector((rx * math.cos(a), ry * math.sin(a), z))
        pts.append(p)
    if cut:
        pts = [p for p in pts if not cut(p)]
        # keep the open hem as one strip starting after the gap
        n = len(pts)
        if n < 4:
            return
    B.add(tube(pts, [r] * len(pts), [r] * len(pts), 6, cap=bool(cut)), mat, weight)


def build_top(B, P, spec, top, tw):
    s = P.s
    sh = P.shoulder_z
    if top == "blazer":
        zv = P.belt_z + 0.07 * s
        z0 = P.hip_z - 0.075 * s

        def keep(c):
            if c.y > 0:
                return True
            if c.z > zv:
                gap = 0.012 + (c.z - zv) / (sh - zv) * 0.050 * s
                return abs(c.x) > gap
            return True
        prof = shell(B, P, z0, sh + 0.016 * s, 0.012, keep, "outfit_main", tw, flare=0.030 * s)
        hem(B, P, prof[0], "outfit_main", tw, 0.008)
        # lapels: flat tapered strips along the V
        for side in (1, -1):
            pts = []
            for i in range(7):
                t = i / 6
                z = lerp(sh + 0.005, zv - 0.01, t)
                gap = 0.012 + (z - zv) / (sh - zv) * 0.050 * s
                rx, ry = torso_radius_at(P, z, 0.016)
                x = side * (gap + 0.010)
                y = -ry * math.sqrt(max(0.0, 1 - (x / rx) ** 2)) - 0.002
                pts.append(Vector((x, y, z)))
            wd = [lerp(0.020, 0.006, i / 6) * s for i in range(7)]
            B.add(tube(pts, wd, [0.004] * 7, 6), "outfit_main", tw)
        for bz in (P.belt_z + 0.03 * s, P.belt_z - 0.02 * s):
            rx, ry = torso_radius_at(P, bz, 0.014)
            B.add(superq(0.009 * s, 0.004, 0.009 * s, 1, 1, 8, 5), "prop_detail", tw,
                  Matrix.Translation((0.024 * s, -ry * math.sqrt(1 - (0.024 * s / rx) ** 2) - 0.003, bz)))
    elif top == "cardigan":
        z0 = P.hip_z - 0.02 * s

        def keep(c):
            return not (c.y < 0 and abs(c.x) < 0.020 * s + max(0.0, c.z - (sh - 0.12 * s)) * 0.45)
        prof = shell(B, P, z0, sh + 0.016 * s, 0.011, keep, "outfit_main", tw, flare=0.004)
        hem(B, P, prof[0], "outfit_accent", tw, 0.010, cut=lambda p: p.y < 0 and abs(p.x) < 0.020 * s)
        # knit placket along both opening edges hides the faceted cut of the shell
        for side in (1, -1):
            pts = []
            for i in range(12):
                z = lerp(z0 + 0.004, sh + 0.006, i / 11)
                gap = 0.020 * s + max(0.0, z - (sh - 0.12 * s)) * 0.45
                rx, ry = torso_radius_at(P, z, 0.013)
                x = side * (gap + 0.004)
                pts.append(Vector((x, -ry * math.sqrt(max(0.0, 1 - (x / rx) ** 2)) - 0.001, z)))
            B.add(tube(pts, [0.0075 * s] * 12, [0.0035] * 12, 6), "outfit_accent", tw)
        collar(B, P, "outfit_inner", tw)
    elif top == "sweater":
        # turtleneck roll and ribbed hem
        pts = []
        for i in range(25):
            a = TAU * i / 24
            pts.append(Vector((0.052 * s * math.cos(a), 0.048 * s * math.sin(a), sh + 0.020 * s)))
        B.add(tube(pts, [0.016 * s] * 25, [0.014 * s] * 25, 8, cap=False), "outfit_inner", {"chest": 0.5, "neck": 0.5})
        z = P.hip_z - 0.010 * s
        rx, ry = torso_radius_at(P, z, 0.008)
        B.add(loft([(z - 0.022 * s, rx, ry), (z + 0.022 * s, rx, ry)], 28, False, False), "outfit_accent", {"hips": 1.0})
        B.add(loft([(P.belt_z - 0.005, *torso_radius_at(P, P.belt_z, 0.009)),
                    (P.belt_z + 0.02 * s, *torso_radius_at(P, P.belt_z + 0.02 * s, 0.006))], 28, False, False),
              "outfit_main", {"hips": 1.0})
    elif top == "jacket":
        z0 = P.belt_z + 0.045 * s

        def keep(c):
            return not (c.y < 0 and abs(c.x) < 0.010 * s)
        prof = shell(B, P, z0, sh + 0.016 * s, 0.012, keep, "outfit_main", tw, flare=0.006)
        hem(B, P, prof[0], "outfit_main", tw, 0.011)
        # zip strip in accent colour on one front edge
        pts = []
        for i in range(8):
            z = lerp(z0, sh - 0.02 * s, i / 7)
            rx, ry = torso_radius_at(P, z, 0.014)
            pts.append(Vector((0.012 * s, -ry * math.sqrt(max(0, 1 - (0.012 * s / rx) ** 2)) - 0.001, z)))
        B.add(tube(pts, [0.004] * 8, [0.003] * 8, 6), "outfit_accent", tw)
        collar(B, P, "outfit_main", tw, high=True)
    elif top == "workvest":
        z0 = P.hip_z - 0.02 * s

        def keep(c):
            if c.y < 0 and abs(c.x) < 0.016 * s:
                return False
            return c.z < sh - 0.02 * s or abs(c.x) < 0.075 * s
        prof = shell(B, P, z0, sh + 0.010 * s, 0.014, keep, "outfit_main", tw)
        hem(B, P, prof[0], "outfit_main", tw, 0.010, cut=lambda p: p.y < 0 and abs(p.x) < 0.016 * s)
        for zb in (P.chest_z + 0.035 * s, P.belt_z + 0.075 * s):
            rx, ry = torso_radius_at(P, zb, 0.017)
            B.add(loft([(zb - 0.011 * s, rx, ry), (zb + 0.011 * s, rx, ry)], 24, False, False), "prop_detail", tw,
                  keep=lambda c: not (c.y < 0 and abs(c.x) < 0.018 * s))
        collar(B, P, "outfit_inner", tw)
    elif top == "apron":
        collar(B, P, "outfit_inner", tw)
    elif top == "sweater_vest":
        z0 = P.hip_z - 0.015 * s
        zv = P.chest_z + 0.01 * s

        def keep(c):
            if c.y < 0 and c.z > zv:
                gap = 0.012 + (c.z - zv) / (sh - zv) * 0.060 * s
                if abs(c.x) < gap:
                    return False
            return c.z < sh - 0.03 * s or abs(c.x) < 0.085 * s
        prof = shell(B, P, z0, sh + 0.012 * s, 0.012, keep, "outfit_main", tw)
        rx, ry = prof[0][1], prof[0][2]
        B.add(loft([(z0 - 0.004, rx + 0.004, ry + 0.004), (z0 + 0.03 * s, rx + 0.002, ry + 0.002)], 28, False, False),
              "outfit_main", {"hips": 1.0})
        # V trim in accent
        for side in (1, -1):
            pts = []
            for i in range(6):
                z = lerp(sh - 0.005, zv, i / 5)
                gap = 0.012 + (z - zv) / (sh - zv) * 0.060 * s
                rx2, ry2 = torso_radius_at(P, z, 0.014)
                x = side * gap
                pts.append(Vector((x, -ry2 * math.sqrt(max(0, 1 - (x / rx2) ** 2)) - 0.001, z)))
            B.add(tube(pts, [0.0045] * 6, [0.003] * 6, 6), "outfit_accent", tw)
        collar(B, P, "outfit_inner", tw, points=True)


def collar(B, P, mat, tw, high=False, points=False):
    s = P.s
    z = P.shoulder_z + (0.018 if high else 0.010) * s
    pts = []
    for i in range(25):
        a = TAU * i / 24
        pts.append(Vector((0.056 * s * math.cos(a), 0.050 * s * math.sin(a), z)))
    B.add(tube(pts, [0.010 * s] * 25, [0.008 * s] * 25, 6, cap=False), mat, {"chest": 0.6, "neck": 0.4})
    if points:
        for side in (1, -1):
            m = (Matrix.Translation((side * 0.030 * s, -0.050 * s, z - 0.012 * s))
                 @ Matrix.Rotation(side * math.radians(-30), 4, "Y") @ Matrix.Rotation(math.radians(-25), 4, "X"))
            B.add(superq(0.020 * s, 0.004, 0.024 * s, 0.6, 1.0, 10, 6), mat, {"chest": 1.0}, m)


def arm_frame(P, side):
    origin = Vector((side * P.sh_x, 0, P.sh_jz))
    rot = Matrix.Rotation(-side * P.apose, 4, "Y")
    direction = (rot @ Vector((0, 0, -1, 0))).to_3d().normalized()
    return origin, rot, direction


def build_arm(B, P, side, sleeve_mat, sleeve_end, cuff_mat, top):
    s, ls = P.s, P.ls
    origin, rot, direction = arm_frame(P, side)
    xf = Matrix.Translation(origin) @ rot
    L = P.Lu + P.Lf
    sfx = "_L" if side > 0 else "_R"
    w = limb_weight(origin, direction, P.Lu, L, "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx, 0.035 * s)

    def r_at(d):
        t = d / L
        return lerp(0.045, 0.032, t) * ls if t < 1 else 0.032 * ls
    ds = sleeve_end * L
    stations = sorted({-0.012, 0.03 * s, 0.08 * s, P.Lu * 0.7, P.Lu, P.Lu + P.Lf * 0.4, L - 0.01, L + 0.006, ds, ds + 0.003})
    prof = []
    for d in stations:
        r = r_at(d)
        if d <= ds + 1e-6 and sleeve_mat != "skin":
            r += 0.006 * s if top not in ("workvest",) else 0.009 * s
        prof.append((-d, r, r * 0.96))
    prof.reverse()
    geom = loft(prof, 16)

    def mat(band, c):
        return sleeve_mat if -c.z <= ds + 1e-4 else "skin"
    B.add(geom, mat, w, xf)
    # shoulder ball keeps the joint rounded when the arm lifts
    rs = r_at(0.0) + (0.006 * s if sleeve_mat != "skin" else 0.0)
    B.add(superq(rs, rs, rs, 1, 1, 16, 10), sleeve_mat,
          {"upper_arm" + sfx: 0.7, "chest": 0.3}, xf @ Matrix.Translation((0, 0, -0.004)))
    # elbow filler blends half/half so the crease does not collapse
    re = r_at(P.Lu) + (0.006 * s if P.Lu <= ds else 0)
    B.add(superq(re, re, re, 1, 1, 12, 8), sleeve_mat if P.Lu <= ds else "skin",
          {"upper_arm" + sfx: 0.5, "forearm" + sfx: 0.5}, xf @ Matrix.Translation((0, 0, -P.Lu)))
    # cuff ring at the sleeve end
    rc = r_at(ds) + 0.008 * s
    m = xf @ Matrix.Translation((0, 0, -ds))
    B.add(torus(rc, 0.0065 * s, 16, 6), cuff_mat, w, m)
    # mitten hand: palm faces the body, thumb points forward
    hm = xf @ Matrix.Translation((0, 0, -L - 0.004))
    hw = {"hand" + sfx: 1.0}
    B.add(superq(0.027 * ls, 0.037 * ls, 0.046 * ls, 1, 1, 14, 9), "skin", hw, hm @ Matrix.Translation((0, 0, -0.036 * ls)))
    B.add(superq(0.014 * ls, 0.014 * ls, 0.025 * ls, 1, 1, 10, 6), "skin", hw,
          hm @ Matrix.Translation((-side * 0.006 * ls, -0.032 * ls, -0.018 * ls)) @ Matrix.Rotation(math.radians(-35), 4, "X"))


def build_leg(B, P, side, spec):
    s, ls = P.s, P.lg
    sfx = "_L" if side > 0 else "_R"
    origin = Vector((side * P.hip_x, 0, P.hip_z))
    direction = Vector((0, 0, -1))
    L = P.L1 + P.L2
    w = limb_weight(origin, direction, P.L1, L, "thigh" + sfx, "shin" + sfx, "foot" + sfx, 0.04 * s)
    # upper thigh stays inside the pelvis width so it cannot poke through jacket hems
    stations = [(-0.045 * s, 0.045), (-0.02 * s, 0.060), (0.06 * s, 0.063), (P.L1 * 0.6, 0.061), (P.L1, 0.054),
                (P.L1 + P.L2 * 0.3, 0.056), (L - 0.03 * s, 0.049), (L, 0.051)]
    prof = [(-d, r * ls, r * ls * 1.02, 0, 0) for d, r in stations]
    prof.reverse()
    B.add(loft(prof, 16), "outfit_bottom", w, Matrix.Translation(origin))
    rk = 0.056 * ls
    B.add(superq(rk, rk, rk, 1, 1, 12, 8), "outfit_bottom", {"thigh" + sfx: 0.5, "shin" + sfx: 0.5},
          Matrix.Translation(origin + direction * P.L1))
    if spec["outfit"]["top"] == "sweater":
        # rolled trouser cuffs
        B.add(torus(0.054 * ls, 0.009 * s, 16, 6), "outfit_bottom", {"shin" + sfx: 1.0},
              Matrix.Translation(origin + direction * (L - 0.012 * s)))
    # chunky rounded shoe with a contrasting sole, rigid to the foot bone
    fw = {"foot" + sfx: 1.0}
    cx = side * P.hip_x
    a, b, c = 0.054 * ls, 0.094 * ls, 0.050 * s
    v, f, band = superq(a, b, c, 0.6, 0.75, 18, 10)
    v = [Vector((p.x * (1 + 0.12 * max(0, -p.y / b)), p.y, p.z * (1 + 0.15 * max(0, -p.y / b)) - 0.0)) for p in v]
    B.add((v, f, band), "shoes", fw, Matrix.Translation((cx, -0.030 * s, c + 0.010)))
    B.add(superq(a + 0.005, b + 0.006, 0.010, 0.4, 0.75, 18, 6), "shoe_sole", fw,
          Matrix.Translation((cx, -0.030 * s, 0.010)))


# ------------------------------- props -------------------------------------
def front_point(P, x, z, off):
    rx, ry = torso_radius_at(P, z, off)
    return Vector((x, -ry * math.sqrt(max(0.0, 1 - (x / rx) ** 2)), z))


def back_point(P, x, z, off):
    p = front_point(P, x, z, off)
    return Vector((p.x, -p.y, p.z))


def build_worn_props(B, P, H, spec, rng):
    s = P.s
    tw = torso_weight(P)
    shell_off = {"blazer": 0.012, "cardigan": 0.011, "jacket": 0.012, "workvest": 0.014,
                 "sweater_vest": 0.012}.get(spec["outfit"]["top"], 0.0)
    for prop in spec.get("props", []):
        if prop == "lanyard_badge":
            bz = P.chest_z - 0.035 * s
            for side in (1, -1):
                pts = [back_point(P, side * 0.035 * s, P.shoulder_z + 0.018 * s, 0.03),
                       Vector((side * 0.062 * s, 0.0, P.shoulder_z + 0.022 * s)),
                       front_point(P, side * 0.050 * s, P.shoulder_z - 0.01 * s, shell_off + 0.016),
                       front_point(P, side * 0.030 * s, P.chest_z + 0.04 * s, shell_off + 0.010),
                       front_point(P, side * 0.006, bz + 0.045 * s, shell_off + 0.010)]
                path = bezier(pts, 14)
                B.add(tube(path, [0.0055 * s] * 15, [0.0025] * 15, 6), "outfit_accent", tw)
            p = front_point(P, 0.0, bz, shell_off + 0.012)
            B.add(superq(0.040 * s, 0.004, 0.052 * s, 0.25, 0.4, 14, 8), "prop_main", tw, Matrix.Translation(p))
            B.add(superq(0.041 * s, 0.0045, 0.012 * s, 0.25, 0.4, 14, 6), "prop_detail", tw,
                  Matrix.Translation(p + Vector((0, -0.001, 0.036 * s))))
            B.add(superq(0.024 * s, 0.0045, 0.006 * s, 0.4, 0.4, 10, 5), "prop_detail", tw,
                  Matrix.Translation(p + Vector((0, -0.001, -0.012 * s))))
            B.add(superq(0.016 * s, 0.0045, 0.005 * s, 0.4, 0.4, 10, 5), "prop_detail", tw,
                  Matrix.Translation(p + Vector((0, -0.001, -0.026 * s))))
            B.add(superq(0.012 * s, 0.005, 0.008 * s, 0.4, 0.4, 10, 6), "prop_accent", tw,
                  Matrix.Translation(p + Vector((0, -0.002, -0.010 * s))))
        elif prop == "headset":
            hw = {"head": 1.0}
            pts = []
            for i in range(19):
                a = math.radians(lerp(8, 172, i / 18))
                pts.append(H.c + Vector(((H.rx + 0.046) * math.cos(a), 0.012, (H.rz + 0.050) * math.sin(a) - 0.01)))
            B.add(tube(pts, [0.011 * s] * 19, [0.006] * 19, 8), "prop_main", hw)
            for side in (1, -1):
                cp = H.c + Vector((side * (H.rx + 0.030), 0.012, -0.10 * H.rz))
                m = Matrix.Translation(cp) @ Matrix.Rotation(math.pi / 2, 4, "Y")
                B.add(superq(0.044 * s, 0.040 * s, 0.020, 0.5, 1.0, 16, 8), "prop_main", hw, m)
                B.add(superq(0.030 * s, 0.027 * s, 0.006, 0.5, 1.0, 14, 6), "prop_detail", hw,
                      Matrix.Translation(cp + Vector((side * 0.019, 0, 0)) @ Matrix()) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
            mp, _ = H.front(0.06 * H.rx, -0.62 * H.rz, 0.035)
            start = H.c + Vector(((H.rx + 0.040), -0.012, -0.12 * H.rz))
            path = bezier([start, H.c + Vector((H.rx + 0.03, -0.09, -0.40 * H.rz)), H.c + mp], 12)
            B.add(tube(path, [0.0045] * 13, [0.0045] * 13, 6), "prop_main", hw)
            B.add(superq(0.011, 0.012, 0.010, 1, 1, 10, 6), "prop_accent", hw, Matrix.Translation(H.c + mp))
        elif prop == "blueprint_tube":
            a = Vector((0.11 * s, 0, P.hip_z + 0.02 * s))
            b = Vector((-0.17 * s, 0, P.shoulder_z + 0.20 * s))
            ya = back_point(P, a.x, max(a.z, P.hip_z), 0.045).y
            yb = back_point(P, 0.0, P.shoulder_z - 0.05, 0.045).y
            a.y, b.y = ya, yb + 0.01
            axis = (b - a)
            L = axis.length
            m = Matrix.Translation(a) @ axis.to_track_quat("Z", "Y").to_matrix().to_4x4()
            r = 0.040 * s
            B.add(loft([(0, r, r), (L, r, r)], 18), "prop_main", {"chest": 1.0}, m)
            for z0 in (-0.008, L - 0.05 * s):
                B.add(loft([(z0, r + 0.004, r + 0.004), (z0 + 0.058 * s, r + 0.004, r + 0.004)], 18), "prop_accent",
                      {"chest": 1.0}, m)
            # strap crossing the chest from right shoulder to left hip
            pts = bezier([b + Vector((0.03, -0.02, -0.06)),
                          front_point(P, -0.09 * s, P.shoulder_z + 0.01, 0.03) + Vector((0, 0, 0.01)),
                          front_point(P, 0.03 * s, P.chest_z, 0.012),
                          front_point(P, 0.11 * s, P.belt_z + 0.03 * s, 0.012),
                          a + Vector((0.02, -0.03, 0.03))], 18)
            B.add(tube(pts, [0.011 * s] * 19, [0.0035] * 19, 6), "prop_accent", tw)
        elif prop == "ear_pencil":
            p, _ = H.on_dir(-96, 6, 0.012)
            m = Matrix.Translation(H.c + p) @ Matrix.Rotation(math.radians(70), 4, "X") @ Matrix.Rotation(math.radians(20), 4, "Y")
            B.add(loft([(-0.055 * s, 0.0008, 0.0008), (-0.045 * s, 0.0065, 0.0065), (0.045 * s, 0.0065, 0.0065),
                        (0.05 * s, 0.0065, 0.0065)], 6), "prop_detail", {"head": 1.0}, m)
            B.add(loft([(0.045 * s, 0.0068, 0.0068), (0.062 * s, 0.0066, 0.0066)], 6), "prop_accent", {"head": 1.0}, m)
        elif prop == "hair_clip":
            p, n = H.on_dir(48, 34, 0.034)
            m = Matrix.Translation(H.c + p) @ frame_from(n) @ Matrix.Rotation(math.radians(-30), 4, "Y")
            B.add(superq(0.030 * s, 0.006, 0.009 * s, 0.4, 0.6, 12, 6), "prop_detail", {"head": 1.0}, m)
        elif prop == "tool_belt":
            bz = P.hip_z + 0.02 * s
            rx, ry = torso_radius_at(P, bz, 0.016)
            B.add(loft([(bz - 0.022 * s, rx, ry), (bz + 0.022 * s, rx, ry)], 28, False, False), "prop_main", {"hips": 1.0})
            B.add(superq(0.024 * s, 0.008, 0.020 * s, 0.4, 0.4, 10, 6), "prop_detail", {"hips": 1.0},
                  Matrix.Translation((0, -ry - 0.004, bz)))
            for ang, size in ((-130, 1.0), (-160, 0.8), (150, 0.85)):
                a = math.radians(ang)
                px, py = (rx + 0.022 * s) * math.cos(a), (ry + 0.022 * s) * math.sin(a)
                m = Matrix.Translation((px, py, bz - 0.035 * s)) @ Matrix.Rotation(a + math.pi / 2, 4, "Z")
                B.add(superq(0.036 * s * size, 0.020 * s, 0.045 * s * size, 0.35, 0.35, 10, 6), "prop_main", {"hips": 1.0}, m)
                B.add(superq(0.037 * s * size, 0.021 * s, 0.012 * s, 0.35, 0.35, 12, 6), "prop_detail", {"hips": 1.0},
                      m @ Matrix.Translation((0, -0.001, 0.035 * s * size)))
            # screwdriver handle sticking out of the first pouch
            a = math.radians(-130)
            px, py = (rx + 0.022 * s) * math.cos(a), (ry + 0.022 * s) * math.sin(a)
            B.add(loft([(0, 0.008, 0.008), (0.05 * s, 0.009, 0.009), (0.055 * s, 0.006, 0.006)], 8), "outfit_accent",
                  {"hips": 1.0}, Matrix.Translation((px + 0.008, py, bz + 0.0)))
        elif prop == "cable_coil":
            bz = P.hip_z - 0.035 * s
            rx, _ = torso_radius_at(P, P.hip_z, 0.016)
            for i in range(3):
                m = (Matrix.Translation((rx + 0.030 * s + i * 0.008, 0.010 - i * 0.006, bz + i * 0.004))
                     @ Matrix.Rotation(math.pi / 2, 4, "Y") @ Matrix.Rotation(math.radians(8 * i), 4, "X"))
                B.add(torus(0.062 * s, 0.0105 * s, 20, 6), "prop_accent", {"hips": 1.0}, m)
            B.add(superq(0.016 * s, 0.024 * s, 0.020 * s, 0.4, 0.4, 10, 6), "prop_main", {"hips": 1.0},
                  Matrix.Translation((rx + 0.020 * s, 0.0, P.hip_z + 0.02 * s)))
        elif prop == "paint_apron":
            z0, z1 = P.hip_z - 0.085 * s, P.chest_z + 0.05 * s
            hx_top, hx_bot = 0.075 * s, 0.112 * s
            rx_hip, ry_hip = torso_radius_at(P, P.hip_z + 0.01 * s, 0.0)

            def apron_pt(u, v, lift=0.0):
                """u in [-1,1] across, v in [0,1] bottom to top; hangs straight below the hip."""
                z = lerp(z0, z1, v)
                hx = lerp(hx_bot, hx_top, smoothstep(0.35, 1.0, v))
                x = u * hx
                rx, ry = torso_radius_at(P, max(z, P.hip_z + 0.01 * s), 0.0)
                rx, ry = max(rx, rx_hip * (1.0 if z < P.hip_z else 0.0)), max(ry, ry_hip if z < P.hip_z else 0.0)
                off = 0.016 + lift + 0.012 * s * (1 - smoothstep(0.0, 0.35, v))
                y = -(ry + off) * math.sqrt(max(0.0, 1 - (x / (rx + off)) ** 2))
                return Vector((x, y, z))
            nu, nv = 10, 12
            verts = [apron_pt(-1 + 2 * i / nu, j / nv) for j in range(nv + 1) for i in range(nu + 1)]
            faces = [(j * (nu + 1) + i, j * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i)
                     for j in range(nv) for i in range(nu)]
            B.add((verts, faces, [0] * len(faces)), "outfit_accent", tw)
            hem_pts = [apron_pt(-1 + 2 * i / nu, 0.0, 0.0) for i in range(nu + 1)]
            B.add(tube(hem_pts, [0.005] * len(hem_pts), [0.005] * len(hem_pts), 6), "outfit_accent", {"hips": 1.0})
            for side in (1, -1):
                pts = bezier([apron_pt(side * 0.85, 1.0),
                              Vector((side * 0.06 * s, -0.05 * s, P.shoulder_z + 0.02 * s)),
                              Vector((side * 0.045 * s, 0.04 * s, P.shoulder_z + 0.03 * s)),
                              back_point(P, 0.0, P.shoulder_z - 0.01, 0.012)], 12)
                B.add(tube(pts, [0.0065 * s] * 13, [0.0028] * 13, 6), "outfit_accent", tw)
            rx, ry = torso_radius_at(P, P.belt_z + 0.03 * s, 0.016)
            B.add(loft([(P.belt_z + 0.02 * s, rx, ry), (P.belt_z + 0.034 * s, rx, ry)], 24, False, False),
                  "outfit_accent", {"hips": 0.5, "spine": 0.5})
            # pocket patch on the apron, then paint smudges (fixed seed so reruns match)
            pv = [apron_pt(lerp(-0.55, 0.15, i / 4), lerp(0.18, 0.36, j / 3), 0.004) for j in range(4) for i in range(5)]
            pf = [(j * 5 + i, j * 5 + i + 1, (j + 1) * 5 + i + 1, (j + 1) * 5 + i) for j in range(3) for i in range(4)]
            B.add((pv, pf, [0] * len(pf)), "outfit_main", {"hips": 1.0})
            for i, mat in enumerate(("prop_accent", "prop_main", "prop_detail", "prop_accent", "prop_detail", "prop_main")):
                u, v = rng.uniform(-0.75, 0.75), rng.uniform(0.40, 0.92)
                p = apron_pt(u, v, 0.002)
                n = Vector((p.x * 0.3, p.y, 0)).normalized()
                r = rng.uniform(0.013, 0.022) * s
                B.add(superq(r, 0.003, r * rng.uniform(0.55, 0.9), 1, 1, 10, 6), mat, tw,
                      Matrix.Translation(p) @ frame_from(n) @ Matrix.Rotation(rng.uniform(0, 3), 4, "Y"))
        elif prop == "glasses":
            hw = {"head": 1.0}
            ez = H.ez
            for side in (1, -1):
                ex = side * H.ex
                p, n = H.front(ex, ez, 0.022)
                m = Matrix.Translation(H.c + p) @ frame_from(n) @ Matrix.Rotation(math.pi / 2, 4, "X")
                B.add(torus(0.050 * P.s, 0.0035, 24, 6), "prop_detail", hw, m)
                tpts = bezier([H.c + H.front(side * H.ex + side * 0.050 * P.s, ez, 0.020)[0],
                               H.c + H.on_dir(side * 70, -6, 0.012)[0],
                               H.c + H.on_dir(side * 92, -8, 0.006)[0]], 8)
                B.add(tube(tpts, [0.0028] * 9, [0.0028] * 9, 6), "prop_detail", hw)
            bpts = bezier([H.c + H.front(H.ex - 0.050 * P.s, ez + 0.01, 0.022)[0],
                           H.c + H.front(0.0, ez + 0.02, 0.030)[0],
                           H.c + H.front(-H.ex + 0.050 * P.s, ez + 0.01, 0.022)[0]], 8)
            B.add(tube(bpts, [0.0028] * 9, [0.0028] * 9, 6), "prop_detail", hw)
        elif prop in ("tablet", "sketchbook", "clipboard"):
            continue  # separate toggleable nodes, see build_held_props
        else:
            raise ValueError(f"unknown prop {prop}")


def build_held_props(P, spec):
    """Hand-carried props are separate skinned nodes (prop_<id>) so runtime can hide them."""
    out = []
    s = P.s
    for prop in spec.get("props", []):
        if prop == "tablet":
            side = -1
            origin, rot, direction = arm_frame(P, side)
            hand_end = origin + direction * (P.Lu + P.Lf + 0.05 * s)
            B = Builder("prop_tablet")
            m = (Matrix.Translation(hand_end + Vector((side * 0.030 * s, -0.040 * s, 0.0))) @ Matrix.Rotation(-side * math.radians(50), 4, "Z")
                 @ rot @ Matrix.Rotation(math.radians(-12), 4, "X"))
            B.add(superq(0.007, 0.075 * s, 0.100 * s, 0.25, 0.25, 18, 10), "prop_main", {"hand_R": 1.0}, m)
            B.add(superq(0.003, 0.064 * s, 0.088 * s, 0.25, 0.25, 16, 6), "prop_accent", {"hand_R": 1.0},
                  m @ Matrix.Translation((side * 0.0055, 0, 0)))
            out.append(B)
        elif prop == "clipboard":
            side = 1
            origin, rot, direction = arm_frame(P, side)
            hand_end = origin + direction * (P.Lu + P.Lf + 0.05 * s)
            B = Builder("prop_clipboard")
            m = (Matrix.Translation(hand_end + Vector((side * 0.032 * s, -0.050 * s, 0.03 * s))) @ Matrix.Rotation(-side * math.radians(50), 4, "Z")
                 @ rot @ Matrix.Rotation(math.radians(-18), 4, "X"))
            B.add(superq(0.007, 0.085 * s, 0.115 * s, 0.25, 0.25, 18, 10), "prop_main", {"hand_L": 1.0}, m)
            B.add(superq(0.003, 0.072 * s, 0.095 * s, 0.25, 0.25, 16, 6), "prop_accent", {"hand_L": 1.0},
                  m @ Matrix.Translation((side * 0.0055, 0, -0.008 * s)))
            B.add(superq(0.010, 0.030 * s, 0.012 * s, 0.4, 0.4, 12, 6), "prop_detail", {"hand_L": 1.0},
                  m @ Matrix.Translation((side * 0.004, 0, 0.105 * s)))
            out.append(B)
        elif prop == "sketchbook":
            side = 1
            origin, rot, direction = arm_frame(P, side)
            B = Builder("prop_sketchbook")
            c = origin + direction * (P.Lu * 0.55) + Vector((-0.043 * P.ls, 0.0, 0.0))
            m = Matrix.Translation(c) @ rot @ Matrix.Rotation(math.radians(80), 4, "X")
            B.add(superq(0.011, 0.090 * s, 0.120 * s, 0.25, 0.25, 18, 8), "prop_main", {"upper_arm_L": 1.0}, m)
            B.add(superq(0.0125, 0.086 * s, 0.006, 0.25, 0.4, 16, 6), "prop_accent", {"upper_arm_L": 1.0},
                  m @ Matrix.Translation((0, 0, 0.105 * s)))
            out.append(B)
    return out


# --------------------------------------------------------------------------
# armature
# --------------------------------------------------------------------------
BONES = ["root", "hips", "spine", "chest", "neck", "head",
         "upper_arm_L", "forearm_L", "hand_L", "upper_arm_R", "forearm_R", "hand_R",
         "thigh_L", "shin_L", "foot_L", "thigh_R", "shin_R", "foot_R"]


def make_armature(P):
    s = P.s
    data = bpy.data.armatures.new("rig")
    arm = bpy.data.objects.new("rig", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = data.edit_bones

    def bone(name, head, tail, parent=None, connect=False):
        b = eb.new(name)
        b.head, b.tail = Vector(head), Vector(tail)
        b.roll = 0.0
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        return b
    bone("root", (0, 0, 0), (0, 0.18 * s, 0))
    bone("hips", (0, 0, P.hip_z), (0, 0, P.spine_z), "root")
    bone("spine", (0, 0, P.spine_z), (0, 0, P.chest_z), "hips", True)
    bone("chest", (0, 0, P.chest_z), (0, 0, P.neck_z), "spine", True)
    bone("neck", (0, 0, P.neck_z), (0, 0, P.headb_z), "chest", True)
    bone("head", (0, 0, P.headb_z), (0, 0, P.skull_top), "neck", True)
    for side in (1, -1):
        sfx = "_L" if side > 0 else "_R"
        o, rot, d = arm_frame(P, side)
        e = o + d * P.Lu
        w = e + d * P.Lf
        h = w + d * P.Lh
        bone("upper_arm" + sfx, o, e, "chest")
        bone("forearm" + sfx, e, w, "upper_arm" + sfx, True)
        bone("hand" + sfx, w, h, "forearm" + sfx, True)
        hx = side * P.hip_x
        bone("thigh" + sfx, (hx, 0, P.hip_z), (hx, 0, P.hip_z - P.L1), "hips")
        bone("shin" + sfx, (hx, 0, P.hip_z - P.L1), (hx, 0, P.ankle_z), "thigh" + sfx, True)
        bone("foot" + sfx, (hx, 0, P.ankle_z), (hx, P.toe_y, 0.022 * s), "shin" + sfx, True)
    bpy.ops.object.mode_set(mode="OBJECT")
    data.bones["root"].use_deform = False
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


# --------------------------------------------------------------------------
# materials and objects
# --------------------------------------------------------------------------
def make_materials(spec):
    oc = spec["outfit"]["colors"]
    pc = spec.get("propColors", {})
    colors = {
        "skin": spec["skin"],
        "eyes": "#2B1F1D",
        "eye_iris": spec["eyes"]["iris"],
        "eye_highlight": "#FFFCF4",
        "mouth": "#7A3A2E",
        "blush": mix_hex(spec["skin"], "#E0705E", 0.45),
        "hair": spec["hair"]["color"],
    }
    colors.update(oc)
    colors.update(pc)
    mats = {}
    for name in sorted(colors):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        rgba = hex_rgba(colors[name])
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.8 if name not in ("eyes", "eye_iris", "eye_highlight") else 0.45
        bsdf.inputs["Metallic"].default_value = 0.0
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.35
        m.diffuse_color = rgba
        m["hex"] = colors[name]
        mats[name] = m
    return mats, colors


def make_object(B: Builder, mats, arm):
    me = bpy.data.meshes.new(B.name)
    me.from_pydata([tuple(v) for v in B.verts], [], B.faces)
    me.validate(clean_customdata=False)
    used = []
    for n in B.mats:
        if n not in used:
            used.append(n)
    for n in used:
        me.materials.append(mats[n])
    idx = {n: i for i, n in enumerate(used)}
    me.polygons.foreach_set("material_index", [idx[n] for n in B.mats])
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.update()
    ob = bpy.data.objects.new(B.name, me)
    bpy.context.scene.collection.objects.link(ob)
    groups = {}
    for i, w in enumerate(B.weights):
        tot = sum(w.values())
        for bone, val in w.items():
            if val <= 0:
                continue
            if bone not in groups:
                groups[bone] = ob.vertex_groups.new(name=bone)
            groups[bone].add([i], val / tot, "REPLACE")
    ob.parent = arm
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    return ob


# --------------------------------------------------------------------------
# animation
# --------------------------------------------------------------------------
AX = {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}


def qrot(rots):
    q = Quaternion()
    for ax, deg in rots:
        q = q @ Quaternion(AX[ax], math.radians(deg))
    return q


def ab(side, deg):
    """Abduction (arm away from body) for side +1 (L) / -1 (R)."""
    return ("Y", -deg if side > 0 else deg)


def leg_ik(fwd, down, L1, L2):
    d = math.hypot(fwd, down)
    d = min(d, (L1 + L2) * 0.9995)
    phi = math.atan2(fwd, down)
    cg = max(-1.0, min(1.0, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)))
    ck = max(-1.0, min(1.0, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2)))
    alpha = phi + math.acos(cg)
    beta = math.pi - math.acos(ck)
    return math.degrees(alpha), math.degrees(beta)


class Anim:
    def __init__(self, P):
        self.P = P

    # standing base with breathing, used by most upper-body actions
    def stand(self, t, breathe=1.0):
        b = math.sin(TAU * t / 2.0) * breathe
        pose = {
            "spine": [("X", 0.8 * b)],
            "chest": [("X", -1.2 * b)],
            "neck": [("X", 0.5 * b)],
            "head": [("Y", 1.2 * math.sin(TAU * t / 4.0))],
            "_hips": (0.004 * math.sin(TAU * t / 4.0), 0, 0.003 * b),
        }
        for side, sfx in ((1, "_L"), (-1, "_R")):
            pose["upper_arm" + sfx] = [ab(side, -2.0 + 1.0 * b), ("X", 2.0)]
            pose["forearm" + sfx] = [("X", -8.0 - 1.5 * b)]
            pose["hand" + sfx] = [("X", -4.0)]
        return pose

    def seated(self, t, swing=True):
        P = self.P
        pose = self.stand(t, 0.8)
        seat = self.P.seat
        # pelvis underside (torso pole at hip - 0.096 s) rests 8 mm into the cushion
        dz = (seat + 0.096 * P.s - 0.008) - P.hip_z
        pose["_hips"] = (0, 0, dz)
        for side, sfx in ((1, "_L"), (-1, "_R")):
            ph = 0 if side > 0 else math.pi
            sw = 7.0 * math.sin(TAU * t / 2.0 + ph) if swing else 0.0
            pose["thigh" + sfx] = [("X", -88.0), ab(side, 3.0)]
            pose["shin" + sfx] = [("X", 78.0 + sw)]
            pose["foot" + sfx] = [("X", 12.0)]
            pose["upper_arm" + sfx] = [("X", -22.0), ab(side, -4.0)]
            pose["forearm" + sfx] = [("X", -48.0)]
            pose["hand" + sfx] = [("X", 6.0)]
        pose["spine"] = [("X", -3.0 + pose["spine"][0][1])]
        return pose

    def foot_contacts(self):
        """Sole contact points relative to the ankle as (forward, up), from the shoe shape."""
        P = self.P
        heel = (-(0.094 * P.lg - 0.030 * P.s) * 0.80, -P.ankle_z)
        ball = ((0.030 * P.s + 0.094 * P.lg * 0.80), -P.ankle_z)
        return heel, ball

    @staticmethod
    def ankle_from_contact(ground_fwd, c, tau_deg):
        """Ankle (forward, up) that keeps contact point c on the floor at ground_fwd
        while the foot is pitched toe-down by tau (negative = toe up)."""
        t = math.radians(tau_deg)
        rf = c[0] * math.cos(t) + c[1] * math.sin(t)
        ru = -c[0] * math.sin(t) + c[1] * math.cos(t)
        return ground_fwd - rf, -ru

    def stance_ankle(self, s, D, heel_tau=-12.0, toe_tau=38.0, heel_end=0.12, toe_on=0.78):
        P = self.P
        heel, ball = self.foot_contacts()
        g = D / 2 - D * s
        if s < heel_end:
            tau = lerp(heel_tau, 0.0, smoothstep(0, heel_end, s))
            f, u = self.ankle_from_contact(g + heel[0], heel, tau)
        elif s < toe_on:
            tau, f, u = 0.0, g, P.ankle_z
        else:
            tau = toe_tau * smoothstep(toe_on, 1.0, s)
            f, u = self.ankle_from_contact(g + ball[0], ball, tau)
        return f, u, tau

    def gait(self, t, T, stance, D, drop, bob, lift, lean, arm_amp, fore_base, run=False):
        P = self.P
        hipz = P.hip_z - drop - bob * math.cos(TAU * 2 * t / T)
        pose = {"_hips": (0.010 * math.sin(TAU * t / T) * (0.5 if run else 1.0), 0, hipz - P.hip_z)}
        f_end, u_end, tau_end = self.stance_ankle(1.0, D)
        f_start, u_start, tau_start = self.stance_ankle(0.0, D)
        for side, sfx, ph in ((1, "_L", 0.0), (-1, "_R", 0.5)):
            u = (t / T + ph) % 1.0
            if u < stance:
                a_fwd, a_z, tau = self.stance_ankle(u / stance, D)
            else:
                k = (u - stance) / (1 - stance)
                a_fwd = lerp(f_end, f_start, smoothstep(0, 1, k))
                a_z = lerp(u_end, u_start, k) + lift * math.sin(math.pi * min(1.0, k * 1.1))
                tau = lerp(tau_end, tau_start, smoothstep(0.0, 0.8, k))
            alpha, beta = leg_ik(a_fwd, hipz - a_z, P.L1, P.L2)
            pose["thigh" + sfx] = [("X", -alpha)]
            pose["shin" + sfx] = [("X", beta)]
            pose["foot" + sfx] = [("X", alpha - beta + tau)]
            arm_ph = math.cos(TAU * (t / T + ph))
            pose["upper_arm" + sfx] = [ab(side, 4.0 if run else 1.0), ("X", arm_amp * arm_ph)]
            pose["forearm" + sfx] = [("X", -fore_base - 10.0 * max(0.0, -arm_ph))]
            pose["hand" + sfx] = [("X", -6.0)]
        # torso twist lives above the pelvis: yawing the hips would swing the
        # planted foot and reintroduce slip
        twist = 6.0 * math.cos(TAU * t / T)
        pose["spine"] = [("X", lean * 0.5), ("Z", twist * 0.5)]
        pose["chest"] = [("X", lean * 0.5), ("Z", twist * 0.7)]
        pose["neck"] = [("X", -lean * 0.5), ("Z", -twist * 0.6)]
        pose["head"] = [("X", -lean * 0.3 + 1.5 * math.cos(TAU * 2 * t / T))]
        return pose

    def solve_stride(self, stance, drop, bob):
        """Largest stance travel whose ankle targets stay reachable (no foot float)."""
        P = self.P
        reach = (P.L1 + P.L2) * 0.985
        hip_low = P.hip_z - drop - bob
        down = hip_low - P.ankle_z
        half = math.sqrt(max(0.0, reach * reach - down * down))
        return 2 * half

    # ---- actions -------------------------------------------------------------
    def idle(self, t):
        pose = self.stand(t)
        pose["head"] = [("Y", 2.0 * math.sin(TAU * t / 2.0)), ("X", -1.0)]
        pose["_hips"] = (0.006 * math.sin(TAU * t / 2.0), 0, 0.003 * math.sin(TAU * t))
        return pose

    def walk(self, t):
        return self.gait(t, 1.0, WALK_STANCE, self.walk_D, self.walk_drop, 0.012, 0.075, 5.0, 22.0, 14.0)

    def run(self, t):
        return self.gait(t, 0.6, RUN_STANCE, self.run_D, self.run_drop, 0.018, 0.13, 13.0, 38.0, 75.0, run=True)

    def wave(self, t):
        T = 1.6
        pose = self.stand(t, 0.6)
        up = smoothstep(0.0, 0.32, t) * (1 - smoothstep(T - 0.32, T, t))
        w = math.sin(TAU * (t - 0.32) / 0.42) if 0.32 < t < T - 0.32 else 0.0
        pose["upper_arm_R"] = [ab(-1, 128.0 * up), ("X", -14.0 * up)]
        pose["forearm_R"] = [("Y", (18.0 + 26.0 * w) * up), ("X", -14.0 * up)]
        pose["hand_R"] = [("Y", 10.0 * w * up)]
        pose["chest"] = [("Y", 4.0 * up), ("Z", -4.0 * up)]
        pose["head"] = [("Y", -6.0 * up), ("X", -2.0 * up)]
        return pose

    def talk(self, t):
        T = 2.4
        pose = self.stand(t, 0.8)
        nod = math.sin(TAU * t / (T / 2.0))
        pose["head"] = [("X", 5.0 * nod), ("Y", 3.0 * math.sin(TAU * t / T))]
        pose["neck"] = [("X", 2.0 * nod)]
        g = 0.5 - 0.5 * math.cos(TAU * t / T)
        pose["upper_arm_R"] = [ab(-1, 10.0 + 6.0 * g), ("X", -22.0 - 12.0 * g)]
        pose["forearm_R"] = [("X", -62.0 - 18.0 * math.sin(TAU * t / (T / 2.0))), ("Z", -20.0 * g)]
        pose["hand_R"] = [("Z", -25.0), ("X", -10.0 * g)]
        pose["chest"] = [("Z", -4.0 * g), ("X", -1.0)]
        return pose

    def sit(self, t):
        pose = self.seated(t)
        pose["head"] = [("Y", 3.0 * math.sin(TAU * t / 2.0)), ("X", 2.0)]
        return pose

    def type(self, t):
        pose = self.seated(t, swing=False)
        for side, sfx in ((1, "_L"), (-1, "_R")):
            ph = 0.0 if side > 0 else 0.5
            tap = math.sin(TAU * (4 * t + ph))
            pose["upper_arm" + sfx] = [ab(side, 6.0), ("X", -38.0 + 1.5 * tap)]
            pose["forearm" + sfx] = [("X", -52.0 - 2.0 * tap), ("Z", side * 8.0)]
            pose["hand" + sfx] = [("X", 14.0 + 8.0 * max(0.0, tap))]
        pose["spine"] = [("X", 4.0)]
        pose["chest"] = [("X", 3.0)]
        pose["head"] = [("X", 6.0 + 1.5 * math.sin(TAU * t)), ("Y", 2.0 * math.sin(TAU * t))]
        return pose

    def read(self, t):
        T = 2.4
        pose = self.stand(t, 0.7)
        for side, sfx in ((1, "_L"), (-1, "_R")):
            pose["upper_arm" + sfx] = [ab(side, -12.0), ("X", -26.0)]
            pose["forearm" + sfx] = [("X", -78.0), ("Z", -side * 10.0)]
            pose["hand" + sfx] = [("Z", side * 20.0), ("X", 8.0)]
        flip = smoothstep(1.4, 1.7, t) * (1 - smoothstep(1.9, 2.2, t))
        pose["forearm_R"] = [("X", -78.0 - 10.0 * flip), ("Z", 10.0 - 22.0 * flip)]
        pose["head"] = [("X", 14.0), ("Y", 3.0 * math.sin(TAU * t / T))]
        pose["neck"] = [("X", 4.0)]
        return pose

    def coffee(self, t):
        T = 3.0
        pose = self.stand(t, 0.8)
        sip = smoothstep(0.8, 1.25, t) * (1 - smoothstep(1.9, 2.35, t))
        pose["upper_arm_R"] = [ab(-1, -6.0 + 4.0 * sip), ("X", -18.0 - 22.0 * sip)]
        pose["forearm_R"] = [("X", -92.0 - 40.0 * sip), ("Z", 15.0)]
        pose["hand_R"] = [("Z", -30.0), ("X", 10.0 * sip)]
        pose["upper_arm_L"] = [ab(1, -8.0), ("X", -14.0)]
        pose["forearm_L"] = [("X", -72.0), ("Z", -12.0)]
        pose["hand_L"] = [("Z", 20.0)]
        pose["head"] = [("X", -8.0 * sip + 2.0 * (1 - sip)), ("Y", 2.0 * math.sin(TAU * t / T))]
        return pose

    def stretch(self, t):
        T = 3.0
        pose = self.stand(t, 0.4)
        up = smoothstep(0.1, 0.8, t) * (1 - smoothstep(2.5, 2.95, t))
        lean = math.sin(TAU * (t - 0.8) / 1.7) if 0.8 < t < 2.5 else 0.0
        for side, sfx in ((1, "_L"), (-1, "_R")):
            pose["upper_arm" + sfx] = [ab(side, 158.0 * up), ("X", -8.0 * up)]
            pose["forearm" + sfx] = [ab(side, -30.0 * up)]
            pose["hand" + sfx] = [ab(side, -20.0 * up)]
        pose["spine"] = [("X", -5.0 * up), ("Y", 8.0 * lean * up)]
        pose["chest"] = [("X", -6.0 * up), ("Y", 8.0 * lean * up)]
        pose["head"] = [("X", -10.0 * up)]
        tau = 10.0 * up
        _, ball = self.foot_contacts()
        _, ank_up = self.ankle_from_contact(0.0, ball, tau)
        pose["_hips"] = (0, 0, ank_up - self.P.ankle_z)
        for side, sfx in ((1, "_L"), (-1, "_R")):
            pose["foot" + sfx] = [("X", tau)]
        return pose

    def exercise(self, t):
        T = 0.8
        P = self.P
        bounce = 0.022 * abs(math.sin(TAU * t / T))
        hipz = P.hip_z - 0.02 + bounce
        pose = {"_hips": (0, 0, hipz - P.hip_z)}
        for side, sfx, ph in ((1, "_L", 0.0), (-1, "_R", 0.5)):
            u = (t / T + ph) % 1.0
            k = max(0.0, math.sin(TAU * u))
            a_fwd = 0.06 * k
            a_z = P.ankle_z + 0.17 * P.s * k
            alpha, beta = leg_ik(a_fwd, hipz - a_z, P.L1, P.L2)
            pose["thigh" + sfx] = [("X", -alpha)]
            pose["shin" + sfx] = [("X", beta)]
            pose["foot" + sfx] = [("X", alpha - beta + 18.0 * k)]
            sw = math.sin(TAU * (u + 0.0))
            pose["upper_arm" + sfx] = [ab(side, 6.0), ("X", 30.0 * sw)]
            pose["forearm" + sfx] = [("X", -85.0)]
        pose["spine"] = [("X", 3.0)]
        pose["head"] = [("X", -2.0 + 2.0 * math.sin(TAU * 2 * t / T))]
        return pose

    def billiards(self, t):
        T = 2.4
        pose = self.stand(t, 0.4)
        pose["hips"] = [("X", 10.0)]
        pose["spine"] = [("X", 26.0)]
        pose["chest"] = [("X", 18.0)]
        pose["neck"] = [("X", -18.0)]
        pose["head"] = [("X", -20.0)]
        # staggered stance solved with the leg IK so both soles stay on the floor
        P = self.P
        drop = 0.035 * P.s
        hipz = P.hip_z - drop
        pitch = 10.0
        for sfx, fwd in (("_L", 0.16 * P.s), ("_R", -0.10 * P.s)):
            alpha, beta = leg_ik(fwd, hipz - P.ankle_z, P.L1, P.L2)
            pose["thigh" + sfx] = [("X", -alpha - pitch)]
            pose["shin" + sfx] = [("X", beta)]
            pose["foot" + sfx] = [("X", alpha - beta)]
        pose["_hips"] = (0, 0.0, -drop)
        pose["upper_arm_L"] = [ab(1, -6.0), ("X", -66.0)]
        pose["forearm_L"] = [("X", -8.0)]
        pose["hand_L"] = [("X", 30.0)]
        # cue arm: two slow practice strokes then a quick strike
        if t < 1.4:
            st = math.sin(TAU * t / 0.7)
        else:
            k = (t - 1.4) / 1.0
            st = -1.0 + 2.0 * smoothstep(0.0, 0.12, k) - smoothstep(0.5, 1.0, k)
        pose["upper_arm_R"] = [ab(-1, 8.0), ("X", 40.0)]
        pose["forearm_R"] = [("X", -82.0 + 26.0 * st)]
        pose["hand_R"] = [("X", -10.0)]
        return pose

    def game(self, t):
        T = 1.6
        pose = self.seated(t, swing=False)
        tilt = math.sin(TAU * t / T)
        for side, sfx in ((1, "_L"), (-1, "_R")):
            j = math.sin(TAU * (6 * t / T) + (0 if side > 0 else 1.3))
            pose["upper_arm" + sfx] = [ab(side, -14.0), ("X", -30.0)]
            pose["forearm" + sfx] = [("X", -66.0), ("Z", -side * 26.0)]
            pose["hand" + sfx] = [("X", 4.0 * j), ("Z", side * 10.0)]
        pose["chest"] = [("Y", 6.0 * tilt), ("X", 6.0)]
        pose["head"] = [("Y", -3.0 * tilt), ("X", 6.0 + 2.0 * math.sin(TAU * 2 * t / T))]
        return pose


WALK_STANCE, RUN_STANCE = 0.58, 0.38
ACTION_ORDER = ["idle", "walk", "run", "wave", "talk", "sit", "type", "read", "coffee", "stretch", "exercise", "billiards", "game"]


def bake_actions(arm, P, anim_spec, fps):
    A = Anim(P)
    # deeper knee bend in the walk buys stride length for the short legs
    A.walk_drop = 0.058 * P.s
    A.run_drop = 0.070 * P.s
    A.walk_D = A.solve_stride(WALK_STANCE, A.walk_drop, 0.012)
    A.run_D = A.solve_stride(RUN_STANCE, A.run_drop, 0.018)
    rest = {b.name: b.matrix_local.to_quaternion() for b in arm.data.bones}
    rest_inv = {k: q.inverted() for k, q in rest.items()}
    ad = arm.animation_data_create()
    made = []
    for name in ACTION_ORDER:
        spec = anim_spec[name]
        n = int(round(spec["durationS"] * fps))
        fn = getattr(A, name)
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        act.use_frame_range = True
        act.frame_start, act.frame_end = 0, n
        act.use_cyclic = bool(spec["loop"])
        act.id_root = "OBJECT"
        series = {b: [] for b in BONES if b != "root"}
        hips_loc = []
        for f in range(n + 1):
            t = f / fps
            if spec["loop"] and f == n:
                t = 0.0  # exact seam for looping clips
            pose = fn(t)
            for b in series:
                qw = qrot(pose.get(b, []))
                ql = rest_inv[b] @ qw @ rest[b]
                if series[b] and series[b][-1].dot(ql) < 0:
                    ql = -ql
                series[b].append(ql)
            off = Vector(pose.get("_hips", (0, 0, 0)))
            hips_loc.append(rest_inv["hips"] @ off)
        frames = list(range(n + 1))
        for b, qs in series.items():
            for i in range(4):
                fc = act.fcurves.new(f'pose.bones["{b}"].rotation_quaternion', index=i, action_group=b)
                fc.keyframe_points.add(len(frames))
                co = []
                for fr, q in zip(frames, qs):
                    co += [fr, q[i]]
                fc.keyframe_points.foreach_set("co", co)
                fc.keyframe_points.foreach_set("interpolation", [1] * len(frames))  # LINEAR
                fc.update()
        for i in range(3):
            fc = act.fcurves.new('pose.bones["hips"].location', index=i, action_group="hips")
            fc.keyframe_points.add(len(frames))
            co = []
            for fr, v in zip(frames, hips_loc):
                co += [fr, v[i]]
            fc.keyframe_points.foreach_set("co", co)
            fc.keyframe_points.foreach_set("interpolation", [1] * len(frames))
            fc.update()
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, act)
        strip.name = name
        track.mute = True
        made.append(act)
    ad.action = None
    stance_walk, stance_run = WALK_STANCE, RUN_STANCE
    loco = {
        "walk_native_speed_mps": round(A.walk_D / (stance_walk * 1.0), 3),
        "run_native_speed_mps": round(A.run_D / (stance_run * 0.6), 3),
        "walk_stance_travel_m": round(A.walk_D, 3),
        "run_stance_travel_m": round(A.run_D, 3),
    }
    return made, loco


# --------------------------------------------------------------------------
# main build
# --------------------------------------------------------------------------
def reset_scene(fps):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = fps
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0
    sc.frame_start, sc.frame_end = 0, 60


def build_character(cid, spec, data, variants_spec):
    t0 = time.time()
    fps = data["rig"]["fps"]
    reset_scene(fps)
    rng = random.Random(f"kantor-rpg:{cid}")
    P = proportions(spec)
    P.seat = data["rig"]["seatHeightM"]
    arm = make_armature(P)
    mats, colors = make_materials(spec)
    body = Builder("body")
    H = build_head(body, P, spec, colors)
    build_body(body, P, spec, rng)
    build_worn_props(body, P, H, spec, rng)
    objs = {"body": make_object(body, mats, arm)}
    tri = {"body": body.tri_count()}
    default_hair = spec["hair"]["style"]
    hair_styles = [default_hair]
    if variants_spec:
        hair_styles = list(variants_spec["hairStyles"])
        default_hair = variants_spec["defaultHair"]
    for style in hair_styles:
        hb = build_hair(style, P, H, random.Random(f"kantor-rpg:{cid}:{style}"))
        objs[hb.name] = make_object(hb, mats, arm)
        tri[hb.name] = hb.tri_count()
        if style != default_hair:
            objs[hb.name].hide_render = True
    for pb in build_held_props(P, spec):
        objs[pb.name] = make_object(pb, mats, arm)
        tri[pb.name] = pb.tri_count()
    actions, loco = bake_actions(arm, P, data["animations"], fps)
    # glTF extras so runtime can read defaults without the JSON
    arm["kantor_id"] = cid
    arm["kantor_default_hair"] = "hair_" + default_hair
    arm["kantor_hair_nodes"] = ",".join("hair_" + h for h in hair_styles)
    arm["kantor_height_m"] = P.H
    arm["kantor_seat_height_m"] = P.seat
    for k, v in loco.items():
        arm["kantor_" + k] = v
    visible_tris = tri["body"] + tri["hair_" + default_hair] + sum(v for k, v in tri.items() if k.startswith("prop_"))
    OUT_BLEND.mkdir(parents=True, exist_ok=True)
    OUT_GLB.mkdir(parents=True, exist_ok=True)
    stem = cid.lower()
    blend_path = OUT_BLEND / f"{stem}.blend"
    glb_path = OUT_GLB / f"{stem}.glb"
    bpy.context.scene.frame_set(0)
    # no .blend1 backups next to the generated source
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), compress=True)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format="GLB", use_selection=False, export_extras=True,
        export_yup=True, export_apply=False, export_texcoords=False, export_normals=True,
        export_tangents=False, export_colors=False, export_materials="EXPORT", export_cameras=False,
        export_lights=False, export_skins=True, export_all_influences=False, export_morph=False,
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_frame_step=1, export_optimize_animation_size=True, export_anim_single_armature=True,
        export_reset_pose_bones=True, export_rest_position_armature=True, export_def_bones=False,
        export_image_format="NONE",
    )
    size = glb_path.stat().st_size
    print(f"BUILD {cid}: tris={tri} visible_lod0={visible_tris} actions={[a.name for a in actions]} "
          f"loco={loco} glb_bytes={size} blend={blend_path.relative_to(ROOT)} glb={glb_path.relative_to(ROOT)} "
          f"secs={time.time() - t0:.1f}")
    return {"id": cid, "tris": tri, "visible": visible_tris, "glb_bytes": size}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    if "--only" in argv:
        only = argv[argv.index("--only") + 1]
    data = json.loads(DATA.read_text(encoding="utf-8"))
    ids = [only] if only else list(data["characters"])
    print(f"blender {bpy.app.version_string}; building {ids}")
    failures = 0
    for cid in ids:
        if cid not in data["characters"]:
            print(f"ERROR unknown character {cid}")
            failures += 1
            continue
        try:
            build_character(cid, data["characters"][cid], data, data.get("avatarVariants", {}).get(cid))
        except Exception as exc:  # report and continue so one bad spec does not hide the others
            import traceback
            traceback.print_exc()
            print(f"ERROR {cid}: {exc}")
            failures += 1
    if "--variants" in argv and "CH-CEO" in ids:
        v = data["avatarVariants"]["CH-CEO"]
        print(f"VARIANTS CH-CEO hair={v['hairStyles']} palettes={list(v['palettes'])} (embedded in ch-ceo.glb)")
    print(f"BUILD_DONE failures={failures}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
