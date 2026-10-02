"""Pure-Python building specification derived from design/world.json.

No bpy here: the Blender builder, the Blender validator and the stdlib pytest
all call the same functions, so a change to world.json or walls.json is caught
everywhere at once. Coordinates are world metres (x east, y north, z up).

Wall caps: tools/kantor/geometry.py::wall_rect gives every wall piece a square
cap of t/2 at both ends. Applied blindly that cap would intrude t/2 into each
door opening, so here an end that touches a door opening on the same wall line
gets no cap; exterior walls along X own the four building corners (full t/2
cap) and exterior walls along Y stop at their inner face; every other end keeps
a t/2 cap recessed 2 mm (see wall_boxes) so T-junctions close without
coplanar faces.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from tools.kantor.geometry import derive_walls, fixture_aabb, point_in_polygon  # noqa: E402

WORLD = ROOT / "design" / "world.json"
WALLS = ROOT / "design" / "derived" / "walls.json"
DOOR_HEAD = 2.1
CAP_RECESS = 0.002
# concept window and door leaf dimensions (metres); not joinery details
FRAME_FACE = 0.05     # frame bar width seen on the facade
FRAME_DEPTH = 0.08    # frame depth across the wall
PANE_THICK = 0.012
MULLION_MIN_WIDTH = 1.2  # wider windows get one centre mullion
LEAF_THICK = 0.04
LEAF_GAP = 0.003      # clearance at each vertical leaf edge
LEAF_FLOOR = 0.02     # leaf bottom: top of the threshold plate
LEAF_HEAD_GAP = 0.01  # gap under the lintel
STAIR_RISERS = 24
EPS = 1e-6


def load_world(path=WORLD):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_walls(world, path=WALLS, derive_if_missing=False):
    """Derived walls; refuses a walls.json made from another world revision."""
    p = Path(path)
    if not p.exists():
        if not derive_if_missing:
            raise FileNotFoundError(f"{p} missing: run python3 tools/export_runtime.py")
        return derive_all(world)
    data = json.loads(p.read_text(encoding="utf-8"))
    if data.get("worldRevision") != world["revision"]["id"]:
        raise ValueError(f"walls.json revision {data.get('worldRevision')} != world {world['revision']['id']}: "
                         "run python3 tools/export_runtime.py")
    return data


def derive_all(world):
    out = {"worldRevision": world["revision"]["id"], "floors": {}}
    for f in world["floors"]:
        ws, ops = derive_walls(world, f["id"])
        out["floors"][f["id"]] = {"walls": ws, "openings": ops}
    return out


def floor_info(world, fid):
    f = next(f for f in world["floors"] if f["id"] == fid)
    xs = [p[0] for p in f["envelope"]]
    ys = [p[1] for p in f["envelope"]]
    return {"id": fid, "elevation": f["elevation"], "x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)}


def _touches_opening(axis, at, end, openings):
    for op in openings:
        if op["axis"] == axis and abs(op["at"] - at) < EPS and (abs(op["from"] - end) < EPS or abs(op["to"] - end) < EPS):
            return True
    return False


def wall_boxes(world, walls, fid):
    """[{id, x0, y0, x1, y1, z0, z1, thickness, exterior, length}] in world metres."""
    fi = floor_info(world, fid)
    height = world["building"]["ceilingHeight"]
    fl = walls["floors"][fid]
    out = []

    def cap(w, end):
        if _touches_opening(w["axis"], w["at"], end, fl["openings"]):
            return 0.0
        t = w["thickness"]
        # Exterior walls along X own the building corners; every other cap
        # stops 2 mm short so its end face sits inside the crossing wall
        # instead of being coplanar with it (coplanar faces z-fight in renders).
        if w["exterior"] and w["axis"] == "x" and end in (fi["x0"], fi["x1"]):
            return t / 2
        if w["exterior"] and w["axis"] == "y" and end in (fi["y0"], fi["y1"]):
            # stop at the inner face of the corner-owning x-wall: overlapping
            # coplanar facade faces shadow each other in Cycles (dark corner line)
            return -t / 2
        return t / 2 - CAP_RECESS

    for i, w in enumerate(fl["walls"]):
        t = w["thickness"]
        a = w["from"] - cap(w, w["from"])
        b = w["to"] + cap(w, w["to"])
        if w["axis"] == "x":
            x0, x1, y0, y1 = a, b, w["at"] - t / 2, w["at"] + t / 2
        else:
            x0, x1, y0, y1 = w["at"] - t / 2, w["at"] + t / 2, a, b
        out.append({"id": f"WALL-{fid}-{i:03d}", "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                    "z0": fi["elevation"], "z1": fi["elevation"] + height, "thickness": t,
                    "exterior": w["exterior"], "length": b - a, "axis": w["axis"]})
    return out


def opening_boxes(world, walls, fid):
    """Threshold (OPEN-*) and lintel (LINTEL-*) boxes for each derived opening."""
    fi = floor_info(world, fid)
    height = world["building"]["ceilingHeight"]
    ext = world["building"]["wall"]["exterior"]
    inn = world["building"]["wall"]["interior"]
    out = []
    for op in walls["floors"][fid]["openings"]:
        exterior = (op["axis"] == "x" and op["at"] in (fi["y0"], fi["y1"])) or \
                   (op["axis"] == "y" and op["at"] in (fi["x0"], fi["x1"]))
        t = ext if exterior else inn
        if op["axis"] == "x":
            x0, x1, y0, y1 = op["from"], op["to"], op["at"] - t / 2, op["at"] + t / 2
        else:
            x0, x1, y0, y1 = op["at"] - t / 2, op["at"] + t / 2, op["from"], op["to"]
        e = fi["elevation"]
        base = {"door": op["door"], "x0": x0, "y0": y0, "x1": x1, "y1": y1, "thickness": t,
                "width": op["to"] - op["from"], "axis": op["axis"], "exterior": exterior}
        out.append(dict(base, id=f"OPEN-{op['door']}", z0=e, z1=e + 0.02, part="threshold"))
        out.append(dict(base, id=f"LINTEL-{op['door']}", z0=e + DOOR_HEAD, z1=e + height, part="lintel"))
    return out


def _along(axis, center):
    return center[0] if axis == "x" else center[1]


def window_specs(world, fid):
    """Concept windows of one floor (world.json windows) in world metres.

    u0/u1: span along the wall axis; z0/z1: absolute sill/head; at: wall line;
    thickness: the exterior wall the window sits in.
    """
    fi = floor_info(world, fid)
    t = world["building"]["wall"]["exterior"]
    out = []
    for w in world.get("windows", []):
        if w["floor"] != fid:
            continue
        c = _along(w["wallAxis"], w["center"])
        out.append({"id": w["id"], "room": w["room"], "axis": w["wallAxis"], "at": w["at"], "center": c,
                    "u0": c - w["width"] / 2, "u1": c + w["width"] / 2, "width": w["width"],
                    "sill": w["sill"], "head": w["head"], "z0": fi["elevation"] + w["sill"],
                    "z1": fi["elevation"] + w["head"], "glazing": w["glazing"], "thickness": t})
    return out


def box_from_axis(axis, at, u0, u1, v0, v1, z0, z1):
    """Axis-aligned box from along-wall (u) and across-wall (v, offsets from the wall line) ranges."""
    if axis == "x":
        return {"x0": u0, "x1": u1, "y0": at + v0, "y1": at + v1, "z0": z0, "z1": z1}
    return {"x0": at + v0, "x1": at + v1, "y0": u0, "y1": u1, "z0": z0, "z1": z1}


def wall_windows(wb, windows):
    """Windows cut into one wall box (same axis and line, span inside the box)."""
    at = (wb["y0"] + wb["y1"]) / 2 if wb["axis"] == "x" else (wb["x0"] + wb["x1"]) / 2
    lo, hi = (wb["x0"], wb["x1"]) if wb["axis"] == "x" else (wb["y0"], wb["y1"])
    return [w for w in windows if w["axis"] == wb["axis"] and abs(w["at"] - at) < 1e-6
            and w["u0"] > lo + EPS and w["u1"] < hi - EPS]


def wall_parts(wb, windows):
    """Split a wall box around its windows: full-height piers, plus a below-sill
    and an above-head part over each window span. Returns [(box, full_height)];
    nothing of the wall remains between sill and head inside a window span."""
    cut = sorted(wall_windows(wb, windows), key=lambda w: w["u0"])
    if not cut:
        return [(dict(wb), True)]
    ax = wb["axis"]
    lo, hi = (wb["x0"], wb["x1"]) if ax == "x" else (wb["y0"], wb["y1"])
    v0, v1 = (wb["y0"], wb["y1"]) if ax == "x" else (wb["x0"], wb["x1"])

    def part(u0, u1, z0, z1):
        if ax == "x":
            return {"x0": u0, "x1": u1, "y0": v0, "y1": v1, "z0": z0, "z1": z1}
        return {"x0": v0, "x1": v1, "y0": u0, "y1": u1, "z0": z0, "z1": z1}
    out, u = [], lo
    for w in cut:
        if w["u0"] > u + EPS:
            out.append((part(u, w["u0"], wb["z0"], wb["z1"]), True))
        out.append((part(w["u0"], w["u1"], wb["z0"], w["z0"]), False))
        out.append((part(w["u0"], w["u1"], w["z1"], wb["z1"]), True))
        u = w["u1"]
    if hi > u + EPS:
        out.append((part(u, hi, wb["z0"], wb["z1"]), True))
    return out


def window_parts(w):
    """Pane (exactly the opening) and frame bars, as boxes, centred on the wall line."""
    ax, at = w["axis"], w["at"]
    pane = box_from_axis(ax, at, w["u0"], w["u1"], -PANE_THICK / 2, PANE_THICK / 2, w["z0"], w["z1"])
    f, d = FRAME_FACE, FRAME_DEPTH / 2
    bars = [box_from_axis(ax, at, w["u0"], w["u0"] + f, -d, d, w["z0"], w["z1"]),
            box_from_axis(ax, at, w["u1"] - f, w["u1"], -d, d, w["z0"], w["z1"]),
            box_from_axis(ax, at, w["u0"] + f, w["u1"] - f, -d, d, w["z0"], w["z0"] + f),
            box_from_axis(ax, at, w["u0"] + f, w["u1"] - f, -d, d, w["z1"] - f, w["z1"])]
    if w["width"] > MULLION_MIN_WIDTH:
        c = w["center"]
        bars.append(box_from_axis(ax, at, c - f / 3, c + f / 3, -d * 0.8, d * 0.8, w["z0"] + f, w["z1"] - f))
    return pane, bars


def _room_side(world, d, room_id):
    """+1 when room_id lies on the + side of the door's wall line, else -1."""
    room = next(r for r in world["rooms"] if r["id"] == room_id)
    lo, hi = d["center"][0 if d["wallAxis"] == "x" else 1] - d["width"] / 2, \
        d["center"][0 if d["wallAxis"] == "x" else 1] + d["width"] / 2
    at = d["center"][1] if d["wallAxis"] == "x" else d["center"][0]
    mid = (lo + hi) / 2
    probe = (mid, at + 0.05) if d["wallAxis"] == "x" else (at + 0.05, mid)
    return 1 if point_in_polygon(probe, room["polygon"]) else -1


