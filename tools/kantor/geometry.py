"""Pure-Python geometry shared by the validator, CAD generator and Blender.

Blender ships its own interpreter, so this module must stay dependency free.
Rooms are restricted to orthogonal polygons; walls are derived from room
edges (union per grid line) minus door openings, so CAD, Blender and the
runtime all cut the same openings from the same edges.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORLD_PATH = ROOT / "design" / "world.json"
EPS = 1e-9


def load_world(path: Path | str = WORLD_PATH) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def polygon_area(poly) -> float:
    s = 0.0
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        s += x0 * y1 - x1 * y0
    return abs(s) / 2.0


def polygon_edges(poly):
    return list(zip(poly, poly[1:] + poly[:1]))


def is_orthogonal(poly) -> bool:
    return all(a[0] == b[0] or a[1] == b[1] for a, b in polygon_edges(poly))


def point_in_polygon(pt, poly) -> bool:
    """Even-odd test; points exactly on an edge count as inside."""
    x, y = pt
    for (x0, y0), (x1, y1) in polygon_edges(poly):
        if point_on_segment(pt, (x0, y0), (x1, y1)):
            return True
    inside = False
    for (x0, y0), (x1, y1) in polygon_edges(poly):
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
            if x < xi:
                inside = not inside
    return inside


def point_on_segment(p, a, b, tol=1e-6) -> bool:
    (px, py), (ax, ay), (bx, by) = p, a, b
    cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
    if abs(cross) > tol:
        return False
    return min(ax, bx) - tol <= px <= max(ax, bx) + tol and min(ay, by) - tol <= py <= max(ay, by) + tol


def fixture_corners(fx, size=None):
    """Rotated footprint corners (CCW) of a fixture in world XY."""
    w, d = (size or fx["size"])[:2]
    r = math.radians(fx["rot"])
    c, s = math.cos(r), math.sin(r)
    cx, cy = fx["pos"]
    pts = []
    for lx, ly in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        pts.append((cx + lx * c - ly * s, cy + lx * s + ly * c))
    return pts


def fixture_aabb(fx):
    pts = fixture_corners(fx)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def point_in_fixture(pt, fx, pad=0.0) -> bool:
    """Point test in the fixture's local frame (exact for any rotation)."""
    w, d = fx["size"][:2]
    r = math.radians(fx["rot"])
    dx, dy = pt[0] - fx["pos"][0], pt[1] - fx["pos"][1]
    lx = dx * math.cos(r) + dy * math.sin(r)
    ly = -dx * math.sin(r) + dy * math.cos(r)
    return abs(lx) <= w / 2 + pad and abs(ly) <= d / 2 + pad


def _merge(intervals):
    out = []
    for a, b in sorted(intervals):
        if out and a <= out[-1][1] + EPS:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def _subtract(intervals, cuts):
    res = []
    for a, b in intervals:
        pieces = [[a, b]]
        for c0, c1 in cuts:
            nxt = []
            for p0, p1 in pieces:
                if c1 <= p0 + EPS or c0 >= p1 - EPS:
                    nxt.append([p0, p1])
                    continue
                if c0 > p0 + EPS:
                    nxt.append([p0, c0])
                if c1 < p1 - EPS:
                    nxt.append([c1, p1])
            pieces = nxt
        res.extend(pieces)
    return res


def derive_walls(world, floor_id):
    """Return (walls, openings) for one floor.

    walls: [{axis, at, from, to, thickness, exterior}] where axis 'x' means the
    wall runs along X at y = at; axis 'y' runs along Y at x = at.
    """
    floor = next(f for f in world["floors"] if f["id"] == floor_id)
    env = floor["envelope"]
    ex = world["building"]["wall"]["exterior"]
    inn = world["building"]["wall"]["interior"]
    xs = sorted({p[0] for p in env})
    ys = sorted({p[1] for p in env})
    env_x = (xs[0], xs[-1])
    env_y = (ys[0], ys[-1])
    lines = {}
    for room in world["rooms"]:
        if room["floor"] != floor_id:
            continue
        for (x0, y0), (x1, y1) in polygon_edges(room["polygon"]):
            if y0 == y1:
                lines.setdefault(("x", y0), []).append((min(x0, x1), max(x0, x1)))
            else:
                lines.setdefault(("y", x0), []).append((min(y0, y1), max(y0, y1)))
    openings = []
    cuts = {}
    for door in world["doors"]:
        if door["floor"] != floor_id:
            continue
        cx, cy = door["center"]
        half = door["width"] / 2
        if door["wallAxis"] == "x":
            key, span = ("x", cy), (cx - half, cx + half)
        else:
            key, span = ("y", cx), (cy - half, cy + half)
        cuts.setdefault(key, []).append(span)
        openings.append({"door": door["id"], "axis": key[0], "at": key[1], "from": span[0], "to": span[1],
                         "type": door["type"], "access": door["access"], "exit": door["exit"]})
    walls = []
    for (axis, at), ivals in sorted(lines.items()):
        exterior = (axis == "x" and at in env_y) or (axis == "y" and at in env_x)
        for a, b in _subtract(_merge(ivals), cuts.get((axis, at), [])):
            if b - a > EPS:
                walls.append({"axis": axis, "at": at, "from": round(a, 6), "to": round(b, 6),
                              "thickness": ex if exterior else inn, "exterior": exterior})
    return walls, openings


def wall_rect(wall):
    """Axis-aligned rectangle (x0, y0, x1, y1) of a wall piece, square caps of t/2."""
    t = wall["thickness"] / 2
    if wall["axis"] == "x":
        return wall["from"] - t, wall["at"] - t, wall["to"] + t, wall["at"] + t
    return wall["at"] - t, wall["from"] - t, wall["at"] + t, wall["to"] + t


def opening_rect(op, world):
    t = world["building"]["wall"]["exterior"] / 2 + 0.01
    if op["axis"] == "x":
        return op["from"], op["at"] - t, op["to"], op["at"] + t
    return op["at"] - t, op["from"], op["at"] + t, op["to"]


def room_by_id(world):
    return {r["id"]: r for r in world["rooms"]}


def room_at(world, floor_id, pt):
    for r in world["rooms"]:
        if r["floor"] == floor_id and point_in_polygon(pt, r["polygon"]):
            return r["id"]
    return None
