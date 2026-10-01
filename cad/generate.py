"""Concept drawing generator: design/world.json -> DXF (mm) + vector PDF + previews.

Usage:
  python3 cad/generate.py --sheets A-101 A-102
  python3 cad/generate.py --all-available

Both the DXF and the PDF are drawn from one in-memory plan model built from the
world dataset (walls via tools/kantor/geometry.derive_walls), so a dimension,
door or fixture cannot differ between the two outputs. The PDF is drawn
directly with ReportLab; it is not a raster or a conversion of the DXF.

Native DWG is not produced here: AutoCAD is not available in the container
(see cad/AUTOCAD-RUNBOOK.md). Never rename the DXF to .dwg.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.kantor.fonts import font_source_note, register  # noqa: E402
from tools.kantor.geometry import (  # noqa: E402
    derive_walls, fixture_corners, load_world, point_in_polygon, polygon_area, polygon_edges, room_at)

GENERATOR = "cad/generate.py"
GENERATOR_VERSION = "1"
SHEETS_PATH = ROOT / "design" / "sheets.json"
WORLD_PATH = ROOT / "design" / "world.json"
IMPLEMENTED_CONTENT = {"plan"}
PAPER_MM = {"A1": (841, 594), "A2": (594, 420), "A3": (420, 297)}
PT_PER_MM = 72 / 25.4
APPID = "KANTOR_RPG"
DRAWN_BY = "Claude Code cloud (generator)"
CHECKED_BY = "Max (supervisor) belum review"
STATUS = "KONSEP"

# Palette from DESIGN.md: deep green ink, warm grey furniture, terracotta used
# for exactly one accent (vertical circulation) so it reads as "the way up".
GREEN = "#1f4d3a"
WALL_INT = "#4e7a64"
INK = "#22302a"
GREY_TEXT = "#5a524b"
FURN = "#8a8076"
TERRA = "#b5532f"
GRID = "#8fa99b"
DIM = "#2f4238"
PAPER = "#ffffff"

# Short paraphrases for the sheet; the full text lives in world.json and the
# generator refuses to run if an ID disappears there.
ASSUMPTION_SHORT = {
    "AS-DIM-01": "Footprint 32 x 24 m dan tinggi antar lantai 4,0 m adalah proposal PRD, bukan lahan yang disahkan.",
    "AS-DIM-02": "Polygon ruang diukur di as dinding; luas = luas as-drawn, bukan luas bersih.",
    "AS-DIM-03": "Tebal dinding konsep luar 0,30 m, dalam 0,15 m; plafon 3,0 m; belum ada desain struktur.",
    "AS-DIM-04": "Ukuran furniture dari catalog adalah target konsep, bukan katalog vendor.",
    "AS-DIM-05": "Tangga U 24 riser x 0,1667 m, tread 0,28 m, lebar flight 1,2 m: target konsep, bukan tangga layak konstruksi.",
    "AS-OCC-02": "Kapasitas kursi dihitung dari fixture, bukan target okupansi yang diputuskan.",
}
# AS-DIM-05 values used to draw the U stair.
STAIR_RISERS_PER_FLIGHT = 12
STAIR_TREAD = 0.28
STAIR_FLIGHT_W = 1.2

# Paper-mm offsets of the annotation ring outside the exterior wall line. The
# first chain clears a 1.2 m outward exit leaf (12 mm at 1:100 plus the wall).
CHAIN_OFFSETS_MM = (16.0, 23.0, 30.0)
BUBBLE_MM = 40.0
BUBBLE_R_MM = 4.0
RING_MM = BUBBLE_MM + BUBBLE_R_MM + 1.0
TITLE_STRIP_MM = 36.0

LAYERS = {
    # name: (ACI, rgb, lineweight 1/100 mm, linetype, plot)
    "A-WALL": (3, (31, 77, 58), 50, "Continuous", True),
    "A-DOOR": (3, (31, 77, 58), 25, "Continuous", True),
    "A-DOOR-IDEN": (8, (61, 90, 76), 13, "Continuous", True),
    "A-AREA": (9, (160, 180, 170), 13, "Continuous", False),
    "A-ANNO-RMNM": (7, (34, 48, 42), 18, "Continuous", True),
    "A-FURN": (8, (138, 128, 118), 18, "Continuous", True),
    "A-FURN-IDEN": (8, (138, 128, 118), 9, "Continuous", True),
    "A-STRS": (30, (181, 83, 47), 25, "Continuous", True),
    "A-ANNO-DIMS": (7, (47, 66, 56), 18, "Continuous", True),
    "A-GRID": (8, (143, 169, 155), 13, "CENTER", True),
    "A-GRID-IDEN": (8, (47, 66, 56), 18, "Continuous", True),
    "A-ANNO-TTLB": (3, (31, 77, 58), 35, "Continuous", True),
    "A-ANNO-NOTE": (7, (34, 48, 42), 18, "Continuous", True),
    "A-ANNO-WMRK": (9, (232, 238, 234), 13, "Continuous", True),
    "A-ANNO-VPRT": (8, (128, 128, 128), 13, "Continuous", False),
}
REQUIRED_LAYERS = ["A-WALL", "A-DOOR", "A-AREA", "A-ANNO-RMNM", "A-FURN", "A-FURN-IDEN", "A-STRS",
                   "A-ANNO-DIMS", "A-GRID", "A-ANNO-TTLB"]


# --------------------------------------------------------------------------- helpers

def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fmt_area(a: float) -> str:
    return f"{a:.2f}".replace(".", ",") + " m²"


def fmt_elev(v: float) -> str:
    return "\u00b10,00" if abs(v) < 1e-9 else f"{v:+.2f}".replace(".", ",")


def fmt_m(v: float) -> str:
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


def hex_rgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def contrast_ratio(fg: str, bg: str = PAPER) -> float:
    def lum(c):
        out = []
        for v in hex_rgb(c):
            v /= 255
            out.append(v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4)
        r, g, b = out
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    a, b = sorted((lum(fg), lum(bg)), reverse=True)
    return (a + 0.05) / (b + 0.05)


def load_sheets() -> dict:
    return json.loads(SHEETS_PATH.read_text(encoding="utf-8"))


def floor_of(world, floor_id):
    return next(f for f in world["floors"] if f["id"] == floor_id)


def rect_overlap(a, b) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0.0


def poly_centroid(poly):
    a = 0.0
    cx = cy = 0.0
    for (x0, y0), (x1, y1) in polygon_edges(poly):
        cr = x0 * y1 - x1 * y0
        a += cr
        cx += (x0 + x1) * cr
        cy += (y0 + y1) * cr
    a /= 2
    return cx / (6 * a), cy / (6 * a)


def scale_bar_geometry(den: int, origin_mm=(0.0, 0.0), marks=(0, 1, 2, 5, 10)) -> dict:
    """Paper positions of the graphic scale bar ticks.

    Exposed so tests can assert the bar is true to scale (10 m at 1:100 = 100 mm
    = 283.46 pt) using the very numbers the PDF writer draws.
    """
    x0, y0 = origin_mm
    xs_mm = [x0 + m * 1000.0 / den for m in marks]
    return {"marks_m": list(marks), "x_mm": xs_mm, "x_pt": [x * PT_PER_MM for x in xs_mm],
            "y_mm": y0, "height_mm": 2.2,
            "length_pt": (xs_mm[-1] - xs_mm[0]) * PT_PER_MM, "length_mm": xs_mm[-1] - xs_mm[0]}


# --------------------------------------------------------------------------- plan model

def building_grid(world) -> dict:
    """Concept reference grid derived from room edges.

    Y lines: horizontal room edges spanning the full envelope width on every
    floor (the band boundaries). X lines: envelope edges plus vertical room
    edges that continue through at least two bands on some floor. This is a
    reading aid, not a structural grid (AS-DIM-03).
    """
    floors = world["floors"]
    env = floors[0]["envelope"]
    xmin, xmax = min(p[0] for p in env), max(p[0] for p in env)
    ymin, ymax = min(p[1] for p in env), max(p[1] for p in env)

    def h_lines(fid):
        lines = {}
        for r in world["rooms"]:
            if r["floor"] != fid:
                continue
            for (x0, y0), (x1, y1) in polygon_edges(r["polygon"]):
                if y0 == y1:
                    lines.setdefault(y0, []).append((min(x0, x1), max(x0, x1)))
        full = set()
        for y, iv in lines.items():
            iv.sort()
            reach = xmin
            for a, b in iv:
                if a <= reach + 1e-9:
                    reach = max(reach, b)
            if reach >= xmax - 1e-9:
                full.add(y)
        return full

    ys = sorted(set.intersection(*[h_lines(f["id"]) for f in floors]) | {ymin, ymax})
    bands = list(zip(ys, ys[1:]))
    xs = {xmin, xmax}
    for f in floors:
        count = {}
        for r in world["rooms"]:
            if r["floor"] != f["id"]:
                continue
            for (x0, y0), (x1, y1) in polygon_edges(r["polygon"]):
                if x0 != x1:
                    continue
                lo, hi = min(y0, y1), max(y0, y1)
                for i, (b0, b1) in enumerate(bands):
                    if min(hi, b1) - max(lo, b0) > 1e-9:
                        count.setdefault(x0, set()).add(i)
        xs |= {x for x, s in count.items() if len(s) >= 2}
    letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    return {"x": [{"label": str(i + 1), "at": x} for i, x in enumerate(sorted(xs))],
            "y": [{"label": letters[i], "at": y} for i, y in enumerate(ys)],
            "extent": (xmin, ymin, xmax, ymax)}


def _wall_rect(wall, openings):
    """Rectangle of a wall piece. Square caps (t/2) close corners and T-junctions,
    but an end that is a door jamb gets no cap, otherwise the cap would narrow the
    clear opening by t/2 on each side."""
    t = wall["thickness"] / 2
    jambs = [o for o in openings if o["axis"] == wall["axis"] and abs(o["at"] - wall["at"]) < 1e-9]
    cap0 = 0.0 if any(abs(wall["from"] - o["to"]) < 1e-6 for o in jambs) else t
    cap1 = 0.0 if any(abs(wall["to"] - o["from"]) < 1e-6 for o in jambs) else t
    if wall["axis"] == "x":
        return (wall["from"] - cap0, wall["at"] - t, wall["to"] + cap1, wall["at"] + t)
    return (wall["at"] - t, wall["from"] - cap0, wall["at"] + t, wall["to"] + cap1)


def _door_symbol(world, floor_id, op, door, walls, env_box):
    axis, at = op["axis"], op["at"]
    same = [w for w in walls if w["axis"] == axis and abs(w["at"] - at) < 1e-9]
    if same:
        t = same[0]["thickness"]
    else:
        on_env = at in ((env_box[1], env_box[3]) if axis == "x" else (env_box[0], env_box[2]))
        t = world["building"]["wall"]["exterior" if on_env else "interior"]
    mid = (op["from"] + op["to"]) / 2

    def to_world(u, v):
        return (u, at + v) if axis == "x" else (at + v, u)

    def side_room(sign):
        return room_at(world, floor_id, to_world(mid, sign * 0.05)) or "EXT"

    plus, minus = side_room(+1), side_room(-1)
    cats = {r["id"]: r["category"] for r in world["rooms"]}
    a, b = door["rooms"]
    # Drawing convention (world.json stores no swing): exits swing outward in the
    # egress direction; other doors swing away from circulation into the room.
    if door["exit"] and "EXT" in (a, b):
        target = "EXT"
    elif cats.get(a) == "circulation" and cats.get(b) != "circulation":
        target = b
    elif cats.get(b) == "circulation" and cats.get(a) != "circulation":
        target = a
    else:
        target = b
    sign = +1 if target == plus else -1
    ref = target if target != "EXT" else (minus if sign > 0 else plus)
    # Hinge on the jamb nearest the reference room's corner so the open leaf
    # rests against the side wall.
    hinge_from = True
    rp = next((r["polygon"] for r in world["rooms"] if r["id"] == ref), None)
    if rp:
        for p, q in polygon_edges(rp):
            if axis == "x" and p[1] == q[1] == at:
                e0, e1 = sorted((p[0], q[0]))
            elif axis == "y" and p[0] == q[0] == at:
                e0, e1 = sorted((p[1], q[1]))
            else:
                continue
            if e0 - 1e-9 <= mid <= e1 + 1e-9:
                hinge_from = (op["from"] - e0) <= (e1 - op["to"])
                break
    w = op["to"] - op["from"]
    vf = sign * t / 2
    sym = {"id": door["id"], "type": door["type"], "width": w, "axis": axis, "at": at, "thickness": t,
           "sign": sign, "target": target, "leaves": [], "arcs": [], "dashed": [], "panels": [], "lines": []}

    def vec_angle(du, dv):
        x, y = (du, dv) if axis == "x" else (dv, du)
        return math.degrees(math.atan2(y, x)) % 360

    def leaf(hu, direction, length):
        hinge = to_world(hu, vf)
        tip = to_world(hu, vf + sign * length)
        sym["leaves"].append((hinge, tip))
        a_closed = vec_angle(direction * length, 0)
        a_open = vec_angle(0, sign * length)
        if abs(((a_open - a_closed) % 360) - 90) < 1e-6:
            start, end = a_closed, a_open
        else:
            start, end = a_open, a_closed
        sym["arcs"].append((hinge, length, start, end))

    kind = door["type"]
    if kind == "single":
        if hinge_from:
            leaf(op["from"], +1, w)
        else:
            leaf(op["to"], -1, w)
    elif kind == "double":
        leaf(op["from"], +1, w / 2)
        leaf(op["to"], -1, w / 2)
    elif kind == "sliding":
        pw = 0.55 * w
        for u0, u1, v in ((op["from"], op["from"] + pw, -0.035), (op["to"] - pw, op["to"], 0.035)):
            pts = [to_world(u0, v - 0.02), to_world(u1, v - 0.02), to_world(u1, v + 0.02), to_world(u0, v + 0.02)]
            sym["panels"].append(pts)
    elif kind == "hatch":
        pts = [to_world(op["from"], -t / 2), to_world(op["to"], -t / 2), to_world(op["to"], t / 2),
               to_world(op["from"], t / 2)]
        sym["panels"].append(pts)
        sym["lines"].append((pts[0], pts[2]))
        sym["lines"].append((pts[1], pts[3]))
    else:  # opening: head line above the gap on both faces
        for v in (-t / 2, t / 2):
            sym["dashed"].append((to_world(op["from"], v), to_world(op["to"], v)))
    # Swing envelope (for keeping room tags clear) and tag on the non-swing side.
    span = w if kind == "single" else w / 2 if kind == "double" else 0.0
    p0 = to_world(op["from"], vf)
    p1 = to_world(op["to"], vf + sign * span)
    sym["swing_box"] = (min(p0[0], p1[0]), min(p0[1], p1[1]), max(p0[0], p1[0]), max(p0[1], p1[1]))
    sym["tag_pos"] = to_world(mid, -sign * (t / 2 + 0.3))
    sym["tag_rot"] = 0 if axis == "x" else 90
    return sym


def _fixture_local(fx, lx, ly):
    r = math.radians(fx["rot"])
    c, s = math.cos(r), math.sin(r)
    return (fx["pos"][0] + lx * c - ly * s, fx["pos"][1] + lx * s + ly * c)


def _vertical_links(world, floor_id):
    levels = {f["id"]: f["level"] for f in world["floors"]}
    vls = {v["id"]: v for v in world["verticalLinks"]}
    out = []
    for fx in world["fixtures"]:
        if fx["floor"] != floor_id or fx["type"] not in ("stair_u", "lift"):
            continue
        vl = vls.get(fx.get("verticalLink"))
        W, L = fx["size"][:2]
        item = {"id": fx["id"], "vl": vl["id"] if vl else None, "type": fx["type"],
                "outline": fixture_corners(fx), "lines": [], "arrow": [], "label": None, "label_pos": None,
                "polys": []}
        if fx["type"] == "stair_u":
            hw, hl = W / 2, L / 2
            gap = W - 2 * STAIR_FLIGHT_W
            run = (STAIR_RISERS_PER_FLIGHT - 1) * STAIR_TREAD
            y_land = -hl + run
            inner = gap / 2
            for x0, x1 in ((-hw, -inner), (inner, hw)):
                for k in range(STAIR_RISERS_PER_FLIGHT):
                    y = -hl + k * STAIR_TREAD
                    item["lines"].append((_fixture_local(fx, x0, y), _fixture_local(fx, x1, y)))
            for x in (-inner, inner):
                item["lines"].append((_fixture_local(fx, x, -hl), _fixture_local(fx, x, y_land)))
            end = next((e for e in (vl or {}).get("ends", []) if e["floor"] == floor_id), None)
            first = -1.0
            if end:
                dx, dy = end["point"][0] - fx["pos"][0], end["point"][1] - fx["pos"][1]
                r = math.radians(fx["rot"])
                first = -1.0 if (dx * math.cos(r) + dy * math.sin(r)) < 0 else 1.0
            xf = first * (inner + STAIR_FLIGHT_W / 2)
            ytop = y_land + (hl - y_land) / 2
            item["arrow"] = [_fixture_local(fx, xf, -hl + 0.15), _fixture_local(fx, xf, ytop),
                             _fixture_local(fx, -xf, ytop), _fixture_local(fx, -xf, -hl + 0.45)]
            lowest = min(levels[e["floor"]] for e in vl["ends"]) if vl else levels[floor_id]
            item["label"] = "NAIK" if levels[floor_id] == lowest else "TURUN"
            item["label_pos"] = _fixture_local(fx, xf, -hl - 0.28)
            if item["label"] == "NAIK":
                # Cut line where the plan section plane crosses the up flight.
                xa, xb = xf - STAIR_FLIGHT_W / 2, xf + STAIR_FLIGHT_W / 2
                yb = -hl + run * 0.55
                item["break"] = [_fixture_local(fx, xa, yb - 0.25), _fixture_local(fx, xf - 0.08, yb - 0.05),
                                 _fixture_local(fx, xf + 0.02, yb - 0.2), _fixture_local(fx, xb, yb + 0.15)]
        else:
            inset = 0.12
            car = [_fixture_local(fx, sx * (W / 2 - inset), sy * (L / 2 - inset))
                   for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            item["polys"].append(car)
            item["lines"].append((car[0], car[2]))
            item["lines"].append((car[1], car[3]))
            # Front (local -Y) is the landing door side.
            item["door"] = (_fixture_local(fx, -0.45, -L / 2), _fixture_local(fx, 0.45, -L / 2))
            item["label"] = "LIFT"
            item["label_pos"] = _fixture_local(fx, 0, 0)
        out.append(item)
    return out


def _dim_chains(world, floor_id, grid, den):
    env = floor_of(world, floor_id)["envelope"]
    xmin, xmax = min(p[0] for p in env), max(p[0] for p in env)
    ymin, ymax = min(p[1] for p in env), max(p[1] for p in env)
    rooms = [r for r in world["rooms"] if r["floor"] == floor_id]

    def edge_values(fixed_axis, value):
        vals = set()
        for r in rooms:
            for (x0, y0), (x1, y1) in polygon_edges(r["polygon"]):
                if fixed_axis == "y" and y0 == y1 == value:
                    vals |= {x0, x1}
                if fixed_axis == "x" and x0 == x1 == value:
                    vals |= {y0, y1}
        return sorted(vals)

    pw = den / 1000.0  # paper mm -> world m
    chains = []
    south = edge_values("y", ymin)
    gx = [g["at"] for g in grid["x"]]
    gy = [g["at"] for g in grid["y"]]
    o1, o2, o3 = (o * pw for o in CHAIN_OFFSETS_MM)
    chains.append({"side": "S", "offset": o1, "values": south, "kind": "ruang"})
    if gx != south:
        chains.append({"side": "S", "offset": o2, "values": gx, "kind": "grid"})
    chains.append({"side": "S", "offset": o3 if gx != south else o2, "values": [xmin, xmax], "kind": "total"})
    west = edge_values("x", xmin)
    chains.append({"side": "W", "offset": o1, "values": west, "kind": "ruang"})
    if gy != west:
        chains.append({"side": "W", "offset": o2, "values": gy, "kind": "grid"})
    chains.append({"side": "W", "offset": o3 if gy != west else o2, "values": [ymin, ymax], "kind": "total"})
    chains.append({"side": "N", "offset": o1, "values": edge_values("y", ymax), "kind": "ruang"})
    chains.append({"side": "E", "offset": o1, "values": edge_values("x", xmax), "kind": "ruang"})
    for c in chains:
        c["segments"] = list(zip(c["values"], c["values"][1:]))
    return chains, (xmin, ymin, xmax, ymax)


class TagFonts:
    def __init__(self):
        from reportlab.pdfbase.pdfmetrics import stringWidth
        self.fonts = register()
        self.sw = stringWidth
        self.regular = self.fonts["KR-Sans"]
        self.medium = self.fonts["KR-Sans-Medium"]
        self.bold = self.fonts["KR-Sans-Bold"]

    def width(self, text, font, size):
        return self.sw(text, font, size)


def _tag_lines(room, area, tf, scale, compact=False):
    """Full tag = ID, name, area. Compact tag (ID + area) is for rooms too small
    for a legible full tag; their names stay readable in the sheet's room list."""
    from reportlab.lib.utils import simpleSplit
    id_size, name_size, area_size = 7.5 * scale, 6.6 * scale, 6.4 * scale
    lines = [(room["id"], tf.bold, id_size, "id")]
    if not compact:
        name_lines = simpleSplit(room["name"], tf.regular, name_size, 34 * PT_PER_MM * max(scale, 0.8))
        lines += [(n, tf.regular, name_size, "name") for n in name_lines]
    lines.append((fmt_area(area), tf.medium, area_size, "area"))
    return lines