def door_leaves(world, fid):
    """Swing door leaves in the closed position, origin on the hinge jamb.

    hinge low/high = jamb at the lower/higher coordinate along the wall axis,
    both = two half-width leaves (-1 low, -2 high). The leaf lies flush with the
    wall face on the side it opens into; open_deg is the rotation about the
    vertical axis through the origin (Blender +Z = glTF +Y, counter-clockwise
    seen from above) that swings it 90 degrees into that side.
    """
    fi = floor_info(world, fid)
    out = []
    for d in world["doors"]:
        sw = d.get("swing")
        if d["floor"] != fid or not sw:
            continue
        ax = d["wallAxis"]
        c = _along(ax, d["center"])
        lo, hi = c - d["width"] / 2, c + d["width"] / 2
        at = d["center"][1] if ax == "x" else d["center"][0]
        exterior = (ax == "x" and at in (fi["y0"], fi["y1"])) or (ax == "y" and at in (fi["x0"], fi["x1"]))
        t = world["building"]["wall"]["exterior" if exterior else "interior"]
        if sw["into"] == "EXT":
            other = next(r for r in d["rooms"] if r != "EXT")
            side = -_room_side(world, d, other)
        else:
            side = _room_side(world, d, sw["into"])
        leaves = [("low", lo, (lo + hi) / 2), ("high", hi, (lo + hi) / 2)] if sw["hinge"] == "both" else             [("low", lo, hi)] if sw["hinge"] == "low" else [("high", hi, lo)]
        v = side * (t / 2 - LEAF_THICK / 2)  # leaf centre line, flush with the face it opens toward
        for i, (hinge, u_h, u_far) in enumerate(leaves, start=1):
            dirn = 1 if u_far > u_h else -1
            # rotating the closed leaf (pointing along +/-u) by open_deg about +Z
            # makes it point to the 'into' side; derived per axis in the docstring test
            if ax == "x":
                open_deg = 90.0 * side * dirn
                origin = (u_h, at + v)
            else:
                open_deg = -90.0 * side * dirn
                origin = (at + v, u_h)
            out.append({"id": f"LEAF-{d['id']}-{i}", "door": d["id"], "leaf": i, "hinge": hinge, "into": sw["into"],
                        "axis": ax, "at": at, "u_hinge": u_h, "u_far": u_far, "dir": dirn, "side": side,
                        "origin": (origin[0], origin[1], fi["elevation"]), "width": abs(u_far - u_h),
                        "thickness": t, "open_deg": open_deg,
                        "z0": fi["elevation"] + LEAF_FLOOR, "z1": fi["elevation"] + DOOR_HEAD - LEAF_HEAD_GAP})
    return out


