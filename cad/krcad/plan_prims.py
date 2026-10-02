"""Floor plan base drawn as generic primitives (for furniture, ICT, finish and
pathway sheets). Geometry comes from krcad.planmodel.build_plan, the same model
the A-101/A-102 writers use."""
from __future__ import annotations

import math

from tools.kantor.geometry import fixture_corners, point_in_polygon

from krcad.common import *  # noqa: F401,F403
from krcad.draw import View, fs, text_w_mm, wrap
from krcad.planmodel import _fixture_local, segment_hits, window_tag_outline

LIGHT_WALL = "#9aa9a1"
LIGHT_WALL_EXT = "#6f8379"


def plan_base(v: View, plan, mode="full", doors=True, door_tags=False, grid=True, fixtures="full",
              vlinks=True, room_outline=True, window_tags=False):
    """mode 'full' = green poche walls; 'light' = grey walls so overlays read first.

    Windows are always drawn: walls are split at them, so leaving the symbol
    out would read as a hole in the envelope."""
    light = mode == "light"
    for ext in (False, True):
        colr = (LIGHT_WALL_EXT if ext else LIGHT_WALL) if light else (GREEN if ext else WALL_INT)
        for w in plan["walls"]:
            if w["exterior"] != ext:
                continue
            x0, y0, x1, y1 = w["rect"]
            v.rect(x0, y0, x1, y1, "A-WALL", stroke=colr, fill=colr, width=0.2,
                   xd=("wall", f"{w['axis']}@{w['at']}:{w['from']}-{w['to']}", {"exterior": int(w["exterior"])}))
    if room_outline:
        for r in plan["rooms"]:
            v.poly(r["polygon"], "A-AREA", closed=True, stroke="#a0b4aa", width=0.2, xd=("room", r["id"]), only="dxf")
    if doors:
        dc = LIGHT_WALL_EXT if light else GREEN
        for d in plan["doors"]:
            xd = ("door", d["id"], {"type": d["type"]})
            for a, b in d["leaves"]:
                v.line(a, b, "A-DOOR", stroke=dc, width=0.6, xd=xd)
            for c, r, a0, a1 in d["arcs"]:
                v.arc(c, r, a0, a1, "A-DOOR", stroke=dc, width=0.25, xd=xd)
            for a, b in d["dashed"]:
                v.line(a, b, "A-DOOR", stroke=dc, width=0.25, dash=(2, 1.5), xd=xd)
            for poly in d["panels"]:
                v.poly(poly, "A-DOOR", closed=True, stroke=dc, fill="#ffffff", width=0.25, xd=xd)
            for a, b in d["lines"]:
                v.line(a, b, "A-DOOR", stroke=dc, width=0.25, xd=xd)
            if door_tags:
                v.text(d["tag_pos"], d["id"], "A-DOOR-IDEN", size=4.6, font="M", color=GREY_TEXT, align="c",
                       rot=d["tag_rot"], knock=True, xd=xd)
    wc = LIGHT_WALL_EXT if light else GREEN
    for w in plan.get("windows", []):
        xd = ("window", w["id"], {"glazing": w["glazing"], "room": w["room"], "sill": w["sill"], "head": w["head"],
                                  "width": w["width"]})
        for a, b in w["faces"]:
            v.line(a, b, "A-GLAZ", stroke=wc, width=0.4, xd=xd)
        for a, b in w["glass"]:
            v.line(a, b, "A-GLAZ", stroke=wc, width=0.25, xd=xd)
        v.poly(w["sill_line"], "A-GLAZ", stroke=wc, width=0.35, xd=xd)
        for a, b in w["hatch"]:
            v.line(a, b, "A-GLAZ", stroke=wc, width=0.2, xd=xd)
        if window_tags:
            txd = ("window", w["id"], {"tag": w["tag_text"]})
            v.poly(window_tag_outline(w, v.den, plan["fonts"]), "A-GLAZ-IDEN", closed=True, stroke=wc,
                   fill="#ffffff", width=0.5, xd=txd)
            # Baseline sits 0,35 em below the tag centre so the cap height is centred.
            off = w["tag_size"] * 0.35 / PT_PER_MM * v.m_per_mm()
            tx, ty = w["tag_pos"]
            v.text((tx + off, ty) if w["tag_rot"] else (tx, ty - off), w["tag_text"], "A-GLAZ-IDEN", size=w["tag_size"], font="M", color=INK, align="c",
                   rot=w["tag_rot"], xd=txd)
    if fixtures:
        fc = FURN if fixtures == "full" else "#c2bbb3"
        fw = 0.35 if fixtures == "full" else 0.25
        for fx in plan["fixtures"]:
            v.poly(fixture_corners(fx), "A-FURN", closed=True, stroke=fc, width=fw,
                   xd=("fixture", fx["id"], {"type": fx["type"], "room": fx["room"]}))
    if vlinks:
        for vl in plan["vlinks"]:
            sc = TERRA if not light else "#c58f78"
            v.poly(vl["outline"], "A-STRS", closed=True, stroke=sc, width=0.6,
                   xd=("vertical", vl["id"], {"type": vl["type"], "link": vl["vl"]}))
            for a, b in vl["lines"]:
                v.line(a, b, "A-STRS", stroke=sc, width=0.25)
            for poly in vl["polys"]:
                v.poly(poly, "A-STRS", closed=True, stroke=sc, width=0.25)
            if vl["label"]:
                # label_pos is the label centre; drop the baseline by half a cap height.
                cap = fs(5.5) * 0.7 / PT_PER_MM * v.m_per_mm()
                lx, ly = vl["label_pos"]
                v.text((lx, ly - cap / 2), vl["label"], "A-STRS", size=5.5, font="B", color=TERRA, align="c",
                       knock=True)
    if grid:
        x0, y0, x1, y1 = plan["extent"]
        mpm = v.m_per_mm()
        gsz = fs(8)
        # Bubble radius follows the label size so a legible label stays inside.
        rad = max(3.2, gsz * 0.95 / PT_PER_MM) * mpm
        bub = 14 * mpm + rad - 3.2 * mpm
        cap = gsz * 0.7 / PT_PER_MM * mpm
        for g in plan["grid"]["x"]:
            v.line((g["at"], y0 - bub + rad), (g["at"], y1 + bub - rad), "A-GRID", stroke=GRID, width=0.3,
                   dash=(8, 2, 1.2, 2), xd=("grid", g["label"]))
            for yb in (y0 - bub, y1 + bub):
                v.circle((g["at"], yb), rad, "A-GRID-IDEN", stroke=DIM, fill="#ffffff", width=0.5)
                v.text((g["at"], yb - cap / 2), g["label"], "A-GRID-IDEN", size=gsz, font="B", align="c")
        for g in plan["grid"]["y"]:
            v.line((x0 - bub + rad, g["at"]), (x1 + bub - rad, g["at"]), "A-GRID", stroke=GRID, width=0.3,
                   dash=(8, 2, 1.2, 2), xd=("grid", g["label"]))
            for xb in (x0 - bub, x1 + bub):
                v.circle((xb, g["at"]), rad, "A-GRID-IDEN", stroke=DIM, fill="#ffffff", width=0.5)
                v.text((xb, g["at"] - cap / 2), g["label"], "A-GRID-IDEN", size=gsz, font="B", align="c")