def _layout_room_tags(rooms, wall_rects, obstacles, tf, den):
    """Pick a tag position per room that stays inside the room, off the walls,
    and overlaps as little furniture, swing and door-tag area as possible."""
    pt_per_m = 1000.0 / den * PT_PER_MM
    # Compact tags sit in shafts and risers, so they get a tighter clearance.
    tags = {}
    for room in rooms:
        poly = room["polygon"]
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        cx, cy = poly_centroid(poly)
        best = None
        for compact, scale in ((False, 1.0), (False, 0.86), (False, 0.76), (True, 0.8), (True, 0.7)):
            lines = _tag_lines(room, room["area"], tf, scale, compact)
            pad = 0.02 if compact else 0.06
            w_pt = max(tf.width(t, f, s) for t, f, s, _ in lines) + (1.5 if compact else 3)
            h_pt = sum(s * 1.16 for _, _, s, _ in lines) + 2
            w, h = w_pt / pt_per_m, h_pt / pt_per_m
            step = 0.1
            nx = int((max(xs) - min(xs)) / step) + 1
            ny = int((max(ys) - min(ys)) / step) + 1
            for i in range(nx):
                for j in range(ny):
                    px, py = min(xs) + i * step, min(ys) + j * step
                    box = (px - w / 2 - pad, py - h / 2 - pad, px + w / 2 + pad, py + h / 2 + pad)
                    corners = [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]
                    if not all(point_in_polygon(c, poly) for c in corners):
                        continue
                    if any(rect_overlap(box, wr) > 1e-9 for wr in wall_rects):
                        continue
                    hit = sum(rect_overlap(box, ob) for ob in obstacles)
                    cost = hit * 40 + math.hypot(px - cx, py - cy) + (1 - scale) * 6
                    if best is None or cost < best["cost"]:
                        best = {"cost": cost, "pos": (px, py), "lines": lines, "box_m": (w, h), "scale": scale,
                                "overlap_m2": hit, "compact": compact}
            if best is not None and best["overlap_m2"] < 1e-6:
                break
        if best is None:
            lines = _tag_lines(room, room["area"], tf, 0.7, True)
            best = {"cost": 1e9, "pos": (cx, cy), "lines": lines, "scale": 0.7, "overlap_m2": None, "compact": True,
                    "box_m": (max(tf.width(t, f, s) for t, f, s, _ in lines) / pt_per_m,
                              sum(s * 1.16 for _, _, s, _ in lines) / pt_per_m), "forced": True}
        tags[room["id"]] = best
    return tags