def leaf_local_box(leaf):
    """Leaf box in its own frame (origin on the hinge, z from the floor)."""
    u0 = LEAF_GAP if leaf["dir"] > 0 else -(leaf["width"] - LEAF_GAP)
    u1 = leaf["width"] - LEAF_GAP if leaf["dir"] > 0 else -LEAF_GAP
    h0, h1 = LEAF_FLOOR, DOOR_HEAD - LEAF_HEAD_GAP
    hl = LEAF_THICK / 2
    if leaf["axis"] == "x":
        return {"x0": u0, "x1": u1, "y0": -hl, "y1": hl, "z0": h0, "z1": h1}
    return {"x0": -hl, "x1": hl, "y0": u0, "y1": u1, "z0": h0, "z1": h1}


def vertical_fixtures(world, fid):
    return [f for f in world["fixtures"] if f["floor"] == fid and f["type"] in ("stair_u", "lift")]


def slab_spec(world, fid):
    """Slab top at floor elevation, 0.3 thick. Upper floors get voids over stair/lift."""
    fi = floor_info(world, fid)
    t = world["building"]["slab"]
    holes = []
    if fi["elevation"] > 0:
        for fx in vertical_fixtures(world, fid):
            holes.append(tuple(round(v, 6) for v in fixture_aabb(fx)))
    return {"id": f"SLAB-{fid}", "x0": fi["x0"], "y0": fi["y0"], "x1": fi["x1"], "y1": fi["y1"],
            "z0": fi["elevation"] - t, "z1": fi["elevation"], "holes": holes}


