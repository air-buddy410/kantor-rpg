"""Original stylised furniture kit: one GLB per world.json catalog type.

Run (repo root):
  blender -b --factory-startup -noaudio --python blender/furniture/build_furniture.py -- [--only desk]

Each generator works in the fixture frame (origin footprint centre on the floor,
Z up, front = -Y) and is drawn to the catalog size; the builder then only
re-centres (no scaling) and prints the residual so drift is visible. Shapes are
chunky and soft-cornered with matte colours from app/src/world/palette.ts, one
shared palette (material names = palette keys). Outputs:
app/public/assets/furniture/<type>.glb and blender/out/furniture.blend
(objects FURN-<type>, all at the origin). Fixed seeds keep reruns identical.
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "lib"))
sys.path.insert(0, str(HERE.parent / "building"))
import furniture_spec as FS  # noqa: E402
import kantor_blender as K  # noqa: E402
from build_building import lift_mesh, stair_mesh  # noqa: E402

ROOT = FS.ROOT
OUT_BLEND = ROOT / "blender" / "out" / "furniture.blend"


class Kit:
    """Thin helpers over a Builder; all positions in the fixture frame."""

    def __init__(self, name, seed):
        self.B = K.Builder(name)
        self.rng = random.Random(seed)

    def rb(self, m, x, y, z, w, d, h, r=0.025, n=2):
        self.B.add(K.rbox(w, d, h, r, n), m, K.T(x, y, z))

    def bx(self, m, x, y, z, w, d, h):
        self.B.add(K.box(x - w / 2, y - d / 2, z, x + w / 2, y + d / 2, z + h), m)

    def cy(self, m, x, y, z, r, h, seg=14, bevel=0.0, r_top=None):
        self.B.add(K.cyl(r, h, seg, r_top, bevel), m, K.T(x, y, z))

    def cyx(self, m, xf, r, h, seg=14, bevel=0.0, r_top=None):
        self.B.add(K.cyl(r, h, seg, r_top, bevel), m, xf)

    def el(self, m, x, y, z, rx, ry, rz, seg=12, rings=8, xf=None):
        self.B.add(K.ellipsoid(rx, ry, rz, seg, rings), m, (xf or K.T()) @ K.T(x, y, z))

    def rod(self, m, p0, p1, r, seg=8):
        self.B.add(K.rod(p0, p1, r, seg), m)

    def tor(self, m, xf, R, r, seg=16, segr=6):
        self.B.add(K.torus(R, r, seg, segr), m, xf)

    def slab(self, m, w, d, rc, z0, z1, x=0.0, y=0.0, seg=5):
        self.B.add(K.prism(rrect(w, d, rc, seg), z0, z1), m, K.T(x, y, 0))

    def legs(self, m, w, d, h, inset=0.07, r=0.028, z0=0.0, taper=0.8):
        for sx in (-1, 1):
            for sy in (-1, 1):
                self.cy(m, sx * (w / 2 - inset), sy * (d / 2 - inset), z0, r * taper, h, 10, r_top=r)


def rrect(w, d, rc, seg=5):
    rc = min(rc, w / 2 - 1e-4, d / 2 - 1e-4)
    pts = []
    for cx, cy, a0 in ((w / 2 - rc, d / 2 - rc, 0), (-w / 2 + rc, d / 2 - rc, 90),
                       (-w / 2 + rc, -d / 2 + rc, 180), (w / 2 - rc, -d / 2 + rc, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + rc * math.cos(a), cy + rc * math.sin(a)))
    return pts


# ----------------------------------------------------------------- generators
def g_desk(k, w, d, h, exec_=False):
    k.rb("wood", 0, 0, h - 0.05, w, d, 0.05, 0.02)
    k.rb("woodDark", 0, d / 2 - 0.09, h - 0.40, w - 0.20, 0.03, 0.33, 0.012)
    peds = (1, -1) if exec_ else (1,)
    for s in peds:
        px = s * (w / 2 - 0.25)
        k.rb("wood", px, 0.01, 0.0, 0.44, d - 0.10, h - 0.05, 0.03)
        for i in range(3):
            k.rb("woodLight", px, -(d - 0.10) / 2 + 0.005, 0.05 + i * 0.215, 0.40, 0.03, 0.19, 0.015)
            k.rb("woodDark", px, -(d - 0.10) / 2 - 0.012, 0.19 + i * 0.215, 0.12, 0.02, 0.025, 0.008, 1)
    if not exec_:
        k.rb("woodDark", -w / 2 + 0.06, 0.0, 0.0, 0.06, d - 0.08, h - 0.05, 0.02)
    k.rb("fabricGreen" if exec_ else "fabricSage", -0.12 if not exec_ else 0.0, -0.10, h, 0.70, 0.34, 0.004, 0.002, 1)
    k.rb("metalLight", 0.40 if not exec_ else 0.25, 0.06, h, 0.34, 0.24, 0.014, 0.006, 1)
    if exec_:
        k.rb("accent", -0.45, 0.02, h, 0.18, 0.24, 0.014, 0.004, 1)


def g_chair(k, w, d, h):
    for i in range(5):
        a = math.radians(270 + 72 * i)
        tip = (0.255 * math.cos(a), 0.255 * math.sin(a), 0.055)
        k.rod("metal", (0, 0, 0.07), tip, 0.018, 8)
        k.el("rubber", tip[0] * 1.06, tip[1] * 1.06, 0.03, 0.03, 0.03, 0.03, 10, 6)
    # seat top at 0.45 m, the seat height the character sit/type clips assume
    k.cy("metal", 0, 0, 0.06, 0.03, 0.30, 12)
    k.rb("fabricGreen", 0, -0.02, 0.35, 0.52, 0.50, 0.10, 0.045)
    k.rb("metal", 0, 0.235, 0.38, 0.06, 0.035, 0.16, 0.012)
    k.rb("fabricGreen", 0, 0.255, 0.47, 0.48, 0.09, 0.43, 0.045)
    for s in (-1, 1):
        k.rb("metal", s * 0.26, 0.0, 0.40, 0.035, 0.035, 0.16, 0.01, 1)
        k.rb("rubber", s * 0.265, 0.0, 0.56, 0.07, 0.26, 0.04, 0.018)


def g_chair_guest(k, w, d, h):
    k.legs("woodDark", w, d, 0.37, 0.05, 0.026)
    k.rb("wood", 0, 0, 0.35, w, d, 0.045, 0.02)
    k.rb("fabricSage", 0, -0.02, 0.395, w - 0.06, d - 0.10, 0.055, 0.025)
    for s in (-1, 1):
        k.rb("wood", s * (w / 2 - 0.05), d / 2 - 0.05, 0.40, 0.05, 0.05, h - 0.40, 0.015)
    k.rb("wood", 0, d / 2 - 0.04, h - 0.20, w, 0.06, 0.20, 0.025)
    k.rb("wood", 0, d / 2 - 0.04, 0.58, w - 0.10, 0.04, 0.05, 0.015)


def g_stool(k, w, d, h):
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.rod("woodDark", (sx * (w / 2 - 0.024), sy * (d / 2 - 0.024), 0.0), (sx * 0.12, sy * 0.12, h - 0.09), 0.022)
    k.tor("woodDark", K.T(0, 0, 0.26), 0.15, 0.014, 16, 6)
    k.cy("fabricMustard", 0, 0, h - 0.09, w / 2 - 0.01, 0.09, 18, bevel=0.03)


def g_table(k, w, d, h, top="wood", leg="woodDark", rc=0.06, thick=0.05):
    k.slab(top, w, d, rc, h - thick, h)
    k.legs(leg, w, d, h - thick, 0.09, 0.035)
    k.rb(leg, 0, 0, h - thick - 0.09, w - 0.22, d - 0.22, 0.09, 0.02)


def g_meeting_table(k, w, d, h):
    k.slab("wood", w, d, 0.55, h - 0.06, h, seg=7)
    k.slab("woodDark", w - 0.06, d - 0.06, 0.52, h - 0.075, h - 0.06, seg=7)
    for s in (-1, 1):
        k.rb("woodDark", s * (w / 2 - 0.85), 0, 0.04, 0.32, d - 0.55, h - 0.10, 0.04)
        k.rb("woodDark", s * (w / 2 - 0.85), 0, 0.0, 0.50, d - 0.25, 0.05, 0.02)
    k.rb("metal", 0, 0, h, 0.30, 0.14, 0.012, 0.004, 1)
    k.rb("accent", 0.09, -0.03, h + 0.012, 0.04, 0.03, 0.004, 0.001, 1)


def g_round_table(k, w, d, h, felt=False):
    k.cy("woodLight" if not felt else "wood", 0, 0, h - 0.05, w / 2, 0.05, 28, bevel=0.015)
    k.cy("woodDark", 0, 0, 0.04, 0.07, h - 0.09, 14)
    k.cy("woodDark", 0, 0, 0.0, min(w, d) * 0.28, 0.045, 20, bevel=0.012)


def g_high_table(k, w, d, h):
    k.slab("woodLight", w, d, 0.12, h - 0.05, h)
    for s in (-1, 1):
        k.rb("woodDark", s * (w / 2 - 0.18), 0, 0.03, 0.08, 0.08, h - 0.08, 0.02)
        k.rb("woodDark", s * (w / 2 - 0.18), 0, 0.0, 0.10, d - 0.06, 0.04, 0.015)
    k.rod("metal", (-(w / 2 - 0.18), -0.12, 0.30), ((w / 2 - 0.18), -0.12, 0.30), 0.015)


def g_dining_table(k, w, d, h):
    k.rb("wood", 0, 0, h - 0.06, w, d, 0.06, 0.025)
    k.rb("woodDark", 0, 0, h - 0.16, w - 0.20, d - 0.20, 0.10, 0.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.cy("woodDark", sx * (w / 2 - 0.12), sy * (d / 2 - 0.12), 0, 0.034, h - 0.06, 12, r_top=0.048)
    k.cy("fabricSage", 0.3, 0.0, h, 0.11, 0.012, 16)


def g_coffee_table(k, w, d, h):
    k.rb("woodLight", 0, 0, h - 0.06, w, d, 0.06, 0.04)
    k.rb("woodDark", 0, 0, 0.08, w - 0.14, d - 0.14, 0.03, 0.012)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.cy("woodDark", sx * (w / 2 - 0.08), sy * (d / 2 - 0.08), 0, 0.03, h - 0.06, 10)
    for i, m in enumerate(("accent", "fabricBlue", "fabricMustard")):
        k.rb(m, -0.18 + i * 0.012, 0.0, 0.11 + i * 0.03, 0.26 - i * 0.02, 0.18 - i * 0.01, 0.028, 0.006, 1)


def g_work_table(k, w, d, h):
    k.rb("woodLight", 0, 0, h - 0.045, w, d, 0.045, 0.02)
    for s in (-1, 1):
        k.rb("metal", s * (w / 2 - 0.2), 0, 0.03, 0.08, 0.06, h - 0.075, 0.02)
        k.rb("metal", s * (w / 2 - 0.2), 0, 0.0, 0.09, d - 0.04, 0.04, 0.015)
    k.rb("metal", 0, 0, h - 0.11, w - 0.46, 0.06, 0.06, 0.015)


def g_plan_table(k, w, d, h):
    k.rb("wood", 0, 0, h - 0.05, w, d, 0.05, 0.02)
    k.rb("fabricBlue", 0.05, 0.0, h, w - 0.5, d - 0.25, 0.003, 0.001, 1)
    for i in range(4):
        k.rb("white", 0.05 - 0.3 + i * 0.2, 0.0, h + 0.003, 0.012, d - 0.4, 0.001, 0.0005, 1)
    k.rb("woodDark", 0, 0, 0.06, w - 0.08, d - 0.08, h - 0.16, 0.03)
    for i in range(4):
        k.rb("woodLight", 0, -(d - 0.08) / 2 - 0.004, 0.10 + i * 0.165, w - 0.2, 0.02, 0.13, 0.015)
        k.rb("woodDark", 0, -(d - 0.08) / 2 - 0.016, 0.18 + i * 0.165, 0.22, 0.02, 0.025, 0.008, 1)
    k.rb("woodDark", 0, 0, 0.0, w - 0.04, d - 0.04, 0.06, 0.02)


def g_drafting_table(k, w, d, h):
    tilt = 15.0
    depth = 0.72
    zc = h - math.sin(math.radians(tilt)) * depth / 2 - 0.029
    xf = K.T(0, 0.02, zc) @ K.R("X", tilt)
    k.B.add(K.rbox(w, depth, 0.04, 0.015), "woodLight", xf @ K.T(0, 0, -0.02))
    k.B.add(K.rbox(w * 0.62, depth * 0.62, 0.003, 0.001, 1), "paper", xf @ K.T(0.05, 0.02, 0.02))
    k.B.add(K.rbox(w - 0.1, 0.03, 0.02, 0.008, 1), "metal", xf @ K.T(0, -0.15, 0.02))
    k.B.add(K.rbox(w * 0.6, 0.06, 0.03, 0.01), "woodDark", xf @ K.T(0, -depth / 2 + 0.02, 0.0))
    for s in (-1, 1):
        x = s * (w / 2 - 0.08)
        k.rod("woodDark", (x, -d / 2 + 0.04, 0.0), (x, 0.0, zc - 0.03), 0.026)
        k.rod("woodDark", (x, d / 2 - 0.04, 0.0), (x, 0.0, zc - 0.03), 0.026)
        k.rb("woodDark", x, 0, 0.0, 0.06, d, 0.035, 0.012)
    k.rod("woodDark", (-(w / 2 - 0.08), 0.0, 0.28), ((w / 2 - 0.08), 0.0, 0.28), 0.02)


def g_reception_desk(k, w, d, h):
    k.rb("wood", 0, -d / 2 + 0.07, 0.0, w, 0.14, h - 0.04, 0.04)
    k.rb("woodDark", 0, -d / 2 + 0.07, 0.0, w + 0.0, 0.13, 0.08, 0.02)
    k.rb("wallCap", 0, -d / 2 + 0.012, 0.45, w * 0.46, 0.02, 0.36, 0.03)
    k.rb("fabricCream", 0, -d / 2 + 0.004, 0.56, w * 0.32, 0.008, 0.14, 0.01, 1)
    k.rb("accent", 0, -d / 2 + 0.01, 0.18, w - 0.3, 0.02, 0.07, 0.01, 1)
    k.rb("woodLight", 0, -d / 2 + 0.11, h - 0.045, w, 0.26, 0.045, 0.02)
    k.rb("wood", 0, 0.12, 0.70, w - 0.12, d - 0.30, 0.04, 0.015)
    for s in (-1, 1):
        k.rb("woodDark", s * (w / 2 - 0.05), 0.05, 0.0, 0.1, d - 0.12, 0.74, 0.03)
    k.rb("woodDark", 0.6, 0.2, 0.0, 0.5, d - 0.42, 0.70, 0.03)
    for i in range(5):
        k.rb("woodDark", -w / 2 + 0.35 + i * 0.58, -d / 2 + 0.006, 0.32, 0.08, 0.01, h - 0.45, 0.004, 1)
    k.rb("metalLight", -0.5, 0.18, 0.74, 0.34, 0.24, 0.016, 0.006, 1)


def g_sofa(k, w, d, h, arm=True, fabric="fabricGreen", cushion="fabricCream", pillow="fabricMustard"):
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.cy("woodDark", sx * (w / 2 - 0.1), sy * (d / 2 - 0.1), 0.0, 0.03, 0.08, 10, r_top=0.035)
    k.rb(fabric, 0, 0, 0.07, w, d, 0.26, 0.07, 3)
    k.rb(fabric, 0, d / 2 - 0.12, 0.30, w - 0.04, 0.24, h - 0.30, 0.09, 3)
    aw = 0.19 if arm else 0.0
    if arm:
        for s in (-1, 1):
            k.rb(fabric, s * (w / 2 - aw / 2), 0, 0.30, aw, d, 0.32, 0.08, 3)
    seats = max(1, round((w - 2 * aw) / 0.75))
    cw = (w - 2 * aw - 0.02) / seats
    for i in range(seats):
        x = -w / 2 + aw + 0.01 + cw * (i + 0.5)
        k.rb(cushion, x, -0.07, 0.31, cw - 0.02, d - 0.27, 0.15, 0.06, 3)
        k.rb(cushion, x, d / 2 - 0.27, 0.43, cw - 0.06, 0.15, h - 0.47, 0.06, 3)
    k.el(pillow, -w / 2 + aw + 0.2, d / 2 - 0.38, 0.58, 0.13, 0.06, 0.12, 12, 8,
         xf=K.T() @ K.R("Z", 0))


def g_armchair(k, w, d, h):
    g_sofa(k, w, d, h, True, "fabricSage", "fabricCream", "fabricTerracotta")


def g_beanbag(k, w, d, h):
    k.el("fabricMustard", 0, -0.03, 0.2, w / 2 - 0.005, d / 2 - 0.035, 0.2, 18, 10)
    k.el("fabricMustard", 0, d / 2 - 0.2, 0.3, w / 2 - 0.08, 0.2, 0.2, 16, 10)
    k.el("fabricTerracotta", 0, -0.08, 0.36, 0.06, 0.05, 0.02, 10, 6)


def g_bench(k, w, d, h):
    k.rb("woodDark", 0, 0, h - 0.10, w - 0.06, d - 0.06, 0.05, 0.02)
    for i in range(3):
        k.rb("woodLight", 0, -d / 2 + 0.072 + i * 0.153, h - 0.055, w, 0.135, 0.055, 0.02)
    for s in (-1, 1):
        k.rb("woodDark", s * (w / 2 - 0.2), 0, 0.0, 0.08, d - 0.04, h - 0.08, 0.02)
    k.rb("woodDark", 0, 0, 0.12, w - 0.36, 0.05, 0.05, 0.015)


BOOK_COLORS = ("fabricGreen", "fabricTerracotta", "fabricMustard", "fabricBlue", "fabricCream", "fabricSage", "woodDark")


def carcass(k, w, d, h, shelves, mat="wood"):
    t = 0.04
    for s in (-1, 1):
        k.rb(mat, s * (w / 2 - t / 2), 0, 0, t, d, h, 0.012)
    k.rb("woodDark", 0, d / 2 - 0.012, 0.02, w - 0.04, 0.02, h - 0.04, 0.006, 1)
    levels = [0.0] + [0.08 + (h - 0.16) * i / shelves for i in range(1, shelves)] + [h - t]
    for z in levels:
        k.rb(mat, 0, 0, z, w - 2 * t + 0.004, d - 0.01, t, 0.01)
    return levels


def g_bookshelf(k, w, d, h):
    levels = carcass(k, w, d, h, 5)
    for z0, z1 in zip(levels[:-1], levels[1:]):
        x = -w / 2 + 0.06
        while x < w / 2 - 0.12:
            bw = k.rng.uniform(0.03, 0.06)
            bh = min(z1 - z0 - 0.06, k.rng.uniform(0.18, 0.30))
            lean = k.rng.random() < 0.08
            m = BOOK_COLORS[k.rng.randrange(len(BOOK_COLORS))]
            if lean:
                k.B.add(K.box(-bw / 2, -0.11, 0, bw / 2, 0.11, bh), m, K.T(x + 0.04, 0.02, z0 + 0.04) @ K.R("Y", -14))
                x += 0.1
            else:
                k.bx(m, x + bw / 2, 0.02, z0 + 0.04, bw, d - 0.12, bh)
                x += bw + 0.004
            if k.rng.random() < 0.05:
                x += 0.08


def g_model_shelf(k, w, d, h):
    levels = carcass(k, w, d, h, 4, "woodLight")
    for i, (z0, z1) in enumerate(zip(levels[:-1], levels[1:])):
        for j in range(3):
            x = -w / 2 + 0.22 + j * 0.37
            kind = (i + j) % 3
            if kind == 0:
                k.bx("white", x, 0.0, z0 + 0.04, 0.2, 0.18, 0.12)
                k.rb("woodDark", x, 0.0, z0 + 0.16, 0.24, 0.22, 0.03, 0.01)
                k.bx("accent", x - 0.05, -0.091, z0 + 0.06, 0.04, 0.004, 0.06)
            elif kind == 1:
                k.bx("white", x - 0.05, 0.0, z0 + 0.04, 0.1, 0.12, min(0.26, z1 - z0 - 0.06))
                k.bx("fabricSage", x + 0.07, 0.0, z0 + 0.04, 0.12, 0.16, 0.08)
            else:
                k.cy("white", x, 0.0, z0 + 0.04, 0.07, 0.14, 12)
                k.el("plantLeaf", x, 0.0, z0 + 0.21, 0.08, 0.08, 0.05, 10, 6)


def g_tool_cabinet(k, w, d, h):
    k.rb("metal", 0, 0.02, 0.06, w, d - 0.04, h - 0.064, 0.03)
    k.rb("rubber", 0, 0.02, h - 0.004, w - 0.04, d - 0.08, 0.004, 0.002, 1)
    rows = 6
    fp = -d / 2 + 0.04
    for i in range(rows):
        z = 0.1 + i * (h - 0.16) / rows
        hh = (h - 0.16) / rows - 0.025
        k.rb("metalLight", 0, fp - 0.008, z, w - 0.08, 0.02, hh, 0.012)
        k.rb("woodDark", 0, fp - 0.028, z + hh - 0.05, 0.3, 0.024, 0.03, 0.01, 1)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.cy("rubber", sx * (w / 2 - 0.08), sy * (d / 2 - 0.08), 0, 0.03, 0.06, 10)


def g_storage_shelf(k, w, d, h):
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.rb("metal", sx * (w / 2 - 0.02), sy * (d / 2 - 0.02), 0, 0.04, 0.04, h, 0.008, 1)
    levels = [0.08, 0.55, 1.02, 1.49, h - 0.035]
    for z in levels:
        k.rb("woodLight", 0, 0, z, w, d, 0.035, 0.01)
    for z0, z1 in zip(levels[:-1], levels[1:]):
        x = -w / 2 + 0.08
        while x < w / 2 - 0.3:
            bw = k.rng.uniform(0.28, 0.42)
            bh = min(z1 - z0 - 0.07, k.rng.uniform(0.2, 0.36))
            m = ("fabricCream", "woodLight", "fabricSage")[k.rng.randrange(3)]
            k.rb(m, x + bw / 2, 0.0, z0 + 0.035, bw, d - 0.08, bh, 0.02)
            k.rb("paper", x + bw / 2, -(d - 0.08) / 2 - 0.004, z0 + 0.035 + bh * 0.55, 0.12, 0.01, 0.06, 0.003, 1)
            x += bw + 0.03


def g_locker(k, w, d, h):
    k.rb("fabricBlue", 0, 0.015, 0.05, w, d - 0.03, h - 0.05, 0.02)
    k.rb("woodDark", 0, 0, 0.0, w - 0.06, d - 0.06, 0.06, 0.015)
    cols, rows = 3, 2
    cw = (w - 0.06) / cols
    rh = (h - 0.12) / rows
    for c in range(cols):
        for r in range(rows):
            x = -w / 2 + 0.03 + cw * (c + 0.5)
            z = 0.08 + r * rh
            k.rb("fabricBlue", x, -d / 2 + 0.026, z, cw - 0.03, 0.016, rh - 0.03, 0.012)
            for v in range(3):
                k.rb("metal", x, -d / 2 + 0.016, z + rh - 0.14 - v * 0.03, cw * 0.5, 0.006, 0.01, 0.003, 1)
            k.rb("paper", x, -d / 2 + 0.016, z + rh - 0.25, 0.08, 0.006, 0.05, 0.003, 1)
            k.rb("metalLight", x + cw * 0.32, -d / 2 + 0.009, z + rh * 0.3, 0.02, 0.016, 0.12, 0.006, 1)


def panel(k, w, d, h, frame, face, art=False, oy=0.0, oz=0.0):
    """Framed flat panel (front -Y). art=True adds the original hill/sun/stripe
    composition on materials art_a/b/c so runtime can recolour per ARTWORK id."""
    k.rb(frame, 0, oy + 0.006, oz, w, d - 0.012, h, min(0.03, d / 2 - 0.008))
    fw, fh = w * 0.88, h * 0.84
    fy = oy - d / 2 + 0.012
    k.rb(face, 0, fy - 0.002, oz + h * 0.08, fw, 0.008, fh, 0.003, 1)
    if art:
        k.rb("art_a", 0, fy - 0.006, oz + h * 0.08, fw, 0.006, fh * 0.34, 0.002, 1)
        xf = K.T(fw * 0.22, fy - 0.006, oz + h * 0.08 + fh * 0.70) @ K.R("X", 90)
        k.cyx("art_c", xf, min(fw, fh) * 0.16, 0.006, 20)
        k.rb("art_b", -fw * 0.14, fy - 0.008, oz + h * 0.08 + fh * 0.47, fw * 0.5, 0.006, fh * 0.06, 0.002, 1)


def g_whiteboard(k, w, d, h):
    panel(k, w, d - 0.05, h, "metalLight", "white", oy=0.025)
    k.rb("metal", 0, -d / 2 + 0.025, 0.02, w * 0.8, 0.05, 0.03, 0.01)
    for i, m in enumerate(("fabricBlue", "accent", "fabricGreen")):
        k.rb(m, -w * 0.25 + i * 0.05, -d / 2 + 0.012, 0.05, 0.03, 0.015, 0.015, 0.005, 1)
    for i, (m, ww) in enumerate((("fabricBlue", 0.6), ("fabricBlue", 0.45), ("accent", 0.3))):
        k.rb(m, -w * 0.18, 0.004, h * 0.7 - i * 0.12, ww, 0.004, 0.015, 0.002, 1)


def g_wall_display(k, w, d, h):
    k.rb("screen", 0, 0.006, 0, w, d - 0.012, h, 0.025)
    k.rb("screenGlow", 0, -d / 2 + 0.009, 0.04, w - 0.08, 0.006, h - 0.08, 0.004, 1)
    k.rb("white", -w * 0.3, -d / 2 + 0.004, h * 0.62, w * 0.25, 0.004, h * 0.1, 0.002, 1)
    k.rb("fabricCream", w * 0.12, -d / 2 + 0.004, h * 0.25, w * 0.5, 0.004, h * 0.3, 0.002, 1)


def g_gallery_panel(k, w, d, h):
    k.rb("woodDark", 0, 0, 0, w, d, 0.1, 0.03)
    k.rb("fabricCream", 0, 0, 0.1, w - 0.06, 0.12, h - 0.1, 0.03)
    panel(k, w * 0.78, 0.03, h * 0.62, "woodLight", "paper", art=True, oy=-0.075, oz=0.55)


def g_poster(k, w, d, h):
    panel(k, w, d, h, "woodLight", "paper", art=True)


def g_directory_sign(k, w, d, h):
    panel(k, w, d, h, "wallCap", "fabricCream")
    for i in range(4):
        k.rb("wallCap", -w * 0.08, -d / 2 + 0.004, h * 0.2 + i * h * 0.15, w * 0.6, 0.004, 0.03, 0.002, 1)
        k.rb("accent", w * 0.33, -d / 2 + 0.004, h * 0.2 + i * h * 0.15, 0.03, 0.004, 0.03, 0.002, 1)


def g_easel(k, w, d, h):
    top = (0.0, 0.05, h - 0.02)
    for s in (-1, 1):
        k.rod("woodLight", (s * (w / 2 - 0.022), -d / 2 + 0.022, 0.0), (s * 0.04, 0.05, h - 0.004), 0.022)
    k.rod("woodLight", (0.0, d / 2 - 0.022, 0.0), (0.0, 0.05, h - 0.004), 0.022)
    k.rb("woodDark", 0, -0.12, 0.72, w * 0.78, 0.07, 0.03, 0.01)
    xf = K.T(0, -0.11, 0.75) @ K.R("X", -9)
    k.B.add(K.rbox(0.6, 0.03, 0.72, 0.01), "paper", xf)
    k.B.add(K.rbox(0.48, 0.004, 0.18, 0.002, 1), "art_a", xf @ K.T(0, -0.017, 0.08))
    k.B.add(K.cyl(0.07, 0.004, 16), "art_c", xf @ K.T(0.13, -0.017, 0.52) @ K.R("X", 90))
    k.B.add(K.rbox(0.25, 0.004, 0.03, 0.002, 1), "art_b", xf @ K.T(-0.08, -0.017, 0.36))


def foliage(k, cx, cy, z0, z1, rmax, n, seedmix=0):
    for i in range(n):
        t = i / max(1, n - 1)
        z = lerp(z0, z1, 0.25 + 0.75 * t)
        a = i * 2.39996 + seedmix
        rr = rmax * (0.55 + 0.35 * math.sin(i * 1.3)) * (1 - 0.35 * t)
        blob = rmax * (0.62 - 0.22 * t)
        x = cx + math.cos(a) * min(rr, rmax - blob)
        y = cy + math.sin(a) * min(rr, rmax - blob)
        m = "plantLeaf" if i % 2 else "plantLeafDark"
        k.el(m, x, y, min(z, z1 - blob * 0.85), blob, blob, blob * 0.85, 12, 8)


def lerp(a, b, t):
    return a + (b - a) * t


def g_plant_large(k, w, d, h):
    r = w / 2
    k.cy("pot", 0, 0, 0, r * 0.74, 0.46, 18, bevel=0.03, r_top=r)
    k.cy("woodDark", 0, 0, 0.40, r * 0.86, 0.04, 18)
    k.rod("woodDark", (0, 0, 0.42), (0.03, 0.02, 1.1), 0.025)
    foliage(k, 0, 0, 0.62, h, r, 9)


def g_plant_small(k, w, d, h):
    r = w / 2
    k.cy("pot", 0, 0, 0, r * 0.75, 0.32, 16, bevel=0.025, r_top=r)
    k.cy("woodDark", 0, 0, 0.29, r * 0.85, 0.03, 16)
    for i in range(7):
        a = i * 2.4
        lean = 0.10 + 0.04 * (i % 3)
        tip = (math.cos(a) * r * 0.55, math.sin(a) * r * 0.55, h - 0.05 - (i % 3) * 0.12)
        mid = (tip[0] * 0.5, tip[1] * 0.5, (0.3 + tip[2]) / 2)
        k.el("plantLeaf" if i % 2 else "plantLeafDark", mid[0], mid[1], mid[2], 0.045, 0.045,
             (tip[2] - 0.3) / 2 + 0.02, 10, 6, xf=K.T())
        _ = lean
    k.el("plantLeafDark", 0, 0, h - 0.11, 0.06, 0.06, 0.11, 10, 6)


def g_planter_box(k, w, d, h):
    k.rb("wood", 0, 0, 0, w, d, 0.42, 0.04)
    k.rb("woodDark", 0, 0, 0.40, w, d, 0.04, 0.02)
    for i in range(5):
        x = -w / 2 + 0.2 + i * (w - 0.4) / 4
        k.el("plantLeaf" if i % 2 else "plantLeafDark", x, 0.0, h - 0.14, 0.2, d / 2 - 0.03, 0.14, 12, 8)
    for i in range(4):
        x = -w / 2 + 0.36 + i * (w - 0.72) / 3
        k.el("fabricMustard" if i % 2 else "accent", x, -d / 4, h - 0.06, 0.03, 0.03, 0.03, 8, 5)


def g_tree_planter(k, w, d, h):
    r = w / 2
    k.rb("woodLight", 0, 0, 0, w - 0.04, d - 0.04, 0.55, 0.06)
    k.rb("woodDark", 0, 0, 0.53, w, d, 0.05, 0.03)
    k.rod("woodDark", (0, 0, 0.55), (0.05, 0.0, 1.55), 0.06, 10)
    k.rod("woodDark", (0.04, 0.0, 1.2), (-0.25, 0.1, 1.75), 0.035, 8)
    foliage(k, 0, 0, 1.25, h, r, 10, 0.7)


def counter(k, w, d, h, top="white", doors="fabricCream", plinth=0.08):
    k.rb("woodDark", 0, 0.02, 0, w - 0.04, d - 0.08, plinth, 0.01)
    k.rb("wood", 0, 0.02, plinth, w - 0.02, d - 0.06, h - plinth - 0.04, 0.02)
    n = max(2, round(w / 0.6))
    dw = (w - 0.06) / n
    for i in range(n):
        x = -w / 2 + 0.03 + dw * (i + 0.5)
        k.rb(doors, x, -d / 2 + 0.035, plinth + 0.02, dw - 0.02, 0.02, h - plinth - 0.1, 0.012)
        k.rb("metalLight", x + dw * 0.32, -d / 2 + 0.018, h - 0.22, 0.02, 0.015, 0.1, 0.006, 1)
    k.rb(top, 0, 0, h - 0.04, w, d, 0.04, 0.015)


def g_pantry_counter(k, w, d, h):
    counter(k, w, d, h)
    k.rb("metal", 0.6, 0.02, h - 0.002, 0.5, 0.36, 0.004, 0.002, 1)
    k.rb("woodLight", -0.6, 0.0, h, 0.34, 0.24, 0.015, 0.005, 1)
    k.rb("metal", -1.1, 0.06, h, 0.42, 0.34, 0.012, 0.004, 1)


def g_coffee_bar(k, w, d, h):
    ch = 0.86
    counter(k, w, d, ch, "woodLight", "fabricCream")
    k.rb("accent", 0, -d / 2 + 0.022, 0.12, w - 0.1, 0.012, 0.05, 0.004, 1)
    k.rb("metal", -0.5, 0.08, ch, 0.36, 0.32, h - ch, 0.03)
    k.rb("metalLight", -0.5, -0.09, ch + 0.03, 0.26, 0.02, 0.08, 0.01, 1)
    k.rb("screenGlow", -0.5, -0.081, ch + 0.11, 0.08, 0.004, 0.02, 0.002, 1)
    for i in range(4):
        k.cy("white", 0.1 + i * 0.13, -0.06, ch, 0.035, 0.07, 12, bevel=0.008)
    k.cy("pot", 0.85, 0.08, ch, 0.09, 0.11, 14, bevel=0.012)


def g_fridge(k, w, d, h):
    k.rb("white", 0, 0.015, 0, w, d - 0.03, h, 0.06, 3)
    k.rb("metalLight", 0, -d / 2 + 0.032, h * 0.62, w - 0.08, 0.008, 0.012, 0.003, 1)
    for z0, hh in ((0.12, h * 0.42), (h * 0.66, h * 0.24)):
        k.rb("metal", w * 0.36, -d / 2 + 0.015, z0, 0.03, 0.03, hh, 0.012)
    for i, m in enumerate(("accent", "fabricBlue", "fabricMustard")):
        k.rb(m, -w * 0.2 + i * 0.08, -d / 2 + 0.027, h * 0.75 + (i % 2) * 0.05, 0.05, 0.008, 0.05, 0.004, 1)


def g_sink(k, w, d, h):
    k.rb("woodLight", 0, 0.01, 0, w - 0.02, d - 0.04, h - 0.06, 0.02)
    k.rb("white", 0, 0, h - 0.06, w, d, 0.06, 0.02)
    k.el("metalLight", 0, -0.02, h - 0.004, w * 0.32, d * 0.3, 0.004, 16, 6)
    k.rb("metalLight", 0, d / 2 - 0.06, h, 0.05, 0.05, 0.015, 0.006, 1)
    k.rb("metalLight", 0.0, -d / 2 + 0.005, h - 0.2, 0.14, 0.015, 0.02, 0.006, 1)


def g_wc(k, w, d, h):
    k.rb("white", 0, d / 2 - 0.1, 0.38, w, 0.2, h - 0.38, 0.04)
    k.rb("metalLight", 0, d / 2 - 0.1, h - 0.002, 0.08, 0.05, 0.002, 0.001, 1)
    k.cy("white", 0, 0.02, 0, 0.12, 0.34, 16, r_top=0.15)
    k.el("white", 0, -0.08, 0.34, w / 2 - 0.01, 0.27, 0.07, 18, 8)
    k.el("rubber", 0, -0.08, 0.41, w / 2 - 0.03, 0.24, 0.012, 16, 4)


def g_partition(k, w, d, h):
    k.rb("fabricSage", 0, 0.005, 0.1, w, d - 0.01, h - 0.1, 0.012, 1)
    for s in (-1, 1):
        k.rb("metal", s * (w / 2 - 0.08), 0, 0, 0.06, d, 0.11, 0.008, 1)
    k.rb("metalLight", w / 2 - 0.15, -d / 2 + 0.005, 1.0, 0.06, 0.01, 0.02, 0.004, 1)


def g_shower_stall(k, w, d, h):
    k.rb("white", 0, 0, 0, w, d, 0.08, 0.02)
    k.rb("white", 0, d / 2 - 0.02, 0.08, w, 0.04, h - 0.08, 0.008, 1)
    k.rb("white", -w / 2 + 0.02, 0, 0.08, 0.04, d, h - 0.08, 0.008, 1)
    k.rb("glass", 0.02, -d / 2 + 0.015, 0.08, w - 0.04, 0.02, h - 0.12, 0.006, 1)
    k.rb("metal", 0, -d / 2 + 0.015, h - 0.04, w, 0.03, 0.03, 0.006, 1)
    k.rb("metal", w / 2 - 0.015, -d / 2 + 0.015, 0.08, 0.03, 0.03, h - 0.08, 0.006, 1)
    k.rod("metalLight", (0.1, d / 2 - 0.04, 1.2), (0.1, d / 2 - 0.04, 1.95), 0.012)
    k.cy("metalLight", 0.1, d / 2 - 0.16, 1.92, 0.06, 0.02, 14)
    k.rod("metalLight", (0.1, d / 2 - 0.04, 1.95), (0.1, d / 2 - 0.16, 1.95), 0.012)
    k.cy("metal", 0, 0, 0.08, 0.04, 0.003, 12)


def g_rack_42u(k, w, d, h):
    k.rb("screen", 0, 0.02, 0.05, w, d - 0.04, h - 0.05, 0.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.cy("rubber", sx * (w / 2 - 0.07), sy * (d / 2 - 0.08), 0, 0.03, 0.05, 10)
    k.rb("metal", 0, -d / 2 + 0.034, 0.1, w - 0.04, 0.012, h - 0.18, 0.006)
    z = 0.2
    rows = [("metalLight", 0.09), ("screen", 0.05), ("metalLight", 0.045), ("screen", 0.09), ("metalLight", 0.045),
            ("screen", 0.13), ("fabricCream", 0.09), ("screen", 0.09)]
    for i, (m, hh) in enumerate(rows * 2):
        if z + hh > h - 0.2:
            break
        k.rb(m, 0, -d / 2 + 0.022, z, w - 0.12, 0.012, hh - 0.008, 0.003, 1)
        if m == "screen":
            for j in range(4):
                k.rb("screenGlow" if (i + j) % 3 else "accent", -0.18 + j * 0.05, -d / 2 + 0.012, z + hh / 2 - 0.006,
                     0.012, 0.004, 0.012, 0.002, 1)
        z += hh + 0.012
    for i in range(6):
        k.rb("metal", -0.15 + i * 0.06, 0, h - 0.004, 0.03, d - 0.2, 0.004, 0.002, 1)


def g_lab_bench(k, w, d, h):
    k.rb("woodLight", 0, 0, h - 0.05, w, d, 0.05, 0.02)
    k.rb("fabricSage", -0.15, -0.05, h, w - 0.6, d - 0.25, 0.004, 0.002, 1)
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.rb("metal", sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), 0, 0.05, 0.05, h - 0.05, 0.012, 1)
    k.rb("woodDark", 0, 0, 0.15, w - 0.06, d - 0.06, 0.03, 0.01)
    k.rb("metal", w / 2 - 0.3, -0.02, h - 0.27, 0.5, d - 0.12, 0.22, 0.02)
    for i in range(2):
        k.rb("metalLight", w / 2 - 0.3, -(d - 0.12) / 2 - 0.01, h - 0.26 + i * 0.105, 0.46, 0.02, 0.09, 0.01, 1)
    k.rb("screen", -0.4, 0.05, 0.18, 0.36, 0.26, 0.07, 0.015)
    for j in range(5):
        k.rb("screenGlow", -0.52 + j * 0.05, -0.081, 0.22, 0.012, 0.004, 0.012, 0.002, 1)
    k.rb("fabricBlue", 0.15, 0.05, 0.18, 0.3, 0.3, 0.12, 0.03)


def g_lab_rack_open(k, w, d, h):
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.rb("metal", sx * (w / 2 - 0.025), sy * (d / 2 - 0.025), 0, 0.05, 0.05, h, 0.008, 1)
    for z in (0.0, h - 0.04):
        k.rb("metal", 0, 0, z, w, d, 0.04, 0.008, 1)
    z = 0.12
    for i, (m, hh) in enumerate((("screen", 0.09), ("metalLight", 0.05), ("screen", 0.05), ("metalLight", 0.05),
                                 ("screen", 0.14), ("fabricCream", 0.09))):
        k.rb(m, 0, 0, z, w - 0.12, d - 0.1, hh - 0.01, 0.006)
        if m == "screen":
            for j in range(5):
                k.rb("screenGlow" if j % 4 else "accent", -0.18 + j * 0.06, -(d - 0.1) / 2 - 0.003, z + hh / 2 - 0.01,
                     0.014, 0.004, 0.014, 0.002, 1)
        z += hh + 0.04
    for i in range(3):
        k.rod("fabricBlue", (-0.15 + i * 0.05, d / 2 - 0.08, 0.15), (-0.12 + i * 0.05, d / 2 - 0.08, z), 0.01, 6)


def g_billiard_table(k, w, d, h):
    rail = 0.13
    # four rails frame the felt bed (a solid block would bury the felt)
    k.rb("woodDark", 0, 0, h - 0.13, w - 0.04, d - 0.04, 0.085, 0.03)
    for s in (-1, 1):
        k.rb("woodDark", 0, s * (d / 2 - rail / 2), h - 0.13, w, rail, 0.13, 0.035)
        k.rb("woodDark", s * (w / 2 - rail / 2), 0, h - 0.13, rail, d, 0.13, 0.035)
    k.rb("felt", 0, 0, h - 0.045, w - 2 * rail + 0.06, d - 2 * rail + 0.06, 0.006, 0.003, 1)
    for s in (-1, 1):
        k.rb("felt", 0, s * (d / 2 - rail + 0.02), h - 0.045, w - 2 * rail, 0.05, 0.035, 0.015)
        k.rb("felt", s * (w / 2 - rail + 0.02), 0, h - 0.045, 0.05, d - 2 * rail, 0.035, 0.015)
    for px in (-1, 0, 1):
        for py in (-1, 1):
            k.cy("rubber", px * (w / 2 - rail + 0.03), py * (d / 2 - rail + 0.03), h - 0.05, 0.055, 0.051, 14)
    for i in range(1, 8):
        if i == 4:
            continue
        for s in (-1, 1):
            k.el("white", -w / 2 + i * w / 8, s * (d / 2 - 0.05), h, 0.012, 0.012, 0.004, 8, 4)
    k.rb("wood", 0, 0, 0.42, w - 0.14, d - 0.14, h - 0.55, 0.03)
    for px in (-1, 0, 1):
        for py in (-1, 1):
            k.cy("woodDark", px * (w / 2 - 0.22), py * (d / 2 - 0.22), 0, 0.075, 0.43, 14, r_top=0.06, bevel=0.015)
    balls = (("white", -0.6, 0.0), ("accent", 0.55, 0.0), ("fabricMustard", 0.62, 0.05), ("fabricBlue", 0.62, -0.05),
             ("fabricGreen", 0.69, 0.0), ("screen", 0.69, 0.1))
    for m, x, y in balls:
        k.el(m, x, y, h - 0.04 + 0.028, 0.028, 0.028, 0.028, 10, 6)


def g_cue_rack(k, w, d, h):
    k.rb("woodDark", 0, d / 2 - 0.02, 0, w, 0.04, h, 0.015)
    for z in (0.12, 0.95):
        k.rb("wood", 0, d / 2 - 0.06, z, w - 0.04, 0.08, 0.05, 0.015)
    for i in range(4):
        x = -w / 2 + 0.12 + i * 0.12
        k.rod("woodLight", (x, -d / 2 + 0.017, 0.14), (x, -d / 2 + 0.017, h - 0.03), 0.011, 8)
        k.cy("woodDark", x, -d / 2 + 0.017, 0.14, 0.016, 0.3, 8)
        k.cy("white", x, -d / 2 + 0.017, h - 0.03, 0.009, 0.03, 8)


def g_media_console(k, w, d, h):
    k.rb("wood", 0, 0.01, 0.06, w, d - 0.02, 0.42, 0.03)
    for s in (-1, 1):
        k.cy("woodDark", s * (w / 2 - 0.1), 0, 0, 0.03, 0.07, 10)
        k.rb("woodLight", s * w / 4, -d / 2 + 0.01, 0.1, w / 2 - 0.06, 0.02, 0.34, 0.012)
    tw, th = 1.5, 0.86
    k.rb("metal", 0, 0.05, 0.48, 0.3, 0.16, 0.03, 0.01)
    k.rb("metal", 0, 0.08, 0.5, 0.06, 0.04, 0.2, 0.01)
    k.rb("screen", 0, 0.06, h - th, tw, 0.06, th, 0.02)
    k.rb("screenGlow", 0, 0.028, h - th + 0.04, tw - 0.08, 0.006, th - 0.08, 0.004, 1)
    k.rb("fabricMustard", -0.25, 0.024, h - th + 0.25, 0.4, 0.004, 0.18, 0.004, 1)
    k.rb("white", 0.55, -0.05, 0.48, 0.32, 0.22, 0.05, 0.015)
    for i, m in enumerate(("accent", "fabricBlue")):
        k.el(m, -0.55 + i * 0.18, -0.08, 0.5, 0.06, 0.04, 0.02, 10, 6)


def g_arcade_cabinet(k, w, d, h):
    prof = [(-d / 2, 0.0), (d / 2, 0.0), (d / 2, h), (-d / 2 + 0.18, h), (-d / 2 + 0.12, h - 0.25),
            (-d / 2 + 0.22, h - 0.75), (-d / 2, 1.0), (-d / 2, 0.0)][:-1]
    t = 0.05
    for s in (-1, 1):
        x0, x1 = (s * w / 2 - t, s * w / 2) if s > 0 else (s * w / 2, s * w / 2 + t)
        n = len(prof)
        verts = [(x0, y, z) for y, z in prof] + [(x1, y, z) for y, z in prof]
        faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        k.B.add((verts, faces), "fabricTerracotta")
    k.rb("fabricCream", 0, 0.05, 0.0, w - 0.1, d - 0.12, 1.0, 0.02)
    k.rb("fabricMustard", 0, -d / 2 + 0.05, 0.0, w - 0.1, 0.04, 0.12, 0.01)
    xf = K.T(0, -d / 2 + 0.17, h - 0.5) @ K.R("X", 14)
    k.B.add(K.rbox(w - 0.1, 0.06, 0.48, 0.015), "screen", xf @ K.T(0, 0.03, -0.24))
    k.B.add(K.rbox(w - 0.2, 0.006, 0.38, 0.003, 1), "screenGlow", xf @ K.T(0, -0.004, -0.19))
    k.rb("fabricMustard", 0, -d / 2 + 0.13, h - 0.2, w - 0.1, 0.1, 0.18, 0.015)
    k.rb("paper", 0, -d / 2 + 0.077, h - 0.17, w - 0.2, 0.006, 0.12, 0.003, 1)
    xf = K.T(0, -d / 2 + 0.14, 1.0) @ K.R("X", -12)
    k.B.add(K.rbox(w - 0.1, 0.26, 0.05, 0.015), "fabricCream", xf)
    k.B.add(K.cyl(0.01, 0.08, 8), "metal", xf @ K.T(-0.15, 0.0, 0.05))
    k.B.add(K.ellipsoid(0.025, 0.025, 0.025, 10, 6), "accent", xf @ K.T(-0.15, 0.0, 0.13))
    for i, m in enumerate(("fabricBlue", "accent", "fabricGreen")):
        k.B.add(K.cyl(0.02, 0.02, 10), m, xf @ K.T(0.03 + i * 0.07, 0.02, 0.05))
    k.rb("woodDark", 0, 0, 0, w, d, 0.04, 0.01)


def g_board_table(k, w, d, h):
    g_table(k, w, d, h, "wood", "woodDark", 0.08, 0.05)
    n = 8
    s = 0.5 / n
    for i in range(n):
        for j in range(n):
            if (i + j) % 2:
                k.bx("woodDark", -0.25 + s * (i + 0.5), -0.25 + s * (j + 0.5), h, s, s, 0.002)
            else:
                k.bx("woodLight", -0.25 + s * (i + 0.5), -0.25 + s * (j + 0.5), h, s, s, 0.002)
    for i in range(6):
        m = "accent" if i < 3 else "white"
        x = -0.25 + s * (1.5 + 2 * (i % 3))
        y = -0.25 + s * (0.5 if i < 3 else 7.5)
        k.cy(m, x, y, h + 0.002, 0.022, 0.014, 12)


def g_treadmill(k, w, d, h):
    k.rb("rubber", 0, -0.08, 0.0, w - 0.1, d - 0.16, 0.16, 0.04)
    k.rb("screen", 0, -0.1, 0.16, w - 0.3, d - 0.4, 0.008, 0.003, 1)
    for s in (-1, 1):
        k.rb("metalLight", s * (w / 2 - 0.1), -0.08, 0.14, 0.08, d - 0.2, 0.05, 0.015)
        k.rod("metal", (s * (w / 2 - 0.08), d / 2 - 0.35, 0.16), (s * (w / 2 - 0.08), d / 2 - 0.12, h - 0.18), 0.03, 10)
        k.rod("metalLight", (s * (w / 2 - 0.022), d / 2 - 0.16, h - 0.25), (s * (w / 2 - 0.022), d / 2 - 0.55, h - 0.38), 0.022, 8)
    k.rb("fabricGreen", 0, d / 2 - 0.1, h - 0.24, w - 0.1, 0.2, 0.24, 0.05)
    xf = K.T(0, d / 2 - 0.18, h - 0.14) @ K.R("X", -30)
    k.B.add(K.rbox(0.36, 0.006, 0.12, 0.003, 1), "screenGlow", xf)
    k.rb("accent", 0.28, d / 2 - 0.2, h - 0.04, 0.05, 0.05, 0.04, 0.012)
    k.rb("woodDark", 0, -d / 2 + 0.08, 0.0, w - 0.16, 0.12, 0.08, 0.03)


def g_exercise_bike(k, w, d, h):
    for y in (-d / 2 + 0.04, d / 2 - 0.04):
        k.rb("metal", 0, y, 0, w, 0.08, 0.06, 0.03)
    k.rod("metal", (0, -d / 2 + 0.06, 0.05), (0, d / 2 - 0.06, 0.05), 0.03, 10)
    k.rod("metal", (0, -0.2, 0.05), (0, -0.25, 0.72), 0.035, 10)
    k.rb("rubber", 0, -0.27, 0.72, 0.24, 0.3, 0.07, 0.03)
    k.rod("metal", (0, 0.12, 0.05), (0, 0.33, h - 0.18), 0.035, 10)
    xf = K.T(0, 0.12, 0.3) @ K.R("Y", 90)
    k.B.add(K.cyl(0.21, 0.06, 20, bevel=0.012), "accent", xf @ K.T(0, 0, -0.03))
    k.rod("metalLight", (-0.24, 0.25, h - 0.2), (0.24, 0.25, h - 0.2), 0.02, 8)
    for s in (-1, 1):
        k.rb("rubber", s * 0.26, 0.19, h - 0.22, 0.06, 0.14, 0.04, 0.015)
        k.rb("rubber", s * 0.13, 0.02, 0.26, 0.1, 0.05, 0.025, 0.01, 1)
    k.rb("screen", 0, 0.36, h - 0.14, 0.22, 0.08, 0.12, 0.02)
    xf = K.T(0, 0.33, h - 0.085) @ K.R("X", 20)
    k.B.add(K.rbox(0.17, 0.006, 0.08, 0.003, 1), "screenGlow", xf)


def g_exercise_mat(k, w, d, h):
    k.rb("fabricSage", 0, 0, 0, w, d, h, 0.008, 1)
    for i in range(3):
        k.rb("fabricCream", -w / 2 + 0.25 + i * 0.6, 0, h - 0.0005, 0.04, d - 0.1, 0.001, 0.0004, 1)


def g_dumbbell_rack(k, w, d, h):
    for s in (-1, 1):
        x = s * (w / 2 - 0.025)
        k.rod("metal", (x, -d / 2 + 0.025, 0.0), (x, 0.0, h - 0.006), 0.025, 8)
        k.rod("metal", (x, d / 2 - 0.025, 0.0), (x, 0.0, h - 0.006), 0.025, 8)
    tiers = ((-0.1, 0.40, 0.0), (0.08, h - 0.15, 0.0))
    for y, z, _ in tiers:
        k.rb("metal", 0, y, z, w - 0.04, 0.16, 0.03, 0.01, 1)
    colors = ("accent", "fabricMustard", "fabricBlue", "fabricGreen")
    for t, (y, z, _) in enumerate(tiers):
        for i in range(4):
            x = -w / 2 + 0.18 + i * 0.27
            r = 0.045 - t * 0.01 - i * 0.004
            xf = K.T(x, y, z + 0.03 + r)
            k.B.add(K.rod((-0.08, 0, 0), (0.08, 0, 0), 0.012, 6), "metalLight", xf)
            for e in (-1, 1):
                k.B.add(K.cyl(r, 0.05, 6, bevel=0.006), "rubber", xf @ K.T(e * 0.08, 0, 0) @ K.R("Y", 90) @ K.T(0, 0, -0.025))
                k.B.add(K.cyl(r * 0.6, 0.006, 10), colors[i], xf @ K.T(e * 0.106, 0, 0) @ K.R("Y", 90) @ K.T(0, 0, -0.003))


def g_stair_u(k, w, d, h):
    stair_mesh(k.B, [w, d, h], h)


def g_lift(k, w, d, h):
    lift_mesh(k.B, [w, d, h], h)


GENERATORS = {
    "desk": g_desk, "desk_exec": lambda k, w, d, h: g_desk(k, w, d, h, True), "chair": g_chair,
    "chair_guest": g_chair_guest, "stool": g_stool, "meeting_table": g_meeting_table, "round_table": g_round_table,
    "high_table": g_high_table, "dining_table": g_dining_table, "coffee_table": g_coffee_table,
    "work_table": g_work_table, "plan_table": g_plan_table, "drafting_table": g_drafting_table,
    "reception_desk": g_reception_desk, "sofa": g_sofa, "armchair": g_armchair, "beanbag": g_beanbag,
    "bench": g_bench, "bookshelf": g_bookshelf, "model_shelf": g_model_shelf, "tool_cabinet": g_tool_cabinet,
    "storage_shelf": g_storage_shelf, "locker": g_locker, "whiteboard": g_whiteboard,
    "wall_display": g_wall_display, "gallery_panel": g_gallery_panel, "poster": g_poster,
    "directory_sign": g_directory_sign, "easel": g_easel, "plant_large": g_plant_large,
    "plant_small": g_plant_small, "planter_box": g_planter_box, "tree_planter": g_tree_planter,
    "pantry_counter": g_pantry_counter, "coffee_bar": g_coffee_bar, "fridge": g_fridge, "sink": g_sink,
    "wc": g_wc, "partition": g_partition, "shower_stall": g_shower_stall, "rack_42u": g_rack_42u,
    "lab_bench": g_lab_bench, "lab_rack_open": g_lab_rack_open, "billiard_table": g_billiard_table,
    "cue_rack": g_cue_rack, "media_console": g_media_console, "arcade_cabinet": g_arcade_cabinet,
    "board_table": g_board_table, "treadmill": g_treadmill, "exercise_bike": g_exercise_bike,
    "exercise_mat": g_exercise_mat, "dumbbell_rack": g_dumbbell_rack, "stair_u": g_stair_u, "lift": g_lift,
}
# building generators use their own material slot names; map them onto the palette
ALIAS = {"stair_tread": "wood", "stair_nosing": "woodDark", "stair_core": "wallInterior", "lift_shaft": "wallExterior",
         "lift_door": "metalLight", "lift_frame": "metal"}


def palette_materials():
    env, _, art = K.parse_palette()
    M = K.Materials()
    mats = {}
    for name, hexc in env.items():
        rough = 0.45 if name in ("screen", "screenGlow", "glass") else 0.82
        mats[name] = M.get(name, hexc, rough=rough, emit=0.6 if name == "screenGlow" else 0.0)
    for i, key in enumerate(("art_a", "art_b", "art_c")):
        mats[key] = M.get(key, art["ART-01"][i])
    g = mats["glass"]
    g.blend_method = "BLEND"
    g.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.45
    for a, b in ALIAS.items():
        mats[a] = mats[b]
    return mats


def build(only=None):
    catalog, assets = FS.load_catalog()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = palette_materials()
    col = bpy.data.collections.new("furniture")
    bpy.context.scene.collection.children.link(col)
    results = {}
    types = [only] if only else list(catalog)
    for t in types:
        w, d, h = catalog[t]["size"]
        k = Kit(f"FURN-{t}", f"kantor-rpg:furniture:{t}")
        GENERATORS[t](k, w, d, h)
        ob = K.make_object(k.B, mats, col, clean=True, autosmooth=35)
        ob.data.name = t
        mn, mx = K.world_bbox([ob])
        # re-centre only; the residual shows how far the drawing drifted from the catalog
        shift = Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))
        ob.data.transform(K.T(*shift))
        mn, mx = K.world_bbox([ob])
        dims = [round(mx.x - mn.x, 4), round(mx.y - mn.y, 4), round(mx.z - mn.z, 4)]
        err = max(abs(a - b) for a, b in zip(dims, (w, d, h)))
        ob["kantor_type"] = t
        ob["kantor_asset"] = assets.get(t, "")
        ob["kantor_size"] = [w, d, h]
        ob["kantor_front"] = "-Y blender / +Z glTF"
        if t in FS.MOUNT_HEIGHT_M:
            ob["kantor_mount_height_m"] = FS.MOUNT_HEIGHT_M[t]
        tris = K.tri_count(ob)
        budget = FS.tri_budget((w, d, h))
        results[t] = {"dims": dims, "err": err, "tris": tris, "budget": budget, "shift": [round(v, 4) for v in shift]}
        flag = "OK" if err <= FS.TOL_M and tris <= budget else "CHECK"
        print(f"FURN {t:15s} size={dims} catalog={[w, d, h]} err={err:.3f} tris={tris}/{budget} "
              f"shift={results[t]['shift']} {flag}")
    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    if not only:
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND), compress=True)
    for ob in list(col.objects):
        K.export_glb(FS.glb_path(ob["kantor_type"]), [ob])
    bad = [t for t, r in results.items() if r["err"] > FS.TOL_M or r["tris"] > r["budget"]]
    print(f"FURNITURE_DONE types={len(results)} out_of_spec={bad}")
    return bad


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    try:
        bad = build(only)
    except Exception:
        import traceback
        traceback.print_exc()
        print("FURNITURE_FAILED")
        sys.exit(1)
    sys.exit(1 if bad else 0)