def build_plan(world, floor_id, den=100, tf=None):
    tf = tf or TagFonts()
    walls, openings = derive_walls(world, floor_id)
    env = floor_of(world, floor_id)["envelope"]
    env_box = (min(p[0] for p in env), min(p[1] for p in env), max(p[0] for p in env), max(p[1] for p in env))
    doors = {d["id"]: d for d in world["doors"]}
    wall_items = [{**w, "rect": _wall_rect(w, openings)} for w in walls]
    door_items = [_door_symbol(world, floor_id, op, doors[op["door"]], walls, env_box) for op in openings]
    rooms = []
    for r in world["rooms"]:
        if r["floor"] == floor_id:
            rooms.append({"id": r["id"], "name": r["name"], "category": r["category"], "polygon": r["polygon"],
                          "area": round(polygon_area(r["polygon"]), 4)})
    fixtures = [fx for fx in world["fixtures"]
                if fx["floor"] == floor_id and world["catalog"][fx["type"]].get("family") != "shell"]
    vlinks = _vertical_links(world, floor_id)
    grid = building_grid(world)
    chains, extent = _dim_chains(world, floor_id, grid, den)
    pt_per_m = 1000.0 / den * PT_PER_MM
    obstacles = []
    for fx in fixtures:
        pts = fixture_corners(fx)
        obstacles.append((min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts),
                          max(p[1] for p in pts)))
    for v in vlinks:
        pts = v["outline"]
        obstacles.append((min(p[0] for p in pts) - 0.1, min(p[1] for p in pts) - 0.45,
                          max(p[0] for p in pts) + 0.1, max(p[1] for p in pts) + 0.1))
    door_tag_size = 5.2
    for d in door_items:
        obstacles.append(d["swing_box"])
        tw = (tf.width(d["id"], tf.medium, door_tag_size) + 2) / pt_per_m
        th = (door_tag_size + 2) / pt_per_m
        x, y = d["tag_pos"]
        if d["tag_rot"] == 0:
            d["tag_box"] = (x - tw / 2, y - th / 2, x + tw / 2, y + th / 2)
        else:
            d["tag_box"] = (x - th / 2, y - tw / 2, x + th / 2, y + tw / 2)
        d["tag_size"] = door_tag_size
        obstacles.append(d["tag_box"])
    tags = _layout_room_tags(rooms, [w["rect"] for w in wall_items], obstacles, tf, den)
    return {"floor": floor_id, "den": den, "walls": wall_items, "openings": openings, "doors": door_items,
            "rooms": rooms, "fixtures": fixtures, "vlinks": vlinks, "grid": grid, "chains": chains,
            "extent": extent, "tags": tags, "fonts": tf}


# --------------------------------------------------------------------------- sheet layout (paper mm)

def sheet_layout(sheet, plan):
    pw_mm, ph_mm = PAPER_MM[sheet["size"]]
    frame = (20.0, 10.0, pw_mm - 10.0, ph_mm - 10.0)
    panel_w = 150.0
    panel = (frame[2] - panel_w, frame[1], frame[2], frame[3])
    zone = (frame[0], frame[1] + TITLE_STRIP_MM, panel[0], frame[3])
    den = plan["den"]
    x0, y0, x1, y1 = plan["extent"]
    ring = RING_MM
    bw, bh = (x1 - x0) * 1000 / den, (y1 - y0) * 1000 / den
    ox = zone[0] + ((zone[2] - zone[0]) - (bw + 2 * ring)) / 2 + ring - x0 * 1000 / den
    oy = zone[1] + ((zone[3] - zone[1]) - (bh + 2 * ring)) / 2 + ring - y0 * 1000 / den
    return {"paper": (pw_mm, ph_mm), "frame": frame, "panel": panel, "zone": zone, "origin": (ox, oy),
            "title_strip": (frame[0], frame[1], panel[0], frame[1] + TITLE_STRIP_MM),
            "scale_bar": scale_bar_geometry(den, (frame[0] + 160.0, frame[1] + 14.0))}


# --------------------------------------------------------------------------- DXF writer

def _setup_dxf(doc):
    import ezdxf
    from ezdxf import units
    doc.units = units.MM
    doc.header["$INSUNITS"] = 4
    doc.header["$MEASUREMENT"] = 1
    doc.header["$LUNITS"] = 2
    doc.header["$PSLTSCALE"] = 0
    doc.header["$LTSCALE"] = 1.0
    doc.appids.add(APPID)
    for name, (aci, rgb, lw, lt, plot) in LAYERS.items():
        layer = doc.layers.add(name, color=aci)
        layer.rgb = rgb
        layer.dxf.lineweight = lw
        layer.dxf.linetype = lt
        layer.dxf.plot = 1 if plot else 0
    if "KR-SANS" not in doc.styles:
        # DejaVu Sans: freely licensed and present on the build host; AutoCAD
        # substitutes via FONTALT when it is missing (see runbook).
        doc.styles.add("KR-SANS", font="DejaVuSans.ttf")
    ds = doc.dimstyles.new("KR-100")
    ds.dxf.dimscale = 100
    ds.dxf.dimtxt = 2.0
    ds.dxf.dimasz = 0.0
    ds.dxf.dimtsz = 1.0
    ds.dxf.dimexe = 1.5
    ds.dxf.dimexo = 1.0
    ds.dxf.dimgap = 0.8
    ds.dxf.dimdec = 0
    ds.dxf.dimtad = 1
    ds.dxf.dimtih = 0
    ds.dxf.dimtoh = 0
    ds.dxf.dimlunit = 2
    ds.dxf.dimtxsty = "KR-SANS"
    ds.dxf.dimclrd = 256
    ds.dxf.dimclre = 256
    ds.dxf.dimclrt = 256
    return ezdxf


def _xdata(entity, kind, ident, **extra):
    data = [(1000, kind), (1000, ident)]
    for k, v in extra.items():
        data.append((1000, f"{k}={v}"))
    entity.set_xdata(APPID, data)