def _label_box(v: View, lines, sz, rot, center):
    mpm = v.m_per_mm()
    w = max(text_w_mm(t, sz, "B") for t in lines) * mpm + 0.1
    h = len(lines) * fs(sz) * 1.2 / PT_PER_MM * mpm + 0.06
    bw, bh = (w, h) if rot == 0 else (h, w)
    return (center[0] - bw / 2, center[1] - bh / 2, center[0] + bw / 2, center[1] + bh / 2)


def room_id_labels(v: View, plan, walls_rects, size=5.6, obstacles=(), with_area=False, color=GREEN,
                   layer="A-ANNO-RMNM"):
    """Room ID (optionally + area) label per room, at the sheet's legible size.

    Inside the room first (horizontal, then vertical). A room too small for a
    legible label (risers, shafts at 1:200) gets it in the nearest free spot of
    a neighbouring room with a thin leader to a dot inside the room; the label
    is never shrunk below the print floor. Returns {room: (pos, size, rot)};
    every label box is appended to `obstacles` when it is a list."""
    mpm = v.m_per_mm()
    sz = fs(size)
    placed, taken, pending = {}, [], []
    obstacles = obstacles if isinstance(obstacles, list) else list(obstacles)

    def inside(box, poly):
        cs = [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]
        return all(point_in_polygon(c, poly) for c in cs)

    def clear(box):
        return not any(rect_overlap(box, wr) > 1e-9 for wr in walls_rects) and \
            not any(rect_overlap(box, t) > 1e-9 for t in taken)

    def draw(r, lines, pos, rot):
        n = len(lines)
        for k, t in enumerate(lines):
            off = (n - 1) / 2 * sz * 1.2 / PT_PER_MM * mpm - k * sz * 1.2 / PT_PER_MM * mpm
            base = -sz * 0.36 / PT_PER_MM * mpm
            p = (pos[0], pos[1] + off + base) if rot == 0 else (pos[0] - off - base, pos[1])
            v.text(p, t, layer, size=sz, font="B" if k == 0 else "M", color=color if k == 0 else INK, align="c",
                   rot=rot, knock=True, xd=("room", r["id"]))

    for r in plan["rooms"]:
        poly = r["polygon"]
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        lines = [r["id"]] + ([fmt_area(r["area"])] if with_area else [])
        cx0, cy0 = sum(xs) / len(xs), sum(ys) / len(ys)
        best = None
        for rot in (0, 90):
            step = 0.2
            for i in range(int((max(xs) - min(xs)) / step) + 1):
                for j in range(int((max(ys) - min(ys)) / step) + 1):
                    pc = (min(xs) + i * step, min(ys) + j * step)
                    box = _label_box(v, lines, sz, rot, pc)
                    if not inside(box, poly) or not clear(box):
                        continue
                    hit = sum(rect_overlap(box, o) for o in obstacles)
                    cost = hit * 50 + math.hypot(pc[0] - cx0, pc[1] - cy0) * 0.2 + (rot / 90) * 2
                    if best is None or cost < best[0]:
                        best = (cost, pc, rot, box)
        if best is None:
            pending.append(r)
            continue
        _, pc, rot, box = best
        taken.append(box)
        draw(r, lines, pc, rot)
        placed[r["id"]] = (pc, sz, rot)
    # Leader labels for rooms too small, placed after every in-room label.
    for r in pending:
        poly = r["polygon"]
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        lines = [r["id"]] + ([fmt_area(r["area"])] if with_area else [])
        cx0, cy0 = sum(xs) / len(xs), sum(ys) / len(ys)
        best = None
        for k in range(1, 26):
            rad = k * 0.25
            for a in range(0, 360, 15):
                pc = (cx0 + rad * math.cos(math.radians(a)), cy0 + rad * math.sin(math.radians(a)))
                box = _label_box(v, lines, sz, 0, pc)
                host = next((o for o in plan["rooms"] if inside(box, o["polygon"])), None)
                if host is None or host["id"] == r["id"] or not clear(box):
                    continue
                end = (min(max(cx0, box[0]), box[2]), min(max(cy0, box[1]), box[3]))
                if segment_hits((cx0, cy0), end, taken):
                    continue
                hit = sum(rect_overlap(box, o) for o in obstacles)
                cost = hit * 50 + rad
                if best is None or cost < best[0]:
                    best = (cost, pc, box)
            if best is not None and best[0] < 50:
                break
        if best is None:
            raise ValueError(f"{r['id']}: no legible spot for its label inside or beside the room")
        _, pc, box = best
        taken.append(box)
        # Leader from a dot at the room centre to the nearest point on the label box.
        ex = min(max(cx0, box[0]), box[2])
        ey = min(max(cy0, box[1]), box[3])
        v.line((cx0, cy0), (ex, ey), layer, stroke=GREY_TEXT, width=0.3)
        v.circle((cx0, cy0), 0.6 * mpm, layer, stroke=None, fill=GREY_TEXT)
        draw(r, lines, pc, 0)
        placed[r["id"]] = (pc, sz, 0)
    obstacles.extend(taken)
    return placed


