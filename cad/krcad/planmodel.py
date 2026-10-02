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


class OpeningDataError(ValueError):
    """world.json lacks or contradicts data the drawing needs (swing, window)."""


def _wall_rect(wall, openings):
    """Rectangle of a wall piece. Square caps (t/2) close corners and T-junctions,
    but an end that is a door or window jamb gets no cap, otherwise the cap would
    narrow the clear opening by t/2 on each side."""
    t = wall["thickness"] / 2
    jambs = [o for o in openings if o["axis"] == wall["axis"] and abs(o["at"] - wall["at"]) < 1e-9]
    cap0 = 0.0 if any(abs(wall["from"] - o["to"]) < 1e-6 for o in jambs) else t
    cap1 = 0.0 if any(abs(wall["to"] - o["from"]) < 1e-6 for o in jambs) else t
    if wall["axis"] == "x":
        return (wall["from"] - cap0, wall["at"] - t, wall["to"] + cap1, wall["at"] + t)
    return (wall["at"] - t, wall["from"] - cap0, wall["at"] + t, wall["to"] + cap1)


def window_span(win):
    """(axis, at, from, to) of a window along its wall, from world.json fields."""
    c = win["center"][0] if win["wallAxis"] == "x" else win["center"][1]
    return win["wallAxis"], win["at"], c - win["width"] / 2, c + win["width"] / 2


def split_walls_at_windows(walls, windows):
    """Break every wall piece where a window sits. A window that does not fall
    strictly inside one wall piece (over a door, past a corner, on an interior
    line that has no wall) is a dataset error, so it raises instead of drawing
    glass in thin air."""
    out = [dict(w) for w in walls]
    for win in windows:
        axis, at, lo, hi = window_span(win)
        host = [w for w in out if w["axis"] == axis and abs(w["at"] - at) < 1e-9
                and w["from"] < lo - 1e-9 and hi + 1e-9 < w["to"]]
        if len(host) != 1:
            raise OpeningDataError(f"{win['id']}: window {lo:.3f}-{hi:.3f} on {axis}@{at} is not inside one wall piece")
        w = host[0]
        out.remove(w)
        out += [{**w, "from": w["from"], "to": lo}, {**w, "from": hi, "to": w["to"]}]
    out.sort(key=lambda w: (w["axis"], w["at"], w["from"]))
    return out


def _check_swing(door):
    sw = door.get("swing")
    if door["type"] not in ("single", "double"):
        return None
    if not sw or "into" not in sw or "hinge" not in sw:
        raise OpeningDataError(f"{door['id']}: {door['type']} door has no swing data in world.json")
    if sw["into"] not in door["rooms"]:
        raise OpeningDataError(f"{door['id']}: swing.into {sw['into']} is not one of {door['rooms']}")
    want = ("both",) if door["type"] == "double" else ("low", "high")
    if sw["hinge"] not in want:
        raise OpeningDataError(f"{door['id']}: hinge {sw['hinge']} invalid for a {door['type']} door")
    return sw


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
    sw = _check_swing(door)
    # Side and hinge come from world.json doors[].swing (P03). The leaf opens
    # into swing.into; hinge low/high is the jamb at the lower/higher coordinate
    # along the wall axis.
    if sw:
        target = sw["into"]
        if target not in (plus, minus):
            raise OpeningDataError(f"{door['id']}: swing.into {target} is on neither side ({minus}, {plus})")
    else:
        # Opening / sliding / hatch has no leaf; the side only decides where the
        # tag goes: on the circulation side, so it reads from the corridor.
        cats = {r["id"]: r["category"] for r in world["rooms"]}
        a, b = door["rooms"]
        target = b if cats.get(a) == "circulation" and cats.get(b) != "circulation" else \
            a if cats.get(b) == "circulation" and cats.get(a) != "circulation" else b
        if target not in (plus, minus):
            target = plus
    sign = +1 if target == plus else -1
    hinge_from = sw is None or sw["hinge"] == "low"
    w = op["to"] - op["from"]
    vf = sign * t / 2
    sym = {"id": door["id"], "type": door["type"], "width": w, "axis": axis, "at": at, "thickness": t,
           "sign": sign, "target": target, "hinge": sw["hinge"] if sw else None, "leaves": [], "arcs": [],
           "dashed": [], "panels": [], "lines": []}

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


GLASS_GAP = 0.025  # half distance between the two glass lines, m
SILL_PROJ = 0.05  # interior window board projection past the wall face and jambs, m
OBSCURE_PITCH = 0.09  # diagonal hatch pitch for obscured glazing, m (0,9 mm at 1:100)