def roof_spec(world):
    top = max(f["elevation"] for f in world["floors"]) + world["building"]["floorToFloor"]
    fi = floor_info(world, world["floors"][-1]["id"])
    ext = world["building"]["wall"]["exterior"] / 2
    return {"id": "ROOF", "x0": fi["x0"] - ext, "y0": fi["y0"] - ext, "x1": fi["x1"] + ext, "y1": fi["y1"] + ext,
            "z0": top - world["building"]["slab"], "z1": top}


def stair_parts(size, risers=STAIR_RISERS, rise_total=4.0):
    """U stair in the fixture frame (origin footprint centre, z up, front -Y).

    Flight 1 climbs +Y on the -X half from the front edge to a rear landing at
    half height; flight 2 returns -Y on the +X half and arrives at the front
    edge at rise_total. Returns [(name, (cx, cy, z0), (sx, sy, sz))] boxes.
    """
    w, d, _ = size
    rise = rise_total / risers
    half = risers // 2
    gap = 0.10
    fw = (w - gap) / 2
    landing = 1.20
    run = (d - landing) / (half - 1)
    parts = []
    for i in range(half - 1):  # treads of flight 1; the last riser lands on the landing
        z1 = rise * (i + 1)
        y0 = -d / 2 + i * run
        parts.append((f"tread1_{i:02d}", (-(gap + fw) / 2, y0 + run / 2, 0.0), (fw, run, z1)))
    parts.append(("landing", (0.0, d / 2 - landing / 2, rise * half - 0.20), (w, landing, 0.20)))
    for i in range(half - 1):
        z1 = rise * (half + i + 1)
        y1 = d / 2 - landing - i * run
        parts.append((f"tread2_{i:02d}", ((gap + fw) / 2, y1 - run / 2, z1 - 0.20), (fw, run, 0.20)))
    # stringer walls under flight 2 and the central spine keep the U readable
    parts.append(("spine", (0.0, -landing / 2, 0.0), (gap, d - landing, rise * half)))
    return parts, {"risers": risers, "riser_m": rise, "tread_m": run, "flight_width_m": fw, "landing_m": landing}


def transform_point(fx, lx, ly):
    r = math.radians(fx["rot"])
    c, s = math.cos(r), math.sin(r)
    return fx["pos"][0] + lx * c - ly * s, fx["pos"][1] + lx * s + ly * c


def building_expectations(world, walls):
    """Everything the validators compare against, per floor."""
    out = {}
    for f in world["floors"]:
        fid = f["id"]
        out[fid] = {
            "elevation": f["elevation"],
            "walls": wall_boxes(world, walls, fid),
            "openings": opening_boxes(world, walls, fid),
            "slab": slab_spec(world, fid),
            "rooms": [r["id"] for r in world["rooms"] if r["floor"] == fid],
            "windows": window_specs(world, fid),
            "leaves": door_leaves(world, fid),
            "vertical": [{"id": fx["id"], "type": fx["type"], "pos": fx["pos"], "rot": fx["rot"], "size": fx["size"]}
                         for fx in vertical_fixtures(world, fid)],
        }
    return out


def gltf_to_world(p):
    """glTF (x, y, z) -> world (x, -z, y): inverse of the exporter's Y-up mapping."""
    return (p[0], -p[2], p[1])


def world_to_gltf(p):
    return (p[0], p[2], -p[1])
