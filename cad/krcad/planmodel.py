"""Plan model: walls, doors, rooms, fixtures, vertical links, grid and dimension
chains for one floor, computed once from world.json and shared by every writer."""
from __future__ import annotations

import math

from tools.kantor.geometry import (
    derive_walls, fixture_corners, point_in_polygon, polygon_area, polygon_edges, room_at)

from krcad.common import *  # noqa: F401,F403
from krcad.common import TagFonts

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


def build_plan(world, floor_id, den=100, tf=None, with_tags=True):
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
    # The tag search is the slow part; overlay sheets place their own labels.
    tags = _layout_room_tags(rooms, [w["rect"] for w in wall_items], obstacles, tf, den) if with_tags else {}
    return {"floor": floor_id, "den": den, "walls": wall_items, "openings": openings, "doors": door_items,
            "rooms": rooms, "fixtures": fixtures, "vlinks": vlinks, "grid": grid, "chains": chains,
            "extent": extent, "tags": tags, "fonts": tf}