def write_dxf(sheet, world, plan, layout, path: Path, generated_utc: str, world_sha: str) -> dict:
    import ezdxf
    doc = ezdxf.new("R2018", setup=True)
    _setup_dxf(doc)
    msp = doc.modelspace()
    k = 1000.0  # world m -> mm (world.json units.cadScale)
    assert world["units"]["cadScale"] == 1000
    den = plan["den"]

    def P(p):
        return (p[0] * k, p[1] * k)

    # Walls: one closed polyline + one solid hatch per derived wall piece.
    for w in plan["walls"]:
        x0, y0, x1, y1 = w["rect"]
        pts = [P((x0, y0)), P((x1, y0)), P((x1, y1)), P((x0, y1))]
        pl = msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "A-WALL"})
        _xdata(pl, "wall", f"{w['axis']}@{w['at']}:{w['from']}-{w['to']}",
               exterior=int(w["exterior"]), thickness=w["thickness"])
        h = msp.add_hatch(dxfattribs={"layer": "A-WALL"})
        h.set_solid_fill(color=3 if w["exterior"] else 94, rgb=hex_rgb(GREEN if w["exterior"] else WALL_INT))
        h.paths.add_polyline_path(pts, is_closed=True)

    for d in plan["doors"]:
        att = {"layer": "A-DOOR"}
        for hinge, tip in d["leaves"]:
            e = msp.add_line(P(hinge), P(tip), dxfattribs=att)
            _xdata(e, "door", d["id"], type=d["type"])
        for c, r, a0, a1 in d["arcs"]:
            e = msp.add_arc(P(c), r * k, a0, a1, dxfattribs=att)
            _xdata(e, "door", d["id"], type=d["type"])
        for a, b in d["dashed"]:
            e = msp.add_line(P(a), P(b), dxfattribs={**att, "linetype": "DASHED", "ltscale": 8})
            _xdata(e, "door", d["id"], type=d["type"])
        for a, b in d["lines"]:
            e = msp.add_line(P(a), P(b), dxfattribs=att)
            _xdata(e, "door", d["id"], type=d["type"])
        for poly in d["panels"]:
            e = msp.add_lwpolyline([P(p) for p in poly], close=True, dxfattribs=att)
            _xdata(e, "door", d["id"], type=d["type"])
        t = msp.add_text(d["id"], height=d["tag_size"] / PT_PER_MM * den * 0.72,
                         rotation=d["tag_rot"], dxfattribs={"layer": "A-DOOR-IDEN", "style": "KR-SANS"})
        t.set_placement(P(d["tag_pos"]), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        _xdata(t, "door", d["id"])

    for r in plan["rooms"]:
        pl = msp.add_lwpolyline([P(p) for p in r["polygon"]], close=True, dxfattribs={"layer": "A-AREA"})
        _xdata(pl, "room", r["id"], area_m2=f"{r['area']:.4f}")
        tag = plan["tags"][r["id"]]
        text = "\\P".join(t for t, _, _, _ in tag["lines"])
        # Cap height ~ 0.72 em, converted from the PDF point size at sheet scale.
        mt = msp.add_mtext(text, dxfattribs={"layer": "A-ANNO-RMNM", "style": "KR-SANS",
                                             "char_height": 6.6 * tag["scale"] / PT_PER_MM * den * 0.72})
        mt.set_location(P(tag["pos"]), attachment_point=5)
        _xdata(mt, "room", r["id"], area_m2=f"{r['area']:.4f}")

    for fx in plan["fixtures"]:
        pts = [P(p) for p in fixture_corners(fx)]
        pl = msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "A-FURN"})
        _xdata(pl, "fixture", fx["id"], type=fx["type"], room=fx["room"])
        t = msp.add_text(fx["id"], height=60, dxfattribs={"layer": "A-FURN-IDEN", "style": "KR-SANS"})
        t.set_placement(P(fx["pos"]), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        _xdata(t, "fixture", fx["id"])

    for v in plan["vlinks"]:
        att = {"layer": "A-STRS"}
        e = msp.add_lwpolyline([P(p) for p in v["outline"]], close=True, dxfattribs=att)
        _xdata(e, "vertical", v["id"], type=v["type"], link=v["vl"])
        for a, b in v["lines"]:
            msp.add_line(P(a), P(b), dxfattribs=att)
        for poly in v["polys"]:
            msp.add_lwpolyline([P(p) for p in poly], close=True, dxfattribs=att)
        if v.get("door"):
            msp.add_line(P(v["door"][0]), P(v["door"][1]), dxfattribs={**att, "lineweight": 50})
        if v["arrow"]:
            msp.add_lwpolyline([P(p) for p in v["arrow"]], dxfattribs=att)
            (ax, ay), (bx, by) = v["arrow"][-2], v["arrow"][-1]
            ang = math.atan2(by - ay, bx - ax)
            L, Wd = 0.3, 0.12
            tip = (bx, by)
            base = (bx - L * math.cos(ang), by - L * math.sin(ang))
            left = (base[0] - Wd * math.sin(ang), base[1] + Wd * math.cos(ang))
            right = (base[0] + Wd * math.sin(ang), base[1] - Wd * math.cos(ang))
            msp.add_solid([P(tip), P(left), P(right)], dxfattribs=att)
        if v.get("break"):
            msp.add_lwpolyline([P(p) for p in v["break"]], dxfattribs=att)
        if v["label"]:
            t = msp.add_text(v["label"], height=180, dxfattribs={**att, "style": "KR-SANS"})
            t.set_placement(P(v["label_pos"]), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        tid = msp.add_text(v["id"], height=60, dxfattribs={"layer": "A-FURN-IDEN", "style": "KR-SANS"})
        cx = sum(p[0] for p in v["outline"]) / 4
        cy = sum(p[1] for p in v["outline"]) / 4
        tid.set_placement(P((cx, cy)), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        _xdata(tid, "fixture", v["id"])

    pwm = den / 1000.0
    x0, y0, x1, y1 = plan["extent"]
    bub = BUBBLE_MM * pwm
    rad = BUBBLE_R_MM * pwm
    for g in plan["grid"]["x"]:
        e = msp.add_line(P((g["at"], y0 - bub + rad)), P((g["at"], y1 + bub - rad)),
                         dxfattribs={"layer": "A-GRID", "ltscale": 30})
        _xdata(e, "grid", g["label"], at=g["at"])
        for yb in (y0 - bub, y1 + bub):
            msp.add_circle(P((g["at"], yb)), rad * k, dxfattribs={"layer": "A-GRID-IDEN"})
            t = msp.add_text(g["label"], height=3.5 * den, dxfattribs={"layer": "A-GRID-IDEN", "style": "KR-SANS"})
            t.set_placement(P((g["at"], yb)), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
    for g in plan["grid"]["y"]:
        e = msp.add_line(P((x0 - bub + rad, g["at"])), P((x1 + bub - rad, g["at"])),
                         dxfattribs={"layer": "A-GRID", "ltscale": 30})
        _xdata(e, "grid", g["label"], at=g["at"])
        for xb in (x0 - bub, x1 + bub):
            msp.add_circle(P((xb, g["at"])), rad * k, dxfattribs={"layer": "A-GRID-IDEN"})
            t = msp.add_text(g["label"], height=3.5 * den, dxfattribs={"layer": "A-GRID-IDEN", "style": "KR-SANS"})
            t.set_placement(P((xb, g["at"])), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)

    ext = world["building"]["wall"]["exterior"] / 2
    for c in plan["chains"]:
        for a, b in c["segments"]:
            if c["side"] in ("S", "N"):
                face = y0 - ext if c["side"] == "S" else y1 + ext
                base_y = y0 - c["offset"] if c["side"] == "S" else y1 + c["offset"]
                dim = msp.add_linear_dim(base=P((a, base_y)), p1=P((a, face)), p2=P((b, face)), angle=0,
                                         dimstyle="KR-100", dxfattribs={"layer": "A-ANNO-DIMS"})
            else:
                face = x0 - ext if c["side"] == "W" else x1 + ext
                base_x = x0 - c["offset"] if c["side"] == "W" else x1 + c["offset"]
                dim = msp.add_linear_dim(base=P((base_x, a)), p1=P((face, a)), p2=P((face, b)), angle=90,
                                         dimstyle="KR-100", dxfattribs={"layer": "A-ANNO-DIMS"})
            dim.render()

    # Sheet metadata in the header (custom vars) and as title block attributes.
    rev = world["revision"]
    meta = {"KR_SHEET_ID": sheet["id"], "KR_TITLE": sheet["title"], "KR_FLOOR": plan["floor"],
            "KR_SCALE": f"{sheet['scale']} @ {sheet['size']}", "KR_REVISION": rev["id"], "KR_REV_DATE": rev["date"],
            "KR_RENDER_UTC": generated_utc, "KR_STATUS": STATUS, "KR_NOTE": "Bukan untuk konstruksi",
            "KR_DRAWN": DRAWN_BY, "KR_CHECK": CHECKED_BY, "KR_WORLD_SHA256": world_sha,
            "KR_GENERATOR": f"{GENERATOR} v{GENERATOR_VERSION}"}
    for key, val in meta.items():
        doc.header.custom_vars.append(key, val)

    _write_paperspace(doc, sheet, plan, layout, meta)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(path)
    return meta


def _write_paperspace(doc, sheet, plan, layout, meta):
    import ezdxf
    den = plan["den"]
    psname = sheet["id"]
    if "Layout1" in doc.layouts:
        doc.layouts.rename("Layout1", psname)
    ps = doc.layouts.get(psname)
    pw_mm, ph_mm = layout["paper"]
    ps.page_setup(size=(pw_mm, ph_mm), margins=(0, 0, 0, 0), units="mm", offset=(0, 0), rotation=0, scale=1)
    att = {"layer": "A-ANNO-TTLB"}
    fx0, fy0, fx1, fy1 = layout["frame"]
    ps.add_lwpolyline([(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1)], close=True, dxfattribs=att)
    px0 = layout["panel"][0]
    ps.add_line((px0, fy0), (px0, fy1), dxfattribs=att)
    zx0, zy0, zx1, zy1 = layout["zone"]
    ox, oy = layout["origin"]
    vp_c = ((zx0 + zx1) / 2, (zy0 + zy1) / 2)
    vp_w, vp_h = zx1 - zx0 - 2, zy1 - zy0 - 2
    view_c = ((vp_c[0] - ox) * den, (vp_c[1] - oy) * den)
    vp = ps.add_viewport(center=vp_c, size=(vp_w, vp_h), view_center_point=view_c, view_height=vp_h * den,
                         dxfattribs={"layer": "A-ANNO-VPRT"})
    vp.frozen_layers = ["A-FURN-IDEN", "A-AREA"]

    # Title block as a block with attributes so a CAD user can edit fields.
    tb_name = "KR-TTLB"
    if tb_name not in doc.blocks:
        blk = doc.blocks.new(tb_name)
        fields = [("KR_SHEET_ID", 3, 6.0), ("KR_TITLE", 13, 4.0), ("KR_FLOOR", 20, 2.5), ("KR_SCALE", 26, 2.5),
                  ("KR_REVISION", 31, 2.5), ("KR_REV_DATE", 36, 2.5), ("KR_RENDER_UTC", 41, 2.5),
                  ("KR_STATUS", 48, 3.5), ("KR_NOTE", 54, 2.5), ("KR_DRAWN", 59, 2.2), ("KR_CHECK", 64, 2.2),
                  ("KR_WORLD_SHA256", 69, 1.8)]
        for tag, dy, h in fields:
            blk.add_attdef(tag, insert=(3, 72 - dy), height=h, dxfattribs={"layer": "A-ANNO-TTLB", "style": "KR-SANS"})
        blk.add_lwpolyline([(0, 0), (140, 0), (140, 76), (0, 76)], close=True, dxfattribs={"layer": "A-ANNO-TTLB"})
    ref = ps.add_blockref(tb_name, (px0 + 5, fy0 + 4), dxfattribs=att)
    ref.add_auto_attribs({k: v for k, v in meta.items() if k in {a.dxf.tag for a in doc.blocks[tb_name].attdefs()}})

    # Scale bar true to paper scale, north arrow, notes and watermark.
    sb = layout["scale_bar"]
    y = sb["y_mm"]
    for i, (a, b) in enumerate(zip(sb["x_mm"], sb["x_mm"][1:])):
        pl = ps.add_lwpolyline([(a, y), (b, y), (b, y + sb["height_mm"]), (a, y + sb["height_mm"])], close=True,
                               dxfattribs=att)
        if i % 2 == 0:
            h = ps.add_hatch(dxfattribs=att)
            h.set_solid_fill(color=3, rgb=hex_rgb(GREEN))
            h.paths.add_polyline_path([(a, y), (b, y), (b, y + sb["height_mm"]), (a, y + sb["height_mm"])])
    for m, x in zip(sb["marks_m"], sb["x_mm"]):
        t = ps.add_text(str(m), height=2.2, dxfattribs={**att, "style": "KR-SANS"})
        t.set_placement((x, y + 4.5), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
    t = ps.add_text("m  (1:100 @ A2)" if den == 100 else f"m (1:{den})", height=2.2,
                    dxfattribs={**att, "style": "KR-SANS"})
    t.set_placement((sb["x_mm"][-1] + 4, y + 0.3))
    t = ps.add_text(f"{sheet['id']}  {sheet['title'].upper()}  SKALA {sheet['scale']}", height=5.0,
                    dxfattribs={**att, "style": "KR-SANS"})
    t.set_placement((fx0 + 10, fy0 + 30))
    nx, ny = layout["panel"][0] + 20, layout["frame"][3] - 25
    ps.add_circle((nx, ny), 9, dxfattribs=att)
    ps.add_solid([(nx, ny + 9), (nx - 3.5, ny - 5), (nx + 3.5, ny - 5)], dxfattribs=att)
    t = ps.add_text("U", height=4, dxfattribs={**att, "style": "KR-SANS"})
    t.set_placement((nx, ny + 13), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
    notes = ["ASUMSI"] + [f"{k}: {v}" for k, v in ASSUMPTION_SHORT.items()]
    mt = ps.add_mtext("\\P".join(notes), dxfattribs={"layer": "A-ANNO-NOTE", "style": "KR-SANS", "char_height": 2.0,
                                                     "width": 138})
    mt.set_location((layout["panel"][0] + 6, layout["frame"][3] - 45), attachment_point=1)
    wm = ps.add_mtext("KONSEP - BUKAN UNTUK KONSTRUKSI",
                      dxfattribs={"layer": "A-ANNO-WMRK", "style": "KR-SANS", "char_height": 18,
                                  "rotation": math.degrees(math.atan2(240, 320))})
    wm.set_location(((zx0 + zx1) / 2, (zy0 + zy1) / 2), attachment_point=5)


def dxf_counts(path: Path) -> dict:
    import ezdxf
    doc = ezdxf.readfile(path)
    out = {"file": path.name, "modelspace": {}, "paperspace": {}, "totals": {}}
    for name, space in (("modelspace", doc.modelspace()),):
        for e in space:
            out[name].setdefault(e.dxf.layer, {}).setdefault(e.dxftype(), 0)
            out[name][e.dxf.layer][e.dxftype()] += 1
    for layout in doc.layouts:
        if layout.is_modelspace:
            continue
        key = f"paperspace:{layout.name}"
        out["paperspace"][key] = {}
        for e in layout:
            out["paperspace"][key].setdefault(e.dxf.layer, {}).setdefault(e.dxftype(), 0)
            out["paperspace"][key][e.dxf.layer][e.dxftype()] += 1
    out["totals"]["modelspace"] = sum(sum(v.values()) for v in out["modelspace"].values())
    out["totals"]["paperspace"] = sum(sum(sum(v.values()) for v in lay.values()) for lay in out["paperspace"].values())
    out["layers"] = sorted(layer.dxf.name for layer in doc.layers)
    out["insunits"] = doc.header.get("$INSUNITS")
    out["dxfversion"] = doc.dxfversion
    return out


# --------------------------------------------------------------------------- PDF writer

def write_pdf(sheet, world, plan, layout, path: Path, generated_utc: str, world_sha: str) -> dict:
    from reportlab.lib import colors
    from reportlab.pdfgen import canvas

    tf = plan["fonts"]
    F, FM, FB = tf.regular, tf.medium, tf.bold
    den = plan["den"]
    pw_mm, ph_mm = layout["paper"]
    page = (pw_mm * PT_PER_MM, ph_mm * PT_PER_MM)
    path.parent.mkdir(parents=True, exist_ok=True)
    # initialFontName keeps the non-embedded Helvetica default out of the PDF.
    c = canvas.Canvas(str(path), pagesize=page, pageCompression=1, initialFontName=F, initialFontSize=8)
    rev = world["revision"]
    c.setTitle(f"{sheet['id']} {sheet['title']} ({rev['id']})")
    c.setAuthor(DRAWN_BY)
    c.setSubject(f"kantor-rpg {sheet['id']} {STATUS}, bukan untuk konstruksi")
    c.setCreator(f"{GENERATOR} v{GENERATOR_VERSION} (ReportLab)")
    c.setKeywords(f"kantor-rpg, {sheet['id']}, {rev['id']}, {STATUS}, world sha256 {world_sha}")
    ox, oy = layout["origin"]
    s = 1000.0 / den  # world m -> paper mm

    def mm(v):
        return v * PT_PER_MM

    def W(p):
        return (mm(ox + p[0] * s), mm(oy + p[1] * s))

    col = colors.HexColor

    # Watermark first so every line drawn later sits on top of it.
    x0, y0, x1, y1 = plan["extent"]
    cx, cy = W(((x0 + x1) / 2, (y0 + y1) / 2))
    c.saveState()
    c.setFillColor(col(GREEN))
    c.setFillAlpha(0.05)
    c.translate(cx, cy)
    c.rotate(math.degrees(math.atan2(y1 - y0, x1 - x0)))
    c.setFont(FB, 64)
    c.drawCentredString(0, -22, "KONSEP - BUKAN UNTUK KONSTRUKSI")
    c.restoreState()

    # Frame and panel rules.
    fx0, fy0, fx1, fy1 = layout["frame"]
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(1.4)
    c.rect(mm(fx0), mm(fy0), mm(fx1 - fx0), mm(fy1 - fy0))
    c.setLineWidth(0.5)
    c.rect(mm(4), mm(4), mm(pw_mm - 8), mm(ph_mm - 8))
    px0 = layout["panel"][0]
    c.setLineWidth(0.9)
    c.line(mm(px0), mm(fy0), mm(px0), mm(fy1))
    ts = layout["title_strip"]
    c.setLineWidth(0.4)
    c.line(mm(ts[0]), mm(ts[3]), mm(ts[2]), mm(ts[3]))

    # Grid (behind the building).
    pwm = den / 1000.0
    bub, rad = BUBBLE_MM * pwm, BUBBLE_R_MM * pwm
    c.setStrokeColor(col(GRID))
    c.setLineWidth(0.35)
    c.setDash([10, 2.5, 1.5, 2.5])
    for g in plan["grid"]["x"]:
        c.line(*W((g["at"], y0 - bub + rad)), *W((g["at"], y1 + bub - rad)))
    for g in plan["grid"]["y"]:
        c.line(*W((x0 - bub + rad, g["at"])), *W((x1 + bub - rad, g["at"])))
    c.setDash()
    c.setStrokeColor(col(DIM))
    c.setLineWidth(0.6)
    for g, positions in ([(g, [(g["at"], y0 - bub), (g["at"], y1 + bub)]) for g in plan["grid"]["x"]]
                         + [(g, [(x0 - bub, g["at"]), (x1 + bub, g["at"])]) for g in plan["grid"]["y"]]):
        for p in positions:
            px, py = W(p)
            c.setFillColor(colors.white)
            c.circle(px, py, mm(BUBBLE_R_MM), stroke=1, fill=1)
            c.setFillColor(col(INK))
            c.setFont(FB, 10)
            c.drawCentredString(px, py - 3.5, g["label"])

    # Furniture: thin warm grey; a few types get a symbol detail.
    c.setStrokeColor(col(FURN))
    c.setLineWidth(0.35)
    round_types = {"round_table", "plant_small", "plant_large", "tree_planter", "stool", "beanbag", "board_table"}
    for fx in plan["fixtures"]:
        pts = [W(p) for p in fixture_corners(fx)]
        if fx["type"] in round_types:
            pcx = sum(p[0] for p in pts) / 4
            pcy = sum(p[1] for p in pts) / 4
            r = mm(min(fx["size"][:2]) * s) / 2
            c.circle(pcx, pcy, r, stroke=1, fill=0)
            if fx["type"].startswith("plant") or fx["type"] == "tree_planter":
                c.circle(pcx, pcy, r * 0.45, stroke=1, fill=0)
            continue
        path_ = c.beginPath()
        path_.moveTo(*pts[0])
        for p in pts[1:]:
            path_.lineTo(*p)
        path_.close()
        c.drawPath(path_, stroke=1, fill=0)
        w_, d_ = fx["size"][:2]
        if fx["type"] in ("desk", "desk_exec", "reception_desk", "lab_bench"):
            a = W(_fixture_local(fx, -w_ * 0.3, d_ / 2 - 0.12))
            b = W(_fixture_local(fx, w_ * 0.3, d_ / 2 - 0.12))
            c.line(*a, *b)
        elif fx["type"] in ("chair", "chair_guest", "sofa", "armchair"):
            a = W(_fixture_local(fx, -w_ / 2, d_ / 2 - min(0.15, d_ * 0.25)))
            b = W(_fixture_local(fx, w_ / 2, d_ / 2 - min(0.15, d_ * 0.25)))
            c.line(*a, *b)
        elif fx["type"] == "wc":
            ecx, ecy = W(_fixture_local(fx, 0, -0.08))
            c.ellipse(ecx - mm(0.17 * s), ecy - mm(0.22 * s), ecx + mm(0.17 * s), ecy + mm(0.22 * s))
        elif fx["type"] in ("rack_42u", "lab_rack_open"):
            a, b2 = W(_fixture_local(fx, -w_ / 2, -d_ / 2)), W(_fixture_local(fx, w_ / 2, d_ / 2))
            c.line(*a, *b2)

    # Vertical circulation: the single terracotta accent.
    c.setStrokeColor(col(TERRA))
    c.setFillColor(col(TERRA))
    for v in plan["vlinks"]:
        c.setLineWidth(0.7)
        pts = [W(p) for p in v["outline"]]
        pth = c.beginPath()
        pth.moveTo(*pts[0])
        for p in pts[1:]:
            pth.lineTo(*p)
        pth.close()
        c.drawPath(pth, stroke=1, fill=0)
        c.setLineWidth(0.35)
        for a, b in v["lines"]:
            c.line(*W(a), *W(b))
        for poly in v["polys"]:
            pp = [W(p) for p in poly]
            pth = c.beginPath()
            pth.moveTo(*pp[0])
            for p in pp[1:]:
                pth.lineTo(*p)
            pth.close()
            c.drawPath(pth, stroke=1, fill=0)
        if v.get("door"):
            c.setLineWidth(1.6)
            c.line(*W(v["door"][0]), *W(v["door"][1]))
        if v.get("break"):
            c.setLineWidth(0.6)
            c.setStrokeColor(colors.white)
            c.setLineWidth(2.2)
            bp = [W(p) for p in v["break"]]
            for a, b in zip(bp, bp[1:]):
                c.line(*a, *b)
            c.setStrokeColor(col(TERRA))
            c.setLineWidth(0.6)
            for a, b in zip(bp, bp[1:]):
                c.line(*a, *b)
        if v["arrow"]:
            c.setLineWidth(0.7)
            ap = [W(p) for p in v["arrow"]]
            c.circle(*ap[0], 1.6, stroke=0, fill=1)
            for a, b in zip(ap, ap[1:]):
                c.line(*a, *b)
            (ax, ay), (bx, by) = ap[-2], ap[-1]
            ang = math.atan2(by - ay, bx - ax)
            L, Wd = 6.0, 2.6
            base = (bx - L * math.cos(ang), by - L * math.sin(ang))
            pth = c.beginPath()
            pth.moveTo(bx, by)
            pth.lineTo(base[0] - Wd * math.sin(ang), base[1] + Wd * math.cos(ang))
            pth.lineTo(base[0] + Wd * math.sin(ang), base[1] - Wd * math.cos(ang))
            pth.close()
            c.drawPath(pth, stroke=0, fill=1)
        if v["label"]:
            lx, ly = W(v["label_pos"])
            c.setFont(FB, 7)
            if v["type"] == "lift":
                tw = tf.width(v["label"], FB, 7)
                c.setFillColor(colors.white)
                c.rect(lx - tw / 2 - 2, ly - 3.5, tw + 4, 9.5, stroke=0, fill=1)
                c.setFillColor(col(TERRA))
            c.drawCentredString(lx, ly - 2.4, v["label"])

    # Walls: interior first so exterior poche covers the overlapping caps.
    for ext in (False, True):
        colr = col(GREEN if ext else WALL_INT)
        c.setFillColor(colr)
        c.setStrokeColor(colr)
        c.setLineWidth(0.2)
        for w in plan["walls"]:
            if w["exterior"] != ext:
                continue
            ax, ay = W(w["rect"][:2])
            bx, by = W(w["rect"][2:])
            c.rect(ax, ay, bx - ax, by - ay, stroke=1, fill=1)

    # Doors.
    c.setStrokeColor(col(GREEN))
    for d in plan["doors"]:
        c.setLineWidth(0.8)
        for hinge, tip in d["leaves"]:
            c.line(*W(hinge), *W(tip))
        c.setLineWidth(0.3)
        for ctr, r, a0, a1 in d["arcs"]:
            px, py = W(ctr)
            rr = mm(r * s)
            c.arc(px - rr, py - rr, px + rr, py + rr, a0, (a1 - a0) % 360)
        c.setDash([3, 2])
        for a, b in d["dashed"]:
            c.line(*W(a), *W(b))
        c.setDash()
        for poly in d["panels"]:
            pp = [W(p) for p in poly]
            pth = c.beginPath()
            pth.moveTo(*pp[0])
            for p in pp[1:]:
                pth.lineTo(*p)
            pth.close()
            c.setFillColor(colors.white)
            c.drawPath(pth, stroke=1, fill=1)
        for a, b in d["lines"]:
            c.line(*W(a), *W(b))
        tx, ty = W(d["tag_pos"])
        c.saveState()
        c.translate(tx, ty)
        c.rotate(d["tag_rot"])
        tw = tf.width(d["id"], FM, d["tag_size"])
        c.setFillColor(colors.white)
        c.rect(-tw / 2 - 1, -d["tag_size"] * 0.55, tw + 2, d["tag_size"] * 1.1, stroke=0, fill=1)
        c.setFillColor(col(GREY_TEXT))
        c.setFont(FM, d["tag_size"])
        c.drawCentredString(0, -d["tag_size"] * 0.34, d["id"])
        c.restoreState()

    # Room tags with a paper knockout so grid lines never cut through text.
    for r in plan["rooms"]:
        tag = plan["tags"][r["id"]]
        px, py = W(tag["pos"])
        tw = max(tf.width(t, f, sz) for t, f, sz, _ in tag["lines"])
        th = sum(sz * 1.16 for _, _, sz, _ in tag["lines"])
        c.setFillColor(colors.white)
        c.rect(px - tw / 2 - 1.2, py - th / 2 - 1.0, tw + 2.4, th + 2.0, stroke=0, fill=1)
        y = py + th / 2
        for text, font, size, kind in tag["lines"]:
            y -= size * 1.16
            c.setFont(font, size)
            c.setFillColor(col(GREEN if kind == "id" else INK if kind == "name" else GREY_TEXT))
            c.drawCentredString(px, y + size * 0.22, text)

    # Dimension chains: architectural ticks, mm values, as-to-as.
    ext = world["building"]["wall"]["exterior"] / 2
    c.setStrokeColor(col(DIM))
    c.setFillColor(col(DIM))
    dim_font = 6.6
    for ch in plan["chains"]:
        horiz = ch["side"] in ("S", "N")
        out = -1 if ch["side"] in ("S", "W") else 1
        for a, b in ch["segments"]:
            if horiz:
                base = (y0 if out < 0 else y1) + out * ch["offset"]
                face = (y0 if out < 0 else y1) + out * (ext + 0.1)
                pa, pb = W((a, base)), W((b, base))
                c.setLineWidth(0.3)
                for xv in (a, b):
                    c.line(*W((xv, face)), *W((xv, base + out * 0.15)))
                c.setLineWidth(0.35)
                c.line(pa[0] - 2, pa[1], pb[0] + 2, pb[1])
                c.setLineWidth(0.9)
                for q in (pa, pb):
                    c.line(q[0] - 1.6, q[1] - 1.6, q[0] + 1.6, q[1] + 1.6)
                label = f"{round((b - a) * 1000):d}"
                tw = tf.width(label, FM, dim_font)
                mx = (pa[0] + pb[0]) / 2
                c.setFont(FM, dim_font)
                if tw + 4 > (pb[0] - pa[0]):
                    mx = pb[0] + tw / 2 + 3
                c.setFillColor(colors.white)
                c.rect(mx - tw / 2 - 1, pa[1] + 0.9, tw + 2, dim_font * 0.9, stroke=0, fill=1)
                c.setFillColor(col(DIM))
                c.drawCentredString(mx, pa[1] + 1.6, label)
            else:
                base = (x0 if out < 0 else x1) + out * ch["offset"]
                face = (x0 if out < 0 else x1) + out * (ext + 0.1)
                pa, pb = W((base, a)), W((base, b))
                c.setLineWidth(0.3)
                for yv in (a, b):
                    c.line(*W((face, yv)), *W((base + out * 0.15, yv)))
                c.setLineWidth(0.35)
                c.line(pa[0], pa[1] - 2, pb[0], pb[1] + 2)
                c.setLineWidth(0.9)
                for q in (pa, pb):
                    c.line(q[0] - 1.6, q[1] - 1.6, q[0] + 1.6, q[1] + 1.6)
                label = f"{round((b - a) * 1000):d}"
                tw = tf.width(label, FM, dim_font)
                my = (pa[1] + pb[1]) / 2
                if tw + 4 > (pb[1] - pa[1]):
                    my = pb[1] + tw / 2 + 3
                c.saveState()
                c.translate(pa[0] - 1.6, my)
                c.rotate(90)
                c.setFillColor(colors.white)
                c.rect(-tw / 2 - 1, -0.7, tw + 2, dim_font * 0.9, stroke=0, fill=1)
                c.setFillColor(col(DIM))
                c.setFont(FM, dim_font)
                c.drawCentredString(0, 0, label)
                c.restoreState()

    _pdf_title_strip(c, sheet, plan, layout, tf)
    _pdf_panel(c, sheet, world, plan, layout, tf, generated_utc, world_sha)
    c.showPage()
    c.save()
    return {"page_pt": page}


def _pdf_title_strip(c, sheet, plan, layout, tf):
    from reportlab.lib import colors
    col = colors.HexColor

    def mm(v):
        return v * PT_PER_MM
    ts = layout["title_strip"]
    floor = plan["floor"]
    c.setFillColor(col(GREEN))
    c.setFont(tf.bold, 20)
    c.drawString(mm(ts[0] + 8), mm(ts[1] + 19), sheet["title"].upper())
    c.setFillColor(col(INK))
    c.setFont(tf.regular, 9)
    c.drawString(mm(ts[0] + 8), mm(ts[1] + 12),
                 f"Skala {sheet['scale']} @ {sheet['size']}  ·  lantai {floor}  ·  ukuran dalam mm, as ke as dinding")
    # Graphic scale bar: geometry comes from scale_bar_geometry() and is asserted by tests.
    sb = layout["scale_bar"]
    y = mm(sb["y_mm"])
    h = mm(sb["height_mm"])
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(0.5)
    xs = sb["x_pt"]
    for i, (a, b) in enumerate(zip(xs, xs[1:])):
        c.setFillColor(col(GREEN) if i % 2 == 0 else colors.white)
        c.rect(a, y, b - a, h, stroke=1, fill=1)
    c.setFillColor(col(INK))
    c.setFont(tf.medium, 7.5)
    for m, x in zip(sb["marks_m"], xs):
        c.drawCentredString(x, y + h + 2.5, str(m))
    c.drawString(xs[-1] + 5, y + 0.6, "m")
    c.setFont(tf.regular, 7)
    c.setFillColor(col(GREY_TEXT))
    c.drawString(xs[0], y - 9, f"Skala grafis benar pada cetak {sheet['size']} 100%: 10 m = {sb['length_mm']:.0f} mm di kertas")


def _pdf_floor_key(c, world, plan, tf, left, right, top):
    """Schematic floor stack (not to scale) with the current floor filled."""
    from reportlab.lib import colors
    col = colors.HexColor
    floors = sorted(world["floors"], key=lambda f: f["level"])
    band = 8.5 * PT_PER_MM
    gap = 2.0 * PT_PER_MM
    bw = 52 * PT_PER_MM
    y = top - 4 - len(floors) * (band + gap)
    for f in floors:
        current = f["id"] == plan["floor"]
        c.setStrokeColor(col(GREEN))
        c.setLineWidth(0.8 if current else 0.5)
        c.setFillColor(col("#d9e6df") if current else colors.white)
        c.rect(left, y, bw, band, stroke=1, fill=1)
        c.setFillColor(col(GREEN))
        c.setFont(tf.bold, 9)
        c.drawString(left + 6, y + band / 2 - 3.2, f["id"])
        c.setFillColor(col(INK))
        c.setFont(tf.regular, 7.8)
        c.drawString(left + 30, y + band / 2 - 2.8, f"elevasi {fmt_elev(f['elevation'])} m")
        c.setFont(tf.bold if current else tf.regular, 7.8)
        label = f["name"] + ("  (lembar ini)" if current else "")
        c.drawString(left + bw + 8, y + band / 2 - 2.8, label)
        y += band + gap
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(1.2)
    base = top - 4 - len(floors) * (band + gap) - 1.5
    c.line(left - 4, base, left + bw + 4, base)


def _pdf_panel(c, sheet, world, plan, layout, tf, generated_utc, world_sha):
    from reportlab.lib import colors
    from reportlab.lib.utils import simpleSplit
    col = colors.HexColor

    def mm(v):
        return v * PT_PER_MM
    px0, py0, px1, py1 = layout["panel"]
    left = mm(px0 + 6)
    right = mm(px1 - 6)
    width = right - left
    y = mm(py1 - 6)

    def heading(text):
        nonlocal y
        c.setFillColor(col(GREEN))
        c.setFont(tf.bold, 9.5)
        c.drawString(left, y - 9.5, text)
        y -= 14
        c.setStrokeColor(col(GREEN))
        c.setLineWidth(0.4)
        c.line(left, y + 2, right, y + 2)
        y -= 3

    # North arrow + project mark.
    nx, ny = left + mm(12), y - mm(13)
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(0.8)
    c.circle(nx, ny, mm(9), stroke=1, fill=0)
    pth = c.beginPath()
    pth.moveTo(nx, ny + mm(9))
    pth.lineTo(nx - mm(3.6), ny - mm(5.5))
    pth.lineTo(nx, ny - mm(3))
    pth.close()
    c.setFillColor(col(GREEN))
    c.drawPath(pth, stroke=0, fill=1)
    pth = c.beginPath()
    pth.moveTo(nx, ny + mm(9))
    pth.lineTo(nx + mm(3.6), ny - mm(5.5))
    pth.lineTo(nx, ny - mm(3))
    pth.close()
    c.setFillColor(colors.white)
    c.drawPath(pth, stroke=1, fill=1)
    c.setFillColor(col(GREEN))
    c.setFont(tf.bold, 11)
    c.drawCentredString(nx, ny + mm(10.5), "U")
    c.setFillColor(col(INK))
    c.setFont(tf.bold, 10)
    c.drawString(nx + mm(16), ny + mm(4), "Utara = sumbu Y+ dunia")
    c.setFont(tf.regular, 7.5)
    for i, line in enumerate(["Origin (0,0) sudut barat daya L1, X timur.",
                              "Grid acuan konsep dari tepi ruang (1..n, A..n),",
                              "bukan grid struktur (AS-DIM-03)."]):
        c.drawString(nx + mm(16), ny + mm(0.5) - i * 9, line)
    y = ny - mm(14)

    heading("LEGENDA")
    sw = mm(14)
    items = [("wall_ext", "Dinding luar 0,30 m (poche hijau tua)"), ("wall_int", "Dinding dalam 0,15 m"),
             ("door1", "Pintu tunggal + arah buka 90°"), ("door2", "Pintu ganda"),
             ("opening", "Bukaan tanpa daun (garis atas putus)"), ("hatch", "Hatch akses shaft / riser"),
             ("furn", "Furniture dan fixture (catalog, AS-DIM-04)"),
             ("stair", "Tangga U / lift, panah dari lantai ini"),
             ("grid", "Garis grid acuan konsep"), ("dim", "Dimensi mm, as ke as (AS-DIM-02)"),
             ("tag", "Tag ruang: ID, nama, luas as-drawn"), ("dtag", "ID pintu (sisi tanpa ayunan)")]
    row = 18.0
    for i, (kind, text) in enumerate(items):
        colx = left + (i % 2) * width / 2
        cy_ = y - (i // 2) * row - 8
        x0s = colx
        if kind in ("wall_ext", "wall_int"):
            c.setFillColor(col(GREEN if kind == "wall_ext" else WALL_INT))
            hh = mm(3.0 if kind == "wall_ext" else 1.5)
            c.rect(x0s, cy_ - hh / 2, sw, hh, stroke=0, fill=1)
        elif kind in ("door1", "door2"):
            c.setStrokeColor(col(GREEN))
            c.setLineWidth(0.8)
            if kind == "door1":
                c.line(x0s + 3, cy_ - 5, x0s + 3, cy_ + 6)
                c.setLineWidth(0.3)
                c.arc(x0s + 3 - 11, cy_ - 5 - 11, x0s + 3 + 11, cy_ - 5 + 11, 0, 90)
            else:
                c.line(x0s + 2, cy_ - 5, x0s + 2, cy_ + 5)
                c.line(x0s + 22, cy_ - 5, x0s + 22, cy_ + 5)
                c.setLineWidth(0.3)
                c.arc(x0s + 2 - 10, cy_ - 15, x0s + 12, cy_ + 5, 0, 90)
                c.arc(x0s + 12, cy_ - 15, x0s + 32, cy_ + 5, 90, 90)
        elif kind == "opening":
            c.setStrokeColor(col(GREEN))
            c.setLineWidth(0.3)
            c.setDash([3, 2])
            c.line(x0s, cy_ + 2, x0s + sw, cy_ + 2)
            c.line(x0s, cy_ - 2, x0s + sw, cy_ - 2)
            c.setDash()
        elif kind == "hatch":
            c.setStrokeColor(col(GREEN))
            c.setLineWidth(0.3)
            c.rect(x0s + 6, cy_ - 3, 20, 6)
            c.line(x0s + 6, cy_ - 3, x0s + 26, cy_ + 3)
            c.line(x0s + 6, cy_ + 3, x0s + 26, cy_ - 3)
        elif kind == "furn":
            c.setStrokeColor(col(FURN))
            c.setLineWidth(0.35)
            c.rect(x0s + 4, cy_ - 4, 24, 8)
            c.line(x0s + 8, cy_ + 2, x0s + 24, cy_ + 2)
        elif kind == "stair":
            c.setStrokeColor(col(TERRA))
            c.setFillColor(col(TERRA))
            c.setLineWidth(0.35)
            for k in range(5):
                c.line(x0s + 4 + k * 5, cy_ - 5, x0s + 4 + k * 5, cy_ + 5)
            c.setLineWidth(0.7)
            c.line(x0s + 2, cy_, x0s + 30, cy_)
            pth = c.beginPath()
            pth.moveTo(x0s + 35, cy_)
            pth.lineTo(x0s + 29, cy_ + 2.6)
            pth.lineTo(x0s + 29, cy_ - 2.6)
            pth.close()
            c.drawPath(pth, stroke=0, fill=1)
        elif kind == "grid":
            c.setStrokeColor(col(GRID))
            c.setLineWidth(0.35)
            c.setDash([10, 2.5, 1.5, 2.5])
            c.line(x0s, cy_, x0s + sw - 8, cy_)
            c.setDash()
            c.setStrokeColor(col(DIM))
            c.setFillColor(colors.white)
            c.circle(x0s + sw - 3, cy_, 5.5, stroke=1, fill=1)
            c.setFillColor(col(INK))
            c.setFont(tf.bold, 6.5)
            c.drawCentredString(x0s + sw - 3, cy_ - 2.3, "1")
        elif kind == "dim":
            c.setStrokeColor(col(DIM))
            c.setLineWidth(0.35)
            c.line(x0s, cy_ - 2, x0s + sw, cy_ - 2)
            c.setLineWidth(0.9)
            for q in (x0s + 2, x0s + sw - 2):
                c.line(q - 1.6, cy_ - 3.6, q + 1.6, cy_ - 0.4)
            c.setFillColor(col(DIM))
            c.setFont(tf.medium, 6)
            c.drawCentredString(x0s + sw / 2, cy_, "8000")
        elif kind == "tag":
            c.setFillColor(col(GREEN))
            c.setFont(tf.bold, 6)
            c.drawCentredString(x0s + sw / 2, cy_ + 2, "ID-RUANG")
            c.setFillColor(col(GREY_TEXT))
            c.setFont(tf.medium, 5.5)
            c.drawCentredString(x0s + sw / 2, cy_ - 5, "00,00 m²")
        elif kind == "dtag":
            c.setFillColor(col(GREY_TEXT))
            c.setFont(tf.medium, 5.5)
            c.drawCentredString(x0s + sw / 2, cy_ - 2, "D-ID")
        c.setFillColor(col(INK))
        c.setFont(tf.regular, 7.8)
        lines = simpleSplit(text, tf.regular, 7.8, width / 2 - sw - 8)
        for j, ln in enumerate(lines[:2]):
            c.drawString(x0s + sw + 4, cy_ - 2.7 + (len(lines[:2]) - 1) * 4.3 - j * 8.6, ln)
    y -= (len(items) + 1) // 2 * row + 6

    heading("ASUMSI (lengkap di design/world.json dan docs/assumptions.md)")
    ids = {a["id"] for a in world["assumptions"]}
    for aid, text in ASSUMPTION_SHORT.items():
        assert aid in ids, f"{aid} missing from world.json assumptions"
        c.setFillColor(col(GREEN))
        c.setFont(tf.bold, 7.8)
        c.drawString(left, y - 8.5, aid)
        c.setFillColor(col(INK))
        c.setFont(tf.regular, 7.8)
        lines = simpleSplit(text, tf.regular, 7.8, width - mm(18))
        for j, ln in enumerate(lines):
            c.drawString(left + mm(18), y - 8.5 - j * 9.4, ln)
        y -= 9.4 * len(lines) + 4
    y -= 4

    heading(f"DAFTAR RUANG {plan['floor']} (luas as-drawn dari polygon)")
    rh = 9.8
    c.setFont(tf.medium, 7.2)
    c.setFillColor(col(GREY_TEXT))
    c.drawString(left, y - 7, "ID")
    c.drawString(left + mm(24), y - 7, "Nama")
    c.drawRightString(right, y - 7, "Luas")
    y -= rh + 2
    for i, r in enumerate(plan["rooms"]):
        if i % 2 == 0:
            c.setFillColor(col("#eef3f0"))
            c.rect(left - 2, y - rh - 0.6, width + 4, rh, stroke=0, fill=1)
        c.setFillColor(col(GREEN))
        c.setFont(tf.bold, 7.6)
        c.drawString(left, y - 7.6, r["id"])
        c.setFillColor(col(INK))
        c.setFont(tf.regular, 7.6)
        c.drawString(left + mm(24), y - 7.6, r["name"])
        c.setFont(tf.medium, 7.6)
        c.drawRightString(right, y - 7.6, fmt_area(r["area"]))
        y -= rh
    total = sum(r["area"] for r in plan["rooms"])
    x0e, y0e, x1e, y1e = plan["extent"]
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(0.4)
    c.line(left, y - 2, right, y - 2)
    c.setFillColor(col(INK))
    c.setFont(tf.bold, 7)
    c.drawString(left, y - 10.5, f"Jumlah {len(plan['rooms'])} ruang")
    c.drawRightString(right, y - 10.5, fmt_area(total))
    c.setFont(tf.regular, 6.8)
    c.setFillColor(col(GREY_TEXT))
    c.drawString(left + mm(24), y - 10.5,
                 f"= envelope {fmt_m(x1e - x0e)} x {fmt_m(y1e - y0e)} m ({fmt_area((x1e - x0e) * (y1e - y0e))})")
    y -= 20

    heading("CATATAN")
    floor_meta = floor_of(world, plan["floor"])
    seats = sum(1 for sl in world["activitySlots"] if sl["floor"] == plan["floor"] and sl.get("pose") == "sit")
    notes = [
        f"Sumber tunggal: design/world.json revisi {world['revision']['id']}; dinding diturunkan oleh "
        "tools/kantor/geometry.py (tepi polygon ruang dikurangi bukaan pintu).",
        "Arah ayun pintu adalah konvensi generator: pintu exit membuka ke luar, pintu lain membuka ke ruang, "
        "menjauhi koridor. world.json belum menyimpan arah ayun.",
        f"Lantai {floor_meta['id']}: elevasi {fmt_elev(floor_meta['elevation'])} m; {len(plan['rooms'])} ruang, "
        f"{len(plan['doors'])} pintu/bukaan, {len(plan['fixtures']) + len(plan['vlinks'])} fixture, "
        f"{seats} slot duduk (AS-OCC-02).",
        "DXF pasangan: cad/out/" + sheet["id"] + ".dxf (mm, 1:1). DWG native BLOCKED: tidak ada AutoCAD "
        "berlisensi di container; lihat cad/AUTOCAD-RUNBOOK.md.",
    ]
    exits = sum(1 for d in plan["doors"] if d["target"] == "EXT")
    notes.append(f"Pintu exit konsep di lantai ini: {exits}. Jalur keluar belum dinilai terhadap peraturan "
                 "(AS-OCC-01).")
    for v in world["verticalLinks"]:
        if v["type"] == "escape_concept" and any(e["floor"] == plan["floor"] for e in v["ends"]):
            notes.append(f"{v['id']}: {v['prompt']}; tidak digambar karena di luar envelope (AS-EXIT-01).")
    c.setFont(tf.regular, 7.8)
    c.setFillColor(col(INK))
    for n in notes:
        lines = simpleSplit(n, tf.regular, 7.8, width - 8)
        c.circle(left + 2, y - 5.8, 1.1, stroke=0, fill=1)
        for j, ln in enumerate(lines):
            c.drawString(left + 7, y - 8.4 - j * 9.4, ln)
        y -= 9.4 * len(lines) + 3.5
    y -= 4

    heading("KUNCI LANTAI")
    _pdf_floor_key(c, world, plan, tf, left, right, y)
    y -= mm(26)
    notes_bottom = y

    # Title block.
    tb_top = mm(py0 + 78)
    rev = world["revision"]
    # Revision history sits directly on the title block, as on a paper set.
    y = tb_top + mm(26)
    assert notes_bottom > y + 4, "panel content runs into the revision table"
    heading("RIWAYAT REVISI")
    c.setFillColor(col(GREY_TEXT))
    c.setFont(tf.medium, 7.2)
    c.drawString(left, y - 7, "Rev")
    c.drawString(left + mm(12), y - 7, "Tanggal")
    c.drawString(left + mm(32), y - 7, "Keterangan")
    y -= 10
    c.setFillColor(col(INK))
    c.setFont(tf.bold, 7.8)
    c.drawString(left, y - 8, rev["id"])
    c.setFont(tf.regular, 7.8)
    c.drawString(left + mm(12), y - 8, rev["date"])
    for j, ln in enumerate(simpleSplit(f"{rev['note']}. Lembar dihasilkan dari world.json revisi ini.",
                                       tf.regular, 7.8, width - mm(32))):
        c.drawString(left + mm(32), y - 8 - j * 9.4, ln)
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(0.9)
    c.line(mm(px0), tb_top, mm(px1), tb_top)
    yy = tb_top - 18
    c.setFillColor(col(GREEN))
    c.setFont(tf.bold, 17)
    c.drawString(left, yy, "kantor-rpg")
    c.setFont(tf.regular, 8)
    c.setFillColor(col(INK))
    c.drawString(left + tf.width("kantor-rpg", tf.bold, 17) + 8, yy + 1,
                 f"Proyek kantor-rpg  ·  gedung {world['building']['id']}")
    yy -= 22
    # Status band: white on deep green.
    c.setFillColor(col(GREEN))
    c.rect(left, yy - 4, width, 17, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont(tf.bold, 10.5)
    c.drawString(left + 6, yy + 1, f"STATUS {STATUS}")
    c.setFont(tf.medium, 9)
    c.drawRightString(right - 6, yy + 1, "Bukan untuk konstruksi")
    yy -= 22
    c.setFillColor(col(GREEN))
    c.setFont(tf.bold, 14)
    c.drawString(left, yy, sheet["title"])
    c.setFillColor(col(INK))
    c.setFont(tf.regular, 8)
    c.drawString(left, yy - 11, f"{floor_meta['id']}: {floor_meta['name']}")
    yy -= 22
    fields = [("Skala", f"{sheet['scale']} @ {sheet['size']} lanskap"),
              ("Revisi", f"{rev['id']}  ·  {rev['date']}"),
              ("Render", generated_utc.replace("T", " ").replace("Z", " UTC")),
              ("Satuan", "mm (dimensi), m² (luas)"),
              ("Digambar", DRAWN_BY),
              ("Diperiksa", CHECKED_BY),
              ("Sumber", f"world.json sha256 {world_sha[:16]}"),
              ("Generator", f"{GENERATOR} v{GENERATOR_VERSION}")]
    c.setStrokeColor(col(GRID))
    c.setLineWidth(0.3)
    row_h = 12.2
    label_w = mm(17)
    for i, (k, v) in enumerate(fields):
        ry = yy - i * row_h
        c.line(left, ry - 3.5, right - mm(42), ry - 3.5)
        c.setFillColor(col(GREY_TEXT))
        c.setFont(tf.medium, 7)
        c.drawString(left, ry, k)
        c.setFillColor(col(INK))
        c.setFont(tf.regular, 7.6)
        c.drawString(left + label_w, ry, v)
    # Sheet number block.
    bx0, by0 = right - mm(39), yy - (len(fields) - 1) * row_h - 3.5
    bh = mm(31)
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(0.9)
    c.rect(bx0, by0, mm(39), bh, stroke=1, fill=0)
    c.setFillColor(col(GREY_TEXT))
    c.setFont(tf.medium, 7)
    c.drawString(bx0 + 5, by0 + bh - 11, "Nomor lembar")
    c.setFillColor(col(GREEN))
    c.setFont(tf.bold, 27)
    c.drawCentredString(bx0 + mm(19.5), by0 + mm(12), sheet["id"])
    c.setFillColor(col(INK))
    c.setFont(tf.medium, 7.5)
    c.drawCentredString(bx0 + mm(19.5), by0 + mm(5.5), f"Rev {rev['id']}")
    c.setFillColor(col(GREY_TEXT))
    c.setFont(tf.regular, 6.2)
    note = font_source_note(tf.fonts)
    for j, ln in enumerate(simpleSplit(note, tf.regular, 6.2, width)):
        c.drawString(left, mm(py0 + 3.5) + 7.5 - j * 7.5, ln)


# --------------------------------------------------------------------------- previews

def render_pdf_preview(pdf: Path, png: Path, dpi=50) -> None:
    png.parent.mkdir(parents=True, exist_ok=True)
    stem = png.with_suffix("")
    subprocess.run(["pdftoppm", "-r", str(dpi), "-png", "-singlefile", str(pdf), str(stem)], check=True)


def render_dxf_preview(dxf: Path, png: Path) -> None:
    import ezdxf
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from ezdxf.addons.drawing import Frontend, RenderContext
    from ezdxf.addons.drawing.config import BackgroundPolicy, Configuration
    from ezdxf.addons.drawing.matplotlib import MatplotlibBackend

    doc = ezdxf.readfile(dxf)
    fig = plt.figure(figsize=(16, 12.9))
    ax = fig.add_axes([0, 0, 1, 1])
    ctx = RenderContext(doc)
    cfg = Configuration(background_policy=BackgroundPolicy.WHITE)
    # adjust_figure=False keeps the requested pixel size; the default shrinks
    # the figure to the drawing's paper extents (about 600 px wide here).
    Frontend(ctx, MatplotlibBackend(ax, adjust_figure=False), config=cfg).draw_layout(
        doc.modelspace(), finalize=True)
    png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(png, dpi=110, facecolor="white")
    plt.close(fig)


# --------------------------------------------------------------------------- orchestration

def build_sheet(sheet: dict, world: dict, out_dxf: Path, out_pdf: Path, out_prev: Path, generated_utc: str,
                world_sha: str, previews: bool = True) -> dict:
    if sheet.get("content") not in IMPLEMENTED_CONTENT:
        raise ValueError(f"{sheet['id']}: content '{sheet.get('content')}' not implemented")
    den = int(sheet["scale"].split(":")[1])
    plan = build_plan(world, sheet["floor"], den)
    layout = sheet_layout(sheet, plan)
    dxf_path = out_dxf / f"{sheet['id']}.dxf"
    pdf_path = out_pdf / f"{sheet['id']}.pdf"
    meta = write_dxf(sheet, world, plan, layout, dxf_path, generated_utc, world_sha)
    pdf_info = write_pdf(sheet, world, plan, layout, pdf_path, generated_utc, world_sha)
    counts = dxf_counts(dxf_path)
    counts.update({"sheet": sheet["id"], "world_revision": world["revision"]["id"],
                   "expected": {"walls": len(plan["walls"]), "doors": len(plan["doors"]),
                                "rooms": len(plan["rooms"]),
                                "fixtures": len(plan["fixtures"]) + len(plan["vlinks"]),
                                "dimension_segments": sum(len(ch["segments"]) for ch in plan["chains"])}})
    counts_path = out_dxf / f"{sheet['id']}.counts.json"
    counts_path.write_text(json.dumps(counts, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    result = {"sheet": sheet, "plan": plan, "layout": layout, "dxf": dxf_path, "pdf": pdf_path,
              "counts": counts_path, "meta": meta, "page_pt": pdf_info["page_pt"],
              "scale_bar": layout["scale_bar"],
              "forced_tags": [rid for rid, t in plan["tags"].items() if t.get("forced")],
              "tag_overlaps": {rid: round(t["overlap_m2"], 3) for rid, t in plan["tags"].items()
                               if t.get("overlap_m2")}}
    if previews:
        result["preview_pdf"] = out_prev / f"{sheet['id']}.png"
        result["preview_dxf"] = out_prev / f"{sheet['id']}-dxf.png"
        render_pdf_preview(pdf_path, result["preview_pdf"])
        render_dxf_preview(dxf_path, result["preview_dxf"])
    return result


def _pdf_pages(pdf: Path) -> int:
    from pypdf import PdfReader
    return len(PdfReader(str(pdf)).pages)


def write_register(results: list, sheets_doc: dict, register_path: Path, command: str, generated_utc: str) -> dict:
    old = {}
    if register_path.exists():
        try:
            old = {e["id"]: e for e in json.loads(register_path.read_text(encoding="utf-8")).get("sheets", [])}
        except (ValueError, KeyError):
            old = {}
    produced = {r["sheet"]["id"]: r for r in results}
    entries = []
    for sh in sheets_doc["sheets"]:
        base = {"id": sh["id"], "title": sh["title"], "discipline": sh["discipline"], "size": sh["size"],
                "scale": sh["scale"], "content": sh["content"], "milestone": sh["milestone"]}
        if sh["id"] in produced:
            r = produced[sh["id"]]
            files = {"dxf": r["dxf"], "pdf": r["pdf"], "counts": r["counts"],
                     "preview_pdf": r.get("preview_pdf"), "preview_dxf": r.get("preview_dxf")}
            entry = {**base, "status": "produced (konsep)", "revision": r["meta"]["KR_REVISION"],
                     "generated_utc": generated_utc, "generator_command": command,
                     "pdf_pages": _pdf_pages(r["pdf"]), "native_dwg": "BLOCKED (AutoCAD tidak tersedia)",
                     "files": {k: {"path": str(Path(v).resolve().relative_to(ROOT)), "sha256": sha256(v)}
                               for k, v in files.items() if v}}
        elif sh["id"] in old and old[sh["id"]].get("files") and all(
                (ROOT / f["path"]).exists() and sha256(ROOT / f["path"]) == f["sha256"]
                for f in old[sh["id"]]["files"].values()):
            entry = old[sh["id"]]  # produced by an earlier run, files unchanged since
        else:
            entry = {**base, "status": "target"}
        entries.append(entry)
    doc = {"project": sheets_doc["project"], "source": "design/sheets.json", "generated_utc": generated_utc,
           "note": "Dibuat oleh cad/generate.py. Status 'produced (konsep)' = DXF/PDF dihasilkan dan dibaca ulang; "
                   "native DWG BLOCKED.", "sheets": entries}
    register_path.parent.mkdir(parents=True, exist_ok=True)
    register_path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return doc


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--sheets", nargs="+", metavar="ID")
    g.add_argument("--all-available", action="store_true")
    ap.add_argument("--world", default=str(WORLD_PATH))
    ap.add_argument("--no-previews", action="store_true")
    args = ap.parse_args(argv)

    world = load_world(args.world)
    world_sha = sha256(Path(args.world))
    sheets_doc = load_sheets()
    by_id = {s["id"]: s for s in sheets_doc["sheets"]}
    if args.all_available:
        wanted = [s for s in sheets_doc["sheets"] if s.get("content") in IMPLEMENTED_CONTENT]
    else:
        unknown = [i for i in args.sheets if i not in by_id]
        if unknown:
            print(f"ERROR unknown sheet id(s): {', '.join(unknown)}", file=sys.stderr)
            return 2
        wanted = [by_id[i] for i in args.sheets]
        bad = [s["id"] for s in wanted if s.get("content") not in IMPLEMENTED_CONTENT]
        if bad:
            print(f"ERROR content not implemented yet for: {', '.join(bad)} (status tetap target)", file=sys.stderr)
            return 2
    generated_utc = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    command = "python3 cad/generate.py " + " ".join(argv if argv is not None else sys.argv[1:])
    print(f"generator {GENERATOR} v{GENERATOR_VERSION}  utc {generated_utc}")
    print(f"world {Path(args.world).relative_to(ROOT) if Path(args.world).is_absolute() else args.world} "
          f"revision {world['revision']['id']} sha256 {world_sha}")
    fonts = register()
    print(font_source_note(fonts))
    for name, colr in (("INK", INK), ("GREEN", GREEN), ("GREY_TEXT", GREY_TEXT), ("TERRA", TERRA), ("DIM", DIM)):
        print(f"contrast {name} {colr} on white = {contrast_ratio(colr):.2f}:1")
    print(f"contrast white on GREEN status band = {contrast_ratio(PAPER, GREEN):.2f}:1")
    results = []
    for sh in wanted:
        r = build_sheet(sh, world, ROOT / "cad" / "out", ROOT / "drawings" / "pdf", ROOT / "drawings" / "previews",
                        generated_utc, world_sha, previews=not args.no_previews)
        results.append(r)
        cnt = json.loads(r["counts"].read_text(encoding="utf-8"))
        import ezdxf
        doc = ezdxf.readfile(r["dxf"])
        aud = doc.audit()
        print(f"\n[{sh['id']}] {sh['title']}  floor {sh['floor']}  scale {sh['scale']} @ {sh['size']}")
        print(f"  dxf {r['dxf'].relative_to(ROOT)}  {r['dxf'].stat().st_size} bytes  sha256 {sha256(r['dxf'])}")
        print(f"  reopen ezdxf.readfile OK, dxfversion {doc.dxfversion}, $INSUNITS {doc.header.get('$INSUNITS')}, "
              f"audit errors {len(aud.errors)} fixes {len(aud.fixes)}")
        for layer, types in sorted(cnt["modelspace"].items()):
            print(f"  ms {layer:13s} " + ", ".join(f"{k} {v}" for k, v in sorted(types.items())))
        for lay, layers in cnt["paperspace"].items():
            print(f"  {lay} total {sum(sum(t.values()) for t in layers.values())}")
        print(f"  expected {cnt['expected']}")
        print(f"  pdf {r['pdf'].relative_to(ROOT)}  {r['pdf'].stat().st_size} bytes  page "
              f"{r['page_pt'][0]:.2f} x {r['page_pt'][1]:.2f} pt  sha256 {sha256(r['pdf'])}")
        sb = r["scale_bar"]
        print(f"  scale bar {sb['marks_m']} m -> {sb['length_mm']:.2f} mm = {sb['length_pt']:.2f} pt")
        print(f"  room tags forced (no clean fit): {r['forced_tags'] or 'none'}; "
              f"residual overlap m2: {r['tag_overlaps'] or 'none'}")
        if not args.no_previews:
            print(f"  previews {r['preview_pdf'].relative_to(ROOT)}, {r['preview_dxf'].relative_to(ROOT)}")
    reg = write_register(results, sheets_doc, ROOT / "drawings" / "register.json", command, generated_utc)
    n_prod = sum(1 for e in reg["sheets"] if e["status"].startswith("produced"))
    print(f"\nregister drawings/register.json: {n_prod} produced, {len(reg['sheets']) - n_prod} target")
    print("native DWG: BLOCKED (AutoCAD tidak tersedia di container); tidak ada file .dwg dibuat")
    return 0


if __name__ == "__main__":
    sys.exit(main())