def _clip_diagonals(x0, y0, x1, y1, pitch):
    """45 degree hatch lines clipped to an axis-aligned rectangle."""
    segs = []
    k = x0 - y1 + pitch / 2
    while k < x1 - y0:
        # Line y = x - k inside the rectangle.
        xa, xb = max(x0, y0 + k), min(x1, y1 + k)
        if xb - xa > 1e-6:
            segs.append(((xa, xa - k), (xb, xb - k)))
        k += pitch
    return segs


def _window_symbol(world, floor_id, win):
    """Concept plan symbol: wall break, both wall faces, a double glass line at
    the wall centre and the interior sill board; obscured glazing adds a
    diagonal hatch across the opening."""
    axis, at, lo, hi = window_span(win)
    t = world["building"]["wall"]["exterior"]
    mid = (lo + hi) / 2

    def to_world(u, v):
        return (u, at + v) if axis == "x" else (at + v, u)

    inside_plus = room_at(world, floor_id, to_world(mid, 0.05)) == win["room"]
    inside_minus = room_at(world, floor_id, to_world(mid, -0.05)) == win["room"]
    if inside_plus == inside_minus:
        raise OpeningDataError(f"{win['id']}: room {win['room']} is not on exactly one side of the window")
    out = -1 if inside_plus else +1  # exterior side
    sym = {"id": win["id"], "room": win["room"], "axis": axis, "at": at, "from": lo, "to": hi, "out": out,
           "width": win["width"], "sill": win["sill"], "head": win["head"], "glazing": win["glazing"],
           "thickness": t}
    sym["faces"] = [(to_world(lo, v), to_world(hi, v)) for v in (-t / 2, t / 2)]
    sym["glass"] = [(to_world(lo, v), to_world(hi, v)) for v in (-GLASS_GAP, GLASS_GAP)]
    vin = -out * t / 2
    sym["sill_line"] = [to_world(lo - SILL_PROJ, vin), to_world(lo - SILL_PROJ, vin - out * SILL_PROJ),
                        to_world(hi + SILL_PROJ, vin - out * SILL_PROJ), to_world(hi + SILL_PROJ, vin)]
    a, b = to_world(lo, -t / 2), to_world(hi, t / 2)
    sym["box"] = (min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))
    sym["hatch"] = _clip_diagonals(*sym["box"], OBSCURE_PITCH) if win["glazing"] == "obscured" else []
    sym["tag_rot"] = 0 if axis == "x" else 90
    sym["to_world"] = to_world
    return sym


def _place_window_tags(windows, obstacles, tf, den, size):
    """Short hexagon tags (W16) outside the exterior wall, between the wall
    face and the first dimension chain; text runs along the wall. Candidates
    slide along and away from the wall; the one with least overlap against
    swings, door tags, extension lines and the tags already placed wins."""
    pt_per_m = 1000.0 / den * PT_PER_MM
    placed = []
    for w in windows:
        text = window_tag_text(w["id"])
        _, hw_pt, hh_pt = window_tag_shape(tf.width(text, tf.medium, size), size)
        along, across = hw_pt / pt_per_m, hh_pt / pt_per_m
        best = None
        mid = (w["from"] + w["to"]) / 2
        for i, gap in enumerate((0.12, 0.3, 0.5)):
            d = gap + across
            for j, du in enumerate((0.0, -0.3, 0.3, -0.6, 0.6, -0.9, 0.9)):
                x, y = w["to_world"](mid + du, w["out"] * (w["thickness"] / 2 + d))
                box = (x - along, y - across, x + along, y + across) if w["tag_rot"] == 0 else \
                    (x - across, y - along, x + across, y + along)
                hit = sum(rect_overlap(box, o) for o in obstacles + placed)
                cost = hit * 100 + i * 0.05 + j * 0.01
                if best is None or cost < best[0]:
                    best = (cost, (x, y), box, hit)
        w["tag_pos"], w["tag_box"], w["tag_overlap_m2"] = best[1], best[2], round(best[3], 5)
        w["tag_size"], w["tag_text"] = size, text
        placed.append(best[2])


def window_tag_outline(w, den, tf):
    """Hexagon of a placed window tag in world metres (DXF and generic views)."""
    pts, _, _ = window_tag_shape(tf.width(w["tag_text"], tf.medium, w["tag_size"]), w["tag_size"])
    k = den / 1000.0 / PT_PER_MM  # pt on paper -> world m
    r = math.radians(w["tag_rot"])
    c, s = math.cos(r), math.sin(r)
    x0, y0 = w["tag_pos"]
    return [(x0 + (px * c - py * s) * k, y0 + (px * s + py * c) * k) for px, py in pts]


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
            # Label centre clear of the first riser for a label up to ~0,4 m tall (1:100 A2 or 1:200 A3).
            item["label_pos"] = _fixture_local(fx, xf, -hl - 0.42)
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