def plan_paper_layout(sheet, plan, den, ring_mm=22.0, panel_w=150.0, strip_mm=30.0):
    """A-101-like placement: plan zone left, panel right, title strip bottom."""
    pw, ph = PAPER_MM[sheet["size"]]
    frame = (20.0, 10.0, pw - 10.0, ph - 10.0)
    panel = (frame[2] - panel_w, frame[1], frame[2], frame[3])
    zone = (frame[0], frame[1] + strip_mm, panel[0], frame[3])
    x0, y0, x1, y1 = plan["extent"]
    bw, bh = (x1 - x0) * 1000 / den, (y1 - y0) * 1000 / den
    ox = zone[0] + ((zone[2] - zone[0]) - (bw + 2 * ring_mm)) / 2 + ring_mm - x0 * 1000 / den
    oy = zone[1] + ((zone[3] - zone[1]) - (bh + 2 * ring_mm)) / 2 + ring_mm - y0 * 1000 / den
    return {"frame": frame, "panel": panel, "zone": zone, "origin": (ox, oy)}


def stair_profile(world, fx, floor_from_elev):
    """U-stair (AS-DIM-05) as (flight1 steps, landing, flight2 steps) in the
    fixture's local frame: local y along the run, z height."""
    W, L = fx["size"][:2]
    hl = L / 2
    rise = world["building"]["floorToFloor"] / (2 * STAIR_RISERS_PER_FLIGHT)
    run = (STAIR_RISERS_PER_FLIGHT - 1) * STAIR_TREAD
    f1 = []
    for k in range(STAIR_RISERS_PER_FLIGHT):
        y0 = -hl + k * STAIR_TREAD
        f1.append((y0, floor_from_elev + (k + 1) * rise))
    landing = (-hl + run, hl, floor_from_elev + STAIR_RISERS_PER_FLIGHT * rise)
    f2 = []
    for k in range(STAIR_RISERS_PER_FLIGHT):
        y0 = -hl + run - k * STAIR_TREAD
        f2.append((y0, landing[2] + (k + 1) * rise))
    return {"f1": f1, "landing": landing, "f2": f2, "rise": rise, "tread": STAIR_TREAD, "half_len": hl,
            "half_w": W / 2, "gap": W - 2 * STAIR_FLIGHT_W}


def local_to_world(fx, lx, ly):
    return _fixture_local(fx, lx, ly)