def _tag_lines(room, area, tf, body, compact=False):
    """Full tag = ID, name, area. Compact tag (ID + area) is for rooms too small
    for a full tag; their names stay readable in the sheet's room list. Sizes
    never go below `body`, the sheet's legible size."""
    from reportlab.lib.utils import simpleSplit
    id_size, name_size, area_size = body * 1.12, body, body
    lines = [(room["id"], tf.bold, id_size, "id")]
    if not compact:
        name_lines = simpleSplit(room["name"], tf.regular, name_size, 34 * PT_PER_MM * body / 7.0)
        lines += [(n, tf.regular, name_size, "name") for n in name_lines]
    lines.append((fmt_area(area), tf.medium, area_size, "area"))
    return lines


def segment_hits(a, b, boxes, n=24):
    """True when the segment a-b passes through any box (sampled, fine enough
    for leaders a few metres long against tags tens of centimetres wide)."""
    for k in range(1, n):
        t = k / n
        x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        if any(bx[0] < x < bx[2] and bx[1] < y < bx[3] for bx in boxes):
            return True
    return False


def _layout_room_tags(rooms, wall_rects, obstacles, hard, tf, den, body):
    """Pick a tag position per room that stays inside the room, off the walls
    and `hard` boxes (door tags, labels), and overlaps as little furniture and
    swing area as possible. A room too small even for the compact tag gets it
    in the nearest free spot of a neighbouring room, with a leader."""
    pt_per_m = 1000.0 / den * PT_PER_MM
    tags = {}
    taken = []

    def size_of(lines, compact):
        w_pt = max(tf.width(t, f, s) for t, f, s, _ in lines) + (1.5 if compact else 3)
        h_pt = sum(s * 1.16 for _, _, s, _ in lines) + 2
        return w_pt / pt_per_m, h_pt / pt_per_m

    def blocked(box):
        return any(rect_overlap(box, wr) > 1e-9 for wr in wall_rects) or \
            any(rect_overlap(box, hb) > 1e-9 for hb in hard + taken)

    pending = []
    for room in rooms:
        poly = room["polygon"]
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        cx, cy = poly_centroid(poly)
        best = None
        for compact in (False, True):
            lines = _tag_lines(room, room["area"], tf, body, compact)
            w, h = size_of(lines, compact)
            pad = 0.02 if compact else 0.06
            step = 0.1
            nx = int((max(xs) - min(xs)) / step) + 1
            ny = int((max(ys) - min(ys)) / step) + 1
            for i in range(nx):
                for j in range(ny):
                    px, py = min(xs) + i * step, min(ys) + j * step
                    box = (px - w / 2 - pad, py - h / 2 - pad, px + w / 2 + pad, py + h / 2 + pad)
                    corners = [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]
                    if not all(point_in_polygon(c, poly) for c in corners) or blocked(box):
                        continue
                    hit = sum(rect_overlap(box, ob) for ob in obstacles)
                    cost = hit * 40 + math.hypot(px - cx, py - cy) + (3 if compact else 0)
                    if best is None or cost < best["cost"]:
                        best = {"cost": cost, "pos": (px, py), "lines": lines, "box_m": (w, h), "box": box,
                                "overlap_m2": hit, "compact": compact}
            if best is not None and best["overlap_m2"] < 1e-6:
                break
        if best is None:
            pending.append(room)
            continue
        taken.append(best["box"])
        tags[room["id"]] = best
    for room in pending:
        lines = _tag_lines(room, room["area"], tf, body, True)
        w, h = size_of(lines, True)
        cx, cy = poly_centroid(room["polygon"])
        best = None
        for k in range(1, 30):
            rad = k * 0.25
            for a in range(0, 360, 15):
                px, py = cx + rad * math.cos(math.radians(a)), cy + rad * math.sin(math.radians(a))
                box = (px - w / 2, py - h / 2, px + w / 2, py + h / 2)
                corners = [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]
                host = next((r for r in rooms if all(point_in_polygon(c, r["polygon"]) for c in corners)), None)
                if host is None or host["id"] == room["id"] or blocked(box):
                    continue
                end = (min(max(cx, box[0]), box[2]), min(max(cy, box[1]), box[3]))
                if segment_hits((cx, cy), end, hard + taken):
                    continue  # a leader through a door tag or another label reads as pointing at it
                hit = sum(rect_overlap(box, ob) for ob in obstacles)
                cost = hit * 40 + rad
                if best is None or cost < best["cost"]:
                    best = {"cost": cost, "pos": (px, py), "lines": lines, "box_m": (w, h), "box": box,
                            "overlap_m2": hit, "compact": True}
            if best is not None and best["overlap_m2"] < 1e-6:
                break
        if best is None:
            raise ValueError(f"{room['id']}: no spot for a legible room tag inside or beside the room")
        bx = best["box"]
        best["leader"] = ((cx, cy), (min(max(cx, bx[0]), bx[2]), min(max(cy, bx[1]), bx[3])))
        taken.append(bx)
        tags[room["id"]] = best
    return tags


def build_plan(world, floor_id, den=100, tf=None, with_tags=True, paper="A2"):
    """paper = sheet size the plan is drawn on; window tags are sized so they
    print legibly when that sheet is shrunk to A3 (common.legible_pt)."""
    tf = tf or TagFonts()
    walls, openings = derive_walls(world, floor_id)
    env = floor_of(world, floor_id)["envelope"]
    env_box = (min(p[0] for p in env), min(p[1] for p in env), max(p[0] for p in env), max(p[1] for p in env))
    doors = {d["id"]: d for d in world["doors"]}
    floor_windows = sorted((w for w in world.get("windows", []) if w["floor"] == floor_id), key=lambda w: w["id"])
    jambs = list(openings) + [dict(zip(("axis", "at", "from", "to"), window_span(w))) for w in floor_windows]
    wall_items = [{**w, "rect": _wall_rect(w, jambs)} for w in split_walls_at_windows(walls, floor_windows)]
    door_items = [_door_symbol(world, floor_id, op, doors[op["door"]], walls, env_box) for op in openings]
    window_items = [_window_symbol(world, floor_id, w) for w in floor_windows]
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
    door_tag_size = legible_pt(paper)
    for d in door_items:
        obstacles.append(d["swing_box"])
        d["tag_text"] = door_tag_text(d["id"])
        tw = (tf.width(d["tag_text"], tf.medium, door_tag_size) + 2) / pt_per_m
        th = (door_tag_size + 2) / pt_per_m
        x, y = d["tag_pos"]
        if d["tag_rot"] == 0:
            d["tag_box"] = (x - tw / 2, y - th / 2, x + tw / 2, y + th / 2)
        else:
            d["tag_box"] = (x - th / 2, y - tw / 2, x + th / 2, y + tw / 2)
        d["tag_size"] = door_tag_size
        obstacles.append(d["tag_box"])
    hard = [d["tag_box"] for d in door_items]
    # Window tags avoid swings, door tags and the dimension extension lines
    # that run from the wall face out to the first chain.
    x0e, y0e, x1e, y1e = extent
    win_obstacles = list(obstacles)
    for ch in chains:
        if ch["kind"] != "ruang":
            continue
        for val in ch["values"]:
            if ch["side"] == "S":
                win_obstacles.append((val - 0.04, y0e - ch["offset"], val + 0.04, y0e))
            elif ch["side"] == "N":
                win_obstacles.append((val - 0.04, y1e, val + 0.04, y1e + ch["offset"]))
            elif ch["side"] == "W":
                win_obstacles.append((x0e - ch["offset"], val - 0.04, x0e, val + 0.04))
            else:
                win_obstacles.append((x1e, val - 0.04, x1e + ch["offset"], val + 0.04))
    for g in grid["x"]:
        win_obstacles.append((g["at"] - 0.03, y0e - 3, g["at"] + 0.03, y1e + 3))
    for g in grid["y"]:
        win_obstacles.append((x0e - 3, g["at"] - 0.03, x1e + 3, g["at"] + 0.03))
    _place_window_tags(window_items, win_obstacles, tf, den, legible_pt(paper))
    for w in window_items:
        del w["to_world"]  # keep the plan model plain data
        obstacles.append(w["box"])
        xs, ys = [q[0] for q in w["sill_line"]], [q[1] for q in w["sill_line"]]
        obstacles.append((min(xs), min(ys), max(xs), max(ys)))
    # The tag search is the slow part; overlay sheets place their own labels.
    for vl in vlinks:
        if vl["label"]:
            lw = tf.width(vl["label"], tf.bold, door_tag_size) / pt_per_m + 0.1
            lh = door_tag_size / pt_per_m
            lx, ly = vl["label_pos"]
            hard.append((lx - lw / 2, ly - lh / 2, lx + lw / 2, ly + lh / 2))
    tags = _layout_room_tags(rooms, [w["rect"] for w in wall_items], obstacles, hard, tf, den,
                             legible_pt(paper)) if with_tags else {}
    return {"floor": floor_id, "den": den, "walls": wall_items, "openings": openings, "doors": door_items,
            "windows": window_items, "rooms": rooms, "fixtures": fixtures, "vlinks": vlinks, "grid": grid, "chains": chains,
            "extent": extent, "tags": tags, "fonts": tf}
