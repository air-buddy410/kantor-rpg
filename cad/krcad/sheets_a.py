"""Architecture sheets: A-001 cover/index, A-103 room schedule, A-201/A-202
furniture layouts, A-301 elevations, A-401 sections."""
from __future__ import annotations

import math

from tools.kantor.geometry import fixture_corners, polygon_area, room_at

from krcad.common import *  # noqa: F401,F403
from krcad.draw import (Col, LabelPlacer, SheetDoc, draw_table, frame_and_title, fs, heading, north_arrow,
                        paragraph, scale_bar, table_rows_height, text_w_mm, window_tag, window_tag_size_m, wrap)
from krcad.plan_prims import plan_base, plan_paper_layout, room_id_labels, stair_profile, local_to_world
from krcad.planmodel import _clip_diagonals, build_plan, window_span

# Values the dataset does not hold; drawn only with these labels on the sheet.
DOOR_HEAD = 2.1
PARAPET = 1.0


def make_meta(sheet, world, ctx, floor="-"):
    rev = world["revision"]
    return {"KR_SHEET_ID": sheet["id"], "KR_TITLE": sheet["title"], "KR_FLOOR": floor,
            "KR_SCALE": f"{sheet['scale']} @ {sheet['size']}", "KR_REVISION": rev["id"], "KR_REV_DATE": rev["date"],
            "KR_RENDER_UTC": ctx["utc"], "KR_STATUS": STATUS, "KR_NOTE": "Bukan untuk konstruksi",
            "KR_DRAWN": DRAWN_BY, "KR_CHECK": CHECKED_BY, "KR_WORLD_SHA256": ctx["sha"],
            "KR_GENERATOR": f"{GENERATOR} v{GENERATOR_VERSION}"}


def view_title(page, x, y, title, scale_text, layer="A-ANNO-NOTE", size=10):
    page.text((x, y), title, layer, size=size, font="B", color=GREEN)
    page.text((x + text_w_mm(title, size, "B") + 4, y + 0.3), scale_text, layer, size=7, color=INK)
    page.line((x, y - 1.6), (x + text_w_mm(title, size, "B"), y - 1.6), layer, stroke=GREEN, width=0.8)


def assumption_lines(world, ids):
    by = {a["id"]: a["text"] for a in world["assumptions"]}
    missing = [i for i in ids if i not in by]
    assert not missing, f"assumptions missing in world.json: {missing}"
    return [(i, by[i]) for i in ids]


def assumptions_block(page, x, y, width, world, ids, size=6.2, title="ASUMSI"):
    y = heading(page, x, y, title, width, size=8)
    for aid, text in assumption_lines(world, ids):
        page.text((x, y - size / PT_PER_MM * 1.05), aid, "A-ANNO-NOTE", size=size, font="B", color=GREEN)
        y = paragraph(page, x + 17, y, text, width - 17, size=size)
    return y


# ------------------------------------------------------------------ A-103

def build_room_schedule(sheet, ctx):
    from tools.room_schedule import build as rs_build
    world = ctx["world"]
    sd = SheetDoc(sheet, world, make_meta(sheet, world, ctx, "L1, L2"))
    sched = rs_build(world)
    rows_by_floor = {}
    for r in sched["rooms"]:
        rows_by_floor.setdefault(r["floor"], []).append(r)
    cols = [Col("ID", 22, "l", "B"), Col("Nama", 50), Col("Lantai", 11, "c"), Col("Kategori", 19),
            Col("Akses", 17), Col("Luas m²", 17, "r", "M"), Col("Kursi", 11, "r"), Col("Pintu", 76),
            Col("Finish lantai", 42), Col("Finish dinding", 40), Col("Finish plafon", 40)]
    rows = []
    checks = {}
    for f in world["floors"]:
        rr = rows_by_floor.get(f["id"], [])
        env = f["envelope"]
        env_area = polygon_area(env)
        total = round(sum(r["area_m2"] for r in rr), 2)
        ok = abs(total - env_area) < 0.01
        checks[f["id"]] = {"rooms": len(rr), "total_m2": total, "envelope_m2": env_area, "ok": ok,
                           "seats": sum(r["seats"] for r in rr)}
        for r in rr:
            rows.append([r["id"], r["name"], r["floor"], r["category"], r["access"], f"{r['area_m2']:.2f}".replace(".", ","),
                         str(r["seats"]), ", ".join(r["doors"]), r["finish"]["floor"], r["finish"]["wall"],
                         r["finish"]["ceiling"]])
        rows.append([f"Subtotal {f['id']}", f"{len(rr)} ruang", "", "", "", f"{total:.2f}".replace(".", ","),
                     str(checks[f["id"]]["seats"]),
                     f"cek: jumlah = envelope {fmt_area(env_area)} {'COCOK' if ok else 'TIDAK COCOK'}", "", "", ""])
    sd.summary = {"checks": checks, "rows": len(rows)}
    remaining = rows
    pages_rows = []
    # Paginate: first measure how many rows fit, then draw with the real page count.
    avail = 287 - 10 - 64 - 8
    while remaining:
        hs = table_rows_height(cols, remaining, 6.6, 1.2)
        used, n = 6.0, 0
        for h in hs:
            if used + h > avail:
                break
            used += h
            n += 1
        n = max(n, 1)
        pages_rows.append(remaining[:n])
        remaining = remaining[n:]
    n_pages = len(pages_rows) + 1  # + door and window schedule
    for i, chunk in enumerate(pages_rows):
        page = sd.new_page(f"{i + 1}/{n_pages}")
        (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, i + 1, n_pages, ctx["utc"], ctx["sha"])
        view_title(page, fx0 + 4, fy1 - 9, "ROOM SCHEDULE", "NTS · luas as-drawn dari polygon (AS-DIM-02)")
        draw_table(page, fx0 + 4, fy1 - 13, cols, chunk, size=6.6, lead=1.2,
                   row_xd=lambda row: ("room", row[0]) if not row[0].startswith("Subtotal") else None)
        y = fy0 + 49
        notes = [f"Sumber: tools/room_schedule.py atas design/world.json revisi {world['revision']['id']}; "
                 "tabel dan subtotal dihitung saat render.",
                 "Kursi = slot duduk dari fixture (AS-OCC-02), bukan target okupansi.",
                 "Pemeriksaan: jumlah luas ruang per lantai harus sama dengan luas envelope; hasil tertulis di baris "
                 "subtotal tiap lantai.",
                 f"Halaman {i + 1} dari {n_pages}; schedule pintu dan jendela di halaman {n_pages}."]
        for n_ in notes:
            y = paragraph(page, fx0 + 4, y, n_, tb[0] - fx0 - 12, size=6.4, bullet=True)
    _opening_schedule_page(sd, ctx, n_pages)
    return sd


HINGE_SIDE = {("x", "low"): "barat", ("x", "high"): "timur", ("y", "low"): "selatan", ("y", "high"): "utara"}


def facade_of_window(world, win):
    env = floor_of(world, win["floor"])["envelope"]
    xs, ys = [p[0] for p in env], [p[1] for p in env]
    if win["wallAxis"] == "x":
        return "S" if abs(win["at"] - min(ys)) < 1e-9 else "N" if abs(win["at"] - max(ys)) < 1e-9 else None
    return "W" if abs(win["at"] - min(xs)) < 1e-9 else "E" if abs(win["at"] - max(xs)) < 1e-9 else None


def opening_schedule_rows(world):
    """Door and window schedule rows, every value straight from world.json."""
    doors = []
    for d in world["doors"]:
        sw = d.get("swing")
        if sw:
            into = "EXT (luar)" if sw["into"] == "EXT" else sw["into"]
            hinge = "both (2 daun)" if sw["hinge"] == "both" else f"{sw['hinge']} ({HINGE_SIDE[(d['wallAxis'], sw['hinge'])]})"
        else:
            into, hinge = "-", "-"
        doors.append([d["id"], door_tag_text(d["id"]), d["floor"], " / ".join(d["rooms"]), d["type"],
                      fmt_m(d["width"]), into, hinge, "ya" if d["exit"] else ""])
    wins = [[w["id"], window_tag_text(w["id"]), w["floor"], w["room"], facade_of_window(world, w) or "?",
             fmt_m(w["width"]), fmt_m(w["sill"]), fmt_m(w["head"]), "buram" if w["glazing"] == "obscured" else "bening"]
            for w in sorted(world.get("windows", []), key=lambda w: w["id"])]
    return doors, wins


def _opening_schedule_page(sd, ctx, n_pages):
    world = sd.world
    page = sd.new_page(f"{n_pages}/{n_pages}")
    (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, n_pages, n_pages, ctx["utc"], ctx["sha"])
    doors, wins = opening_schedule_rows(world)
    view_title(page, fx0 + 4, fy1 - 9, "SCHEDULE PINTU DAN JENDELA",
               f"NTS · dari world.json doors[] dan windows[] revisi {world['revision']['id']}")
    # Schedule text prints >= 2,5 mm on A3 (legible_pt): columns sized for that
    # font, rows packed with a 1,0 mm pad so both tables stay on one page.
    sheet_size = sd.sheet["size"]
    sz = legible_pt(sheet_size)
    k = sz / 6.2  # column widths below were laid out for 6,2 pt
    dcols = [Col("ID pintu", 22 * k, "l", "B"), Col("Tag", 9 * k, "l", "M"), Col("Lantai", 10 * k, "c"),
             Col("Ruang yang dihubungkan", 46 * k),
             Col("Tipe", 14 * k), Col("Lebar m", 12 * k, "c", "M"), Col("Buka ke", 23 * k), Col("Engsel", 21 * k),
             Col("Exit", 9 * k, "c")]
    wcols = [Col("ID jendela", 21 * k, "l", "B"), Col("Tag", 9 * k, "l", "M"), Col("Lantai", 10 * k, "c"),
             Col("Ruang", 23 * k), Col("Fasad", 11 * k, "c"), Col("Lebar m", 12 * k, "c", "M"),
             Col("Ambang m", 14 * k, "c", "M"), Col("Kepala m", 14 * k, "c", "M"), Col("Kaca", 13 * k)]
    x_d = fx0 + 4
    x_w = x_d + sum(c.width for c in dcols) + 6
    assert x_w + sum(c.width for c in wcols) <= fx1 - 2, f"A-103 {sheet_size}: schedule wider than the frame"
    top = fy1 - 13
    nd, yd = draw_table(page, x_d, top, dcols, doors, size=sz, lead=1.12, pad=1.0, row_xd=lambda r: ("door", r[0]))
    nw, yw = draw_table(page, x_w, top, wcols, wins, size=sz, lead=1.12, pad=1.0,
                        row_xd=lambda r: ("window", r[0]))
    assert nd == len(doors) and nw == len(wins), f"A-103 opening schedule truncated ({nd}/{len(doors)}, {nw}/{len(wins)})"
    assert yd > fy0 + 4 and yw > tb[3] + 30, f"A-103 opening schedule overflow ({yd:.1f}, {yw:.1f})"
    n_swing = sum(1 for d in world["doors"] if d.get("swing"))
    n_obs = sum(1 for w in world.get("windows", []) if w["glazing"] == "obscured")
    width = sum(c.width for c in wcols)
    y = heading(page, x_w, yw - 3, "CATATAN SCHEDULE", width, size=8.5)
    for n_ in [f"{len(doors)} pintu/bukaan ({n_swing} berdaun, data swing), {len(wins)} jendela ({n_obs} kaca buram).",
               "Tag = label di denah, tampak dan potongan. Jendela: W + nomor urut, unik untuk kedua lantai. "
               "Pintu: D + kode pintu pada lantainya (denah per lantai).",
               "Buka ke = ruang tempat daun berayun (swing.into). Engsel low/high = kusen di koordinat lebih "
               "kecil/besar sepanjang dinding; arah mata angin dalam kurung.",
               "Ambang dan kepala dari lantai jadi masing-masing ("
               + ", ".join(f"{f['id']} {fmt_elev(f['elevation'])} m" for f in world["floors"]) + "). "
               "Fasad S/E/N/W = selatan/timur/utara/barat (Y+ utara).",
               "Semua jendela konsep; kusen, material dan U-value belum didesain."]:
        y = paragraph(page, x_w, y, n_, width, size=sz, lead=1.15, bullet=True)
    assert y > tb[3] + 2, f"A-103 schedule notes overflow ({y:.1f})"
    sd.summary["opening_schedule"] = {"door_rows": nd, "window_rows": nw, "swing_doors": n_swing,
                                      "obscured_windows": n_obs, "page": n_pages}


# ------------------------------------------------------------------ A-201 / A-202

def fixture_key(fx_id: str) -> str:
    """In-plan furniture key: the fixture number without leading zeros
    (FX-L1-016 -> 16); the floor is the sheet's, and page 2 maps key to ID."""
    return str(int(fx_id.rsplit("-", 1)[1]))


def build_furniture(sheet, ctx):
    world = ctx["world"]
    floor = sheet["floor"]
    den = int(sheet["scale"].split(":")[1])
    plan = build_plan(world, floor, den, with_tags=False, paper=sheet["size"])
    sd = SheetDoc(sheet, world, make_meta(sheet, world, ctx, floor))
    b = sd.body
    page = sd.new_page("1/2")
    lay = plan_paper_layout(sheet, plan, den)
    (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, 1, 2, ctx["utc"], ctx["sha"],
                                               tb_origin=(lay["panel"][0], lay["frame"][1]), tb_w=150)
    page.line((lay["panel"][0], fy0), (lay["panel"][0], fy1), "A-ANNO-TTLB", stroke=GREEN, width=0.8)
    z = lay["zone"]
    v = page.view("plan", den, lay["origin"], (z[0] + 1, z[1] + 1, z[2] - 1, z[3] - 1))
    plan_base(v, plan, mode="full", fixtures="full", window_tags=True)
    wall_rects = [w["rect"] for w in plan["walls"]]
    fx_boxes = []
    for fx in plan["fixtures"]:
        pts = fixture_corners(fx)
        fx_boxes.append((min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts),
                         max(p[1] for p in pts)))
    mpm = v.m_per_mm()
    label_boxes = []
    for vl in plan["vlinks"]:
        if vl["label"]:
            w_ = text_w_mm(vl["label"], 5.5, "B") * mpm
            h_ = fs(5.5) / PT_PER_MM * mpm
            lx, ly = vl["label_pos"]
            label_boxes.append((lx - w_ / 2 - 0.05, ly - h_ / 2, lx + w_ / 2 + 0.05, ly + h_ / 2))
    room_obst = fx_boxes + label_boxes
    room_id_labels(v, plan, wall_rects, size=6.2, obstacles=room_obst)
    label_boxes += room_obst[len(fx_boxes) + len(label_boxes):]
    # Fixture keys: number without leading zeros, inside the footprint when it
    # fits, otherwise beside it with a short leader to the footprint centre.
    placer = LabelPlacer(v, obstacles=list(wall_rects) + outside_strips(plan) + label_boxes
                         + [d["swing_box"] for d in plan["doors"]])
    all_fx = plan["fixtures"] + [f for f in world["fixtures"] if f["floor"] == floor
                                 and world["catalog"][f["type"]].get("family") == "shell"]
    worst = 0.0
    leaders = 0
    for fx in sorted(all_fx, key=lambda f: f["id"]):
        key = fixture_key(fx["id"])
        w = text_w_mm(key, b, "B") * mpm + 0.08
        h = b / PT_PER_MM * mpm * 1.05
        cx, cy = fx["pos"]
        box, hit = placer.place_box((cx, cy), w, h, gap=0.1, extra_cands=[(cx - w / 2, cy - h / 2)])
        worst = max(worst, hit)
        if not (box[0] <= cx <= box[2] and box[1] <= cy <= box[3]):
            ex, ey = min(max(cx, box[0]), box[2]), min(max(cy, box[1]), box[3])
            v.line((cx, cy), (ex, ey), "A-FURN-IDEN", stroke="#4a423b", width=0.25)
            leaders += 1
        v.text(((box[0] + box[2]) / 2, box[1] + (box[3] - box[1]) * 0.2), key, "A-FURN-IDEN", size=b, font="B",
               color="#4a423b", align="c", knock=True, xd=("fixture", fx["id"]))
    sd.summary["key_overlap_m2_max"] = round(worst, 4)
    sd.summary["key_leaders"] = leaders
    sd.summary["fixtures"] = len(all_fx)
    # Title strip and scale.
    view_title(page, fx0 + 6, fy0 + 19, sheet["title"].upper(), f"Skala {sheet['scale']} @ {sheet['size']}")
    paragraph(page, fx0 + 6, fy0 + 14, "Angka pada furniture = nomor fixture (FX-" + floor + "-nnn tanpa nol depan); "
              "ID lengkap di halaman 2. Segi enam Wnn = jendela (schedule A-103).", 150, size=b)
    scale_bar(page, fx0 + 175, fy0 + 12, den, (0, 1, 2, 5, 10))
    # Panel: north arrow, then the type table with counts.
    px0, px1 = lay["panel"][0] + 5, lay["panel"][2] - 5
    pw = px1 - px0
    y = fy1 - 4
    north_arrow(page, px0 + 8, y - 11, r=6)
    y = paragraph(page, px0 + 18, y - 2, "Utara = sumbu Y+ dunia", pw - 18, size=b * 1.1, font="B")
    y = paragraph(page, px0 + 18, y, f"Lantai {floor}: {floor_of(world, floor)['name']}", pw - 18, size=b)
    y = paragraph(page, px0 + 18, y, "Ukuran furniture = target catalog (AS-DIM-04).", pw - 18, size=b)
    y = min(y, fy1 - 26) - 2
    counts = {}
    for fx in all_fx:
        counts[fx["type"]] = counts.get(fx["type"], 0) + 1
    y = heading(page, px0, y, f"JENIS FIXTURE ({len(counts)} jenis, {len(all_fx)} unit)", pw)
    trows = []
    for t in sorted(counts, key=lambda k: (-counts[k], k)):
        cat = world["catalog"][t]
        trows.append([cat["label"], f"{cat['size'][0]:g}x{cat['size'][1]:g}".replace(".", ","), str(counts[t])])
    tcols = [Col("Jenis (catalog)", pw - 34), Col("Ukuran m", 24), Col("n", 10, "r", "M")]
    _, y = draw_table(page, px0, y, tcols, trows, size=b, lead=1.08, pad=0.8)
    y = paragraph(page, px0, y - 2, "Nomor kunci per fixture dan ruangnya: halaman 2.", pw, size=b, font="M")
    assert y > tb[3] + 2, f"{sheet['id']}: panel overflows title block ({y:.1f} <= {tb[3]:.1f})"
    sd.summary["panel_bottom_mm"] = round(y, 1)
    # Page 2: key table, number -> fixture ID, type and room, at the same legible size.
    page2 = sd.new_page("2/2")
    (gx0, gy0, gx1, gy1), tb2 = frame_and_title(sd, page2, 2, 2, ctx["utc"], ctx["sha"])
    view_title(page2, gx0 + 6, gy1 - 10, f"DAFTAR FIXTURE {floor} (nomor kunci di denah halaman 1)",
               f"{len(all_fx)} fixture dari world.json revisi {world['revision']['id']}")
    rooms = {r["id"]: r["id"].split("-", 1)[1] for r in world["rooms"]}
    frows = [[fixture_key(fx["id"]), fx["id"], world["catalog"][fx["type"]]["label"], rooms.get(fx["room"], fx["room"])]
             for fx in sorted(all_fx, key=lambda f: f["id"])]
    ncol = 4
    gap = 6.0
    cw = (gx1 - gx0 - 8 - gap * (ncol - 1)) / ncol
    fcols = [Col("No", 11, "r", "B"), Col("ID", 31, "l", "M"), Col("Jenis", cw - 11 - 31 - 30), Col("Ruang", 30)]
    top = gy1 - 16
    per = -(-len(frows) // ncol)
    for k in range(ncol):
        chunk = frows[k * per:(k + 1) * per]
        if not chunk:
            break
        _, yb = draw_table(page2, gx0 + 4 + k * (cw + gap), top, fcols, chunk, size=b, lead=1.08, pad=0.8,
                           row_xd=lambda row: ("fixture", row[1]))
        limit = tb2[3] + 2 if gx0 + 4 + (k + 1) * (cw + gap) > tb2[0] else gy0 + 2
        assert yb > limit, f"{sheet['id']} p2: fixture list column {k + 1} overflows ({yb:.1f})"
    return sd


# ------------------------------------------------------------------ A-301

def facade_data(world):
    """Four facades from the envelope: local x along the facade as seen from
    outside (left to right), with exterior doors and interior wall junctions."""
    env = world["floors"][0]["envelope"]
    X = max(p[0] for p in env)
    Y = max(p[1] for p in env)
    levels = {f["id"]: f["elevation"] for f in world["floors"]}
    ext_doors = [d for d in world["doors"] if "EXT" in d["rooms"]]
    sides = {
        "S": {"name": "TAMPAK SELATAN", "len": X, "u": lambda x, y: x, "on": lambda d: d["center"][1] == 0},
        "E": {"name": "TAMPAK TIMUR", "len": Y, "u": lambda x, y: y, "on": lambda d: d["center"][0] == X},
        "N": {"name": "TAMPAK UTARA", "len": X, "u": lambda x, y: X - x, "on": lambda d: d["center"][1] == Y},
        "W": {"name": "TAMPAK BARAT", "len": Y, "u": lambda x, y: Y - y, "on": lambda d: d["center"][0] == 0},
    }
    for key, s in sides.items():
        s["doors"] = []
        for d in ext_doors:
            if not s["on"](d):
                continue
            item = {"id": d["id"], "u": s["u"](*d["center"]), "w": d["width"], "z": levels[d["floor"]],
                    "floor": d["floor"], "type": d["type"], "hinge_u": []}
            sw = d.get("swing")
            if sw:
                _, at, lo, hi = window_span(d | {"at": d["center"][1] if d["wallAxis"] == "x" else d["center"][0]})
                jambs = {"low": [lo], "high": [hi], "both": [lo, hi]}[sw["hinge"]]
                for j in jambs:
                    pt = (j, at) if d["wallAxis"] == "x" else (at, j)
                    item["hinge_u"].append(s["u"](*pt))
            s["doors"].append(item)
        s["windows"] = []
        for w in sorted(world.get("windows", []), key=lambda w: w["id"]):
            if facade_of_window(world, w) == key:
                s["windows"].append({"id": w["id"], "u": s["u"](*w["center"]), "w": w["width"],
                                     "z": levels[w["floor"]], "floor": w["floor"], "sill": w["sill"],
                                     "head": w["head"], "glazing": w["glazing"]})
        junctions = set()
        for r in world["rooms"]:
            for (x0, y0), (x1, y1) in zip(r["polygon"], r["polygon"][1:] + r["polygon"][:1]):
                for (px, py) in ((x0, y0), (x1, y1)):
                    onside = {"S": py == 0, "N": py == Y, "E": px == X, "W": px == 0}[key]
                    if onside:
                        u = s["u"](px, py)
                        if 0 < u < s["len"]:
                            junctions.add((round(u, 3), r["floor"]))
        s["junctions"] = sorted(junctions)
        if key in ("S", "N"):
            s["grid"] = [(g["label"], s["u"](g["at"], 0 if key == "S" else Y)) for g in building_grid_cached(world)["x"]]
        else:
            s["grid"] = [(g["label"], s["u"](X if key == "E" else 0, g["at"])) for g in building_grid_cached(world)["y"]]
    return sides


_GRID = {}


def building_grid_cached(world):
    from krcad.planmodel import building_grid
    key = id(world)
    if key not in _GRID:
        _GRID[key] = building_grid(world)
    return _GRID[key]


def outside_strips(plan, pad=30.0):
    """Obstacles covering everything outside the envelope so labels stay inside."""
    x0, y0, x1, y1 = plan["extent"]
    return [(x0 - pad, y0 - pad, x0, y1 + pad), (x1, y0 - pad, x1 + pad, y1 + pad),
            (x0 - pad, y0 - pad, x1 + pad, y0), (x0 - pad, y1, x1 + pad, y1 + pad)]


def _level_marker(v, x, z, text, layer="A-ANNO-NOTE"):
    mpm = v.m_per_mm()
    s = 1.6 * mpm
    v.poly([(x, z), (x - s, z + s * 1.2), (x + s, z + s * 1.2)], layer, closed=True, stroke=GREEN, fill=GREEN)
    v.line((x - 3 * s, z), (x + 14 * mpm, z), layer, stroke=GREEN, width=0.3)
    v.text((x + 2.2 * s, z + 0.6 * mpm), text, layer, size=6.2, font="M", color=INK)


def build_elevations(sheet, ctx):
    world = ctx["world"]
    den = int(sheet["scale"].split(":")[1])
    sd = SheetDoc(sheet, world, make_meta(sheet, world, ctx, "L1, L2"))
    page = sd.new_page()
    (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, 1, 1, ctx["utc"], ctx["sha"])
    sides = facade_data(world)
    ff = world["building"]["floorToFloor"]
    slab = world["building"]["slab"]
    nfl = len(world["floors"])
    roof = nfl * ff
    top = roof + PARAPET
    mpm = den / 1000.0
    tag_pt = legible_pt(sheet["size"])
    sd.summary["window_tag_pt"] = tag_pt
    placements = {"S": (fx0 + 12, 212), "N": (fx0 + 196, 212), "E": (fx0 + 12, 124), "W": (fx0 + 196, 124)}
    offsets = {"S": (0, -40), "N": (0, -60), "E": (45, -40), "W": (45, -60)}
    door_count = 0
    win_count = {}
    worst_tag = 0.0
    for key in ("S", "E", "N", "W"):
        s = sides[key]
        ox, oy = placements[key]
        L = s["len"]
        clip = (ox - 8, oy - 20, ox + L * 1000 / den + 33, oy + top * 1000 / den + 12)
        v = page.view(f"facade-{key}", den, (ox, oy), clip, model_offset_m=offsets[key])
        v.line((-2.0, 0), (L + 2.0, 0), "A-ELEV-GRND", stroke=INK, width=1.4)
        v.rect(0, 0, L, top, "A-ELEV-OTLN", stroke=GREEN, fill="#f4f1ea", width=1.0, xd=("facade", key))
        for lv in range(1, nfl + 1):
            z = lv * ff
            v.line((0, z - slab), (L, z - slab), "A-ELEV-HIDN", stroke=GRID, width=0.3, dash=(3, 2))
            v.line((0, z), (L, z), "A-ELEV-OTLN", stroke=GREEN, width=0.5)
        for u, fl in s["junctions"]:
            z0 = next(f["elevation"] for f in world["floors"] if f["id"] == fl)
            v.line((u, z0 + 0.05), (u, z0 + ff - slab), "A-ELEV-HIDN", stroke="#c9d3cd", width=0.25, dash=(1.5, 1.5))
        placer = LabelPlacer(v)
        for d in s["doors"]:
            u0, u1 = d["u"] - d["w"] / 2, d["u"] + d["w"] / 2
            z0 = d["z"]
            v.rect(u0, z0, u1, z0 + DOOR_HEAD, "A-ELEV-DOOR", stroke=GREEN, fill="#ffffff", width=0.7,
                   xd=("door", d["id"]))
            if d["type"] == "double":
                v.line((d["u"], z0), (d["u"], z0 + DOOR_HEAD), "A-ELEV-DOOR", stroke=GREEN, width=0.3)
            # Hinge mark: dashed triangle with its apex on the hinge jamb (swing data, P03).
            for hu in d["hinge_u"]:
                leaf_w = d["w"] / len(d["hinge_u"])
                free = hu + leaf_w if abs(hu - u0) < 1e-6 else hu - leaf_w
                v.poly([(free, z0 + 0.05), (hu, z0 + DOOR_HEAD / 2), (free, z0 + DOOR_HEAD - 0.05)], "A-ELEV-DOOR",
                       stroke=GREEN, width=0.25, dash=(1.2, 0.9), xd=("door", d["id"], {"hinge_u": round(hu, 3)}))
            placer.boxes.append((u0, z0, u1, z0 + DOOR_HEAD))
            box, _ = placer.place((d["u"], z0 + DOOR_HEAD + 0.12), d["id"], 5.4, "M", gap=0.1, prefer=2)
            v.text(((box[0] + box[2]) / 2, box[1] + (box[3] - box[1]) * 0.22), d["id"], "A-ELEV-DOOR", size=5.4,
                   font="M", color=INK, align="c", knock=True, xd=("door", d["id"]))
            door_count += 1
        for w in s["windows"]:
            u0, u1 = w["u"] - w["w"] / 2, w["u"] + w["w"] / 2
            zs, zh = w["z"] + w["sill"], w["z"] + w["head"]
            xd = ("window", w["id"], {"facade": key, "floor": w["floor"], "glazing": w["glazing"]})
            obscured = w["glazing"] == "obscured"
            v.rect(u0, zs, u1, zh, "A-ELEV-GLAZ", stroke=GREEN, fill="#e6eeec" if not obscured else "#ece8e0",
                   width=0.6, xd=xd)
            for a, b in (_clip_diagonals(u0, zs, u1, zh, 0.16) if obscured else []):
                v.line(a, b, "A-ELEV-GLAZ", stroke=GREY_TEXT, width=0.2)
            v.line((u0 - 0.08, zs), (u1 + 0.08, zs), "A-ELEV-GLAZ", stroke=GREEN, width=0.9)
            placer.boxes.append((u0 - 0.08, zs - 0.05, u1 + 0.08, zh))
            win_count[key] = win_count.get(key, 0) + 1
        for w in s["windows"]:
            tag = window_tag_text(w["id"])
            tw, th = window_tag_size_m(v, tag, tag_pt)
            box, hit = placer.place_box((w["u"], w["z"] + w["head"] + 0.1), tw, th, gap=0.08, prefer=2)
            worst_tag = max(worst_tag, hit)
            window_tag(v, ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2), tag, tag_pt, "A-ELEV-GLAZ-IDEN",
                       xd=("window", w["id"], {"tag": tag}))
        bz, br = -0.3 - 6 * mpm, 2.6 * mpm
        for lbl, u in s["grid"]:
            v.line((u, -0.1), (u, bz + br), "A-GRID", stroke=GRID, width=0.3)
            v.circle((u, bz), br, "A-GRID-IDEN", stroke=DIM, fill="#ffffff", width=0.4)
            v.text((u, bz - 6.5 * 0.36 / PT_PER_MM * mpm), lbl, "A-GRID-IDEN", size=6.5, font="B", align="c")
        xm = L + 6 * mpm
        _level_marker(v, xm, 0, f"{fmt_elev(0)} L1")
        for lv in range(1, nfl):
            _level_marker(v, xm, lv * ff, f"{fmt_elev(lv * ff)} L{lv + 1}")
        _level_marker(v, xm, roof, f"{fmt_elev(roof)} atap*")
        _level_marker(v, xm, top, f"{fmt_elev(top)} parapet*")
        view_title(page, ox, oy + top * 1000 / den + 6, s["name"], f"1:{den}")
        page.text((ox, oy - 15.5), f"Panjang fasad {fmt_m(L)} m, as ke as dinding luar.", "A-ANNO-NOTE", size=6.2,
                  color=GREY_TEXT)
    sd.summary["exterior_doors_drawn"] = door_count
    sd.summary["windows_per_facade"] = {k: win_count.get(k, 0) for k in ("S", "E", "N", "W")}
    sd.summary["window_tag_overlap_m2_max"] = round(worst_tag, 4)
    x = fx0 + 4
    y = fy0 + 50
    y = heading(page, x, y, "CATATAN TAMPAK", tb[0] - x - 8, size=8)
    notes = [f"Tinggi antar lantai {fmt_m(ff)} m dan pelat {fmt_m(slab)} m dari world.json (AS-DIM-01, AS-DIM-03).",
             f"* Atap dan parapet {fmt_m(PARAPET)} m serta tinggi pintu {fmt_m(DOOR_HEAD)} m adalah asumsi lembar ini "
             "(konsep); tidak ada di world.json.",
             f"Jendela dari world.json windows ({sum(win_count.values())} buah): posisi, lebar, ambang dan kepala per "
             "lantai; kaca buram diarsir. Kusen dan material fasad belum didesain.",
             "Tag segi enam Wnn = jendela nomor nn (W16 = W-L1-016); pasangan tag dan ID lengkap di schedule "
             "A-103 halaman 2.",
             "Segitiga putus pada pintu = sisi engsel (puncak segitiga) dari doors[].swing.hinge.",
             "Garis putus tipis = posisi dinding dalam yang bertemu fasad; garis putus abu = pelat tersembunyi.",
             "Pintu exit L2 timur menuju tangga darurat konsep VL-ESC-E di luar envelope (AS-EXIT-01), tidak digambar."]
    for n_ in notes:
        y = paragraph(page, x, y, n_, tb[0] - x - 8, size=6.2, bullet=True)
    scale_bar(page, tb[0] - 70, fy0 + 3.5, den, (0, 2, 5, 10))
    return sd


# ------------------------------------------------------------------ A-401

def section_cut(world, floor_id, axis, at):
    """Walls, door openings and rooms crossed by a vertical cut plane.

    axis 'X': cut line y = at, local u = world x. axis 'Y': cut line x = at, u = world y."""
    from tools.kantor.geometry import derive_walls
    walls, openings = derive_walls(world, floor_id)
    want = "y" if axis == "X" else "x"
    cut_walls = [{"u": w["at"], "t": w["thickness"], "exterior": w["exterior"]} for w in walls
                 if w["axis"] == want and w["from"] < at < w["to"]]
    cut_doors = [{"u": o["at"], "door": o["door"], "type": o["type"]} for o in openings
                 if o["axis"] == want and o["from"] < at < o["to"]]
    cut_windows = []
    for w in world.get("windows", []):
        if w["floor"] != floor_id:
            continue
        w_axis, w_at, lo, hi = window_span(w)
        if w_axis == want and lo < at < hi:
            cut_windows.append({"u": w_at, "id": w["id"], "sill": w["sill"], "head": w["head"],
                                "glazing": w["glazing"]})
    us = sorted({c["u"] for c in cut_walls} | {d["u"] for d in cut_doors})
    rooms = []
    for a, b in zip(us, us[1:]):
        m = (a + b) / 2
        pt = (m, at) if axis == "X" else (at, m)
        rid = room_at(world, floor_id, pt)
        if rid:
            rooms.append({"u0": a, "u1": b, "room": rid})
    return {"walls": cut_walls, "doors": cut_doors, "windows": cut_windows, "rooms": rooms}


def flight_height(prof, flight, ly):
    """Tread top height of a flight at local run position ly (stair_profile frame)."""
    t = prof["tread"]
    if flight == "f1":
        if ly < prof["f1"][0][0]:
            return 0.0
        for yk, h in prof["f1"]:
            if yk <= ly < yk + t:
                return h
        return prof["landing"][2]
    for yk, h in prof["f2"]:
        if yk - t <= ly < yk:
            return h
    return prof["landing"][2] if ly >= prof["f2"][0][0] else prof["f2"][-1][1]


def build_sections(sheet, ctx):
    world = ctx["world"]
    den = int(sheet["scale"].split(":")[1])
    sd = SheetDoc(sheet, world, make_meta(sheet, world, ctx, "L1, L2"))
    page = sd.new_page()
    (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, 1, 1, ctx["utc"], ctx["sha"])
    tag_pt = legible_pt(sheet["size"])
    b = world["building"]
    ff, slab, ceil = b["floorToFloor"], b["slab"], b["ceilingHeight"]
    floors = sorted(world["floors"], key=lambda f: f["elevation"])
    roof = len(floors) * ff
    env = floors[0]["envelope"]
    X, Y = max(p[0] for p in env), max(p[1] for p in env)
    stair = next(f for f in world["fixtures"] if f["type"] == "stair_u" and f["floor"] == floors[0]["id"])
    sw, sl = stair["size"][:2]
    sx0, sx1 = stair["pos"][0] - sw / 2, stair["pos"][0] + sw / 2
    sy0, sy1 = stair["pos"][1] - sl / 2, stair["pos"][1] + sl / 2
    prof = stair_profile(world, stair, floors[0]["elevation"])
    cuts = [
        {"key": "A", "axis": "X", "at": 13.0, "len": X, "title": "POTONGAN A-A",
         "desc": "memanjang (sumbu X) di y = 13,0 m melalui inti tangga dan lift", "origin": (fx0 + 22, 186),
         "offset": (0, -100)},
        {"key": "B", "axis": "Y", "at": 14.8, "len": Y, "title": "POTONGAN B-B",
         "desc": "melintang (sumbu Y) di x = 14,8 m melalui flight 1 tangga dan entrance", "origin": (fx0 + 22, 80),
         "offset": (0, -120)},
    ]
    summary = {}
    for cut in cuts:
        ox, oy = cut["origin"]
        L = cut["len"]
        v = page.view(f"section-{cut['key']}", den, (ox, oy),
                      (ox - 22, oy - 16, ox + L * 1000 / den + 46, oy + (roof + PARAPET) * 1000 / den + 6),
                      model_offset_m=cut["offset"])
        poche = GREEN
        v.line((-1.8, 0), (L + 1.8, 0), "A-SECT-GRND", stroke=INK, width=1.2)
        v.rect(-1.5, -slab - 0.4, L + 1.5, -slab, "A-SECT-GRND", stroke=None, fill="#e8e2d6")
        stair_u = (sx0, sx1) if cut["axis"] == "X" else (sy0, sy1)
        stair_hit = sx0 < cut["at"] < sx1 if cut["axis"] == "Y" else sy0 < cut["at"] < sy1
        info = {"floors": {}}
        for i, f in enumerate(floors):
            e = f["elevation"]
            sc = section_cut(world, f["id"], cut["axis"], cut["at"])
            info["floors"][f["id"]] = {"walls": len(sc["walls"]), "doors": [d["door"] for d in sc["doors"]],
                                       "windows": [w["id"] for w in sc["windows"]],
                                       "rooms": [r["room"] for r in sc["rooms"]]}
            # Slab under this floor (the ground slab for the lowest floor).
            zb = e - slab
            if i > 0 and stair_hit:
                v.rect(0, zb, stair_u[0], e, "A-SECT-SLAB", stroke=None, fill=poche)
                v.rect(stair_u[1], zb, L, e, "A-SECT-SLAB", stroke=None, fill=poche)
                v.text(((stair_u[0] + stair_u[1]) / 2, e + 0.15), "void tangga", "A-SECT-IDEN", size=5,
                       color=TERRA, align="c")
            else:
                v.rect(0, zb, L, e, "A-SECT-SLAB", stroke=None, fill=poche if i > 0 else "#7f938a")
            top = e + ff - slab
            for w in sc["walls"]:
                t = w["t"]
                ztop = top + (slab + PARAPET if (w["exterior"] and i == len(floors) - 1) else 0)
                win = next((x for x in sc["windows"] if abs(x["u"] - w["u"]) < 1e-9), None)
                if win is None:
                    v.rect(w["u"] - t / 2, e, w["u"] + t / 2, ztop, "A-SECT-WALL", stroke=None, fill=poche)
                    continue
                # Cut through a window: wall below the sill and above the head,
                # glass as a double line between them.
                zs, zh = e + win["sill"], e + win["head"]
                xd = ("window", win["id"], {"glazing": win["glazing"]})
                v.rect(w["u"] - t / 2, e, w["u"] + t / 2, zs, "A-SECT-WALL", stroke=None, fill=poche)
                v.rect(w["u"] - t / 2, zh, w["u"] + t / 2, ztop, "A-SECT-WALL", stroke=None, fill=poche)
                v.rect(w["u"] - t / 2, zs, w["u"] + t / 2, zh, "A-SECT-GLAZ", stroke=GREEN, width=0.3, xd=xd)
                for du in (-0.025, 0.025):
                    v.line((w["u"] + du, zs), (w["u"] + du, zh), "A-SECT-GLAZ", stroke=GREEN, width=0.35, xd=xd)
                out = 1 if w["u"] >= L / 2 else -1
                tag = window_tag_text(win["id"])
                _, th = window_tag_size_m(v, tag, tag_pt)
                window_tag(v, (w["u"] + out * (t / 2 + 0.12 + th / 2), (zs + zh) / 2), tag, tag_pt, "A-SECT-IDEN",
                           xd=("window", win["id"], {"tag": tag}), rot=90)
            for d in sc["doors"]:
                t = b["wall"]["exterior"] if d["u"] in (0, L) else b["wall"]["interior"]
                ztop = top + (slab + PARAPET if (d["u"] in (0, L) and i == len(floors) - 1) else 0)
                v.rect(d["u"] - t / 2, e + DOOR_HEAD, d["u"] + t / 2, ztop, "A-SECT-WALL", stroke=None, fill=poche)
                v.text((d["u"], e + DOOR_HEAD / 2), d["door"], "A-SECT-IDEN", size=5, font="M", color=INK,
                       align="c", rot=90, knock=True, xd=("door", d["door"]))
            for r in sc["rooms"]:
                v.line((r["u0"], e + ceil), (r["u1"], e + ceil), "A-SECT-CLNG", stroke=GRID, width=0.35,
                       dash=(3, 1.5))
                mid = (r["u0"] + r["u1"]) / 2
                if r["u1"] - r["u0"] > 1.6:
                    v.text((mid, e + 1.55), r["room"], "A-SECT-IDEN", size=6.4, font="B", color=GREEN, align="c",
                           knock=True, xd=("room", r["room"]))
                else:
                    v.text((mid, e + 1.0), r["room"], "A-SECT-IDEN", size=4.6, font="B", color=GREEN, align="c",
                           rot=90, knock=True, xd=("room", r["room"]))
        # Roof slab.
        v.rect(0, roof - slab, L, roof, "A-SECT-SLAB", stroke=None, fill=poche)
        # Stair from the stair_u fixture and AS-DIM-05.
        if cut["axis"] == "Y" and stair_hit:
            yc = stair["pos"][1]
            pts = [(yc - prof["half_len"], floors[0]["elevation"])]
            for (yk, hk) in prof["f1"]:
                pts.append((yc + yk, hk - prof["rise"]))
                pts.append((yc + yk, hk))
                pts.append((yc + yk + prof["tread"], hk))
            land = prof["landing"]
            pts.append((yc + land[1], land[2]))
            pts.append((yc + land[1], land[2] - 0.2))
            pts.append((yc + land[0] - 0.05, land[2] - 0.2))
            pts.append((yc - prof["half_len"] + 0.25, floors[0]["elevation"]))
            v.poly(pts, "A-SECT-STRS", closed=True, stroke=TERRA, fill="#e9c9bb", width=0.5,
                   xd=("vertical", stair["id"], {"link": stair.get("verticalLink", "")}))
            # Flight 2 is beyond the cut plane: visible outline only.
            bp = [(yc + land[0], land[2])]
            for (yk, hk) in prof["f2"]:
                bp.append((yc + yk, hk))
                bp.append((yc + yk - prof["tread"], hk))
            v.poly(bp, "A-SECT-STRS", stroke=TERRA, width=0.35)
            v.text((yc, land[2] + 0.55), f"tangga U: {2 * STAIR_RISERS_PER_FLIGHT} riser x "
                   f"{prof['rise']:.4f}".replace(".", ",") + " m, tread 0,28 m (AS-DIM-05)", "A-SECT-IDEN", size=5,
                   color=TERRA, align="c", knock=True)
            info["stair"] = {"risers": 2 * STAIR_RISERS_PER_FLIGHT, "rise": prof["rise"], "landing_z": land[2]}
        elif cut["axis"] == "X" and stair_hit:
            ly = cut["at"] - stair["pos"][1]
            inner = prof["gap"] / 2
            for xa, xb, flight in ((sx0, stair["pos"][0] - inner, "f1"), (stair["pos"][0] + inner, sx1, "f2")):
                hk = flight_height(prof, flight, ly)
                v.rect(xa, hk - 0.25, xb, hk, "A-SECT-STRS", stroke=TERRA, fill="#e9c9bb", width=0.5,
                       xd=("vertical", stair["id"]))
                v.text(((xa + xb) / 2, hk + 0.2), f"{flight.upper()} +{hk:.2f}".replace(".", ","), "A-SECT-IDEN",
                       size=4.6, color=TERRA, align="c", knock=True)
            info["stair"] = {"risers": 2 * STAIR_RISERS_PER_FLIGHT, "rise": prof["rise"]}
        # Level markers.
        xm = L + 2.4
        for f in floors:
            _level_marker(v, xm, f["elevation"], f"{fmt_elev(f['elevation'])} {f['id']}")
            _level_marker(v, xm, f["elevation"] + ceil, f"{fmt_elev(f['elevation'] + ceil)} plafon")
        _level_marker(v, xm, roof, f"{fmt_elev(roof)} atap*")
        # Height dimension on the left.
        xs = -1.2
        zs = [0.0] + [f["elevation"] for f in floors[1:]] + [roof, roof + PARAPET]
        v.line((xs, zs[0]), (xs, zs[-1]), "A-ANNO-DIMS", stroke=DIM, width=0.3)
        for z in zs:
            v.line((xs - 0.12, z - 0.12), (xs + 0.12, z + 0.12), "A-ANNO-DIMS", stroke=DIM, width=0.8)
        for za, zb2 in zip(zs, zs[1:]):
            v.text((xs - 0.25, (za + zb2) / 2), f"{round((zb2 - za) * 1000)}", "A-ANNO-DIMS", size=5.6, font="M",
                   color=DIM, align="c", rot=90)
        view_title(page, ox, oy + (roof + PARAPET) * 1000 / den + 1.5, cut["title"], f"1:{den} · {cut['desc']}",
                   size=9.5)
        info["axis"], info["at"] = cut["axis"], cut["at"]
        summary[cut["key"]] = info
    sd.summary["cuts"] = summary
    # Key plan 1:500 with cut lines.
    kden = 500
    kx, ky = fx1 - 72, 92
    kv = page.view("keyplan", kden, (kx, ky), (kx - 8, ky - 8, kx + X * 2 + 10, ky + Y * 2 + 10),
                   model_offset_m=(60, -120))
    for r in world["rooms"]:
        if r["floor"] == floors[0]["id"]:
            kv.poly(r["polygon"], "A-AREA", closed=True, stroke=GREY_TEXT, width=0.3)
    kv.rect(sx0, sy0, sx1, sy1, "A-STRS", stroke=TERRA, width=0.5)
    for cut in cuts:
        if cut["axis"] == "X":
            a, bb = (-1.5, cut["at"]), (X + 1.5, cut["at"])
        else:
            a, bb = (cut["at"], -1.5), (cut["at"], Y + 1.5)
        kv.line(a, bb, "A-SECT-MARK", stroke=TERRA, width=0.8, dash=(4, 1.5))
        for p in (a, bb):
            kv.text(p, cut["key"], "A-SECT-MARK", size=7, font="B", color=TERRA, align="c", knock=True)
    page.text((kx - 6, ky + Y * 2 + 14), "KUNCI POTONGAN L1 (1:500)", "A-ANNO-NOTE", size=7, font="B", color=GREEN)
    x = fx0 + 4
    y = fy0 + 46
    notes = [f"Diturunkan dari world.json: tinggi antar lantai {fmt_m(ff)} m, plafon {fmt_m(ceil)} m, pelat "
             f"{fmt_m(slab)} m (AS-DIM-03); dinding dan bukaan dari derive_walls; tangga dari fixture stair_u (AS-DIM-05).",
             f"Tinggi kepala pintu {fmt_m(DOOR_HEAD)} m, parapet {fmt_m(PARAPET)} m dan * atap konsep adalah asumsi "
             "lembar, bukan data world.json. Belum ada desain struktur atau fondasi.",
             "Hijau penuh = elemen terpotong (dinding, pelat). Garis putus = plafon. Terakota = tangga.",
             "Jendela yang terpotong garis potong digambar dengan ambang dan kepala dari world.json windows: "
             + (", ".join(f"{w} (tag {window_tag_text(w)})" for w in sorted(
                 {w for c in summary.values() for fl in c["floors"].values() for w in fl["windows"]})) or "tidak ada")
             + "."]
    for n_ in notes:
        y = paragraph(page, x, y, n_, tb[0] - x - 8, size=6.2, bullet=True)
    return sd


# ------------------------------------------------------------------ A-001

STATUS_TEXT = {"produced (konsep)": "DXF + PDF dihasilkan generator dari world.json dan dibuka ulang oleh test.",
               "target": "Belum diproduksi."}


def build_cover(sheet, ctx):
    world = ctx["world"]
    sd = SheetDoc(sheet, world, make_meta(sheet, world, ctx))
    page = sd.new_page()
    (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, 1, 1, ctx["utc"], ctx["sha"])
    x = fx0 + 6
    page.text((x, fy1 - 22), "kantor-rpg", "A-ANNO-NOTE", size=34, font="B", color=GREEN)
    page.text((x, fy1 - 31), f"Paket gambar konsep · revisi {world['revision']['id']} ({world['revision']['date']})",
              "A-ANNO-NOTE", size=12, font="M", color=INK)
    page.text((x, fy1 - 37.5), world["status"], "A-ANNO-NOTE", size=8, color=GREY_TEXT)
    pages = ctx["page_counts"]
    rows = []
    total_pages = 0
    for s in ctx["sheets_doc"]["sheets"]:
        n = pages.get(s["id"], 1 if s["id"] == sheet["id"] else None)
        rows.append([s["id"], s["title"], s["discipline"], s["size"], s["scale"], world["revision"]["id"],
                     str(n) if n else "-", "produced (konsep)" if n else "target"])
        total_pages = total_pages + (n or 0)
    sd.summary["index_rows"] = len(rows)
    cols = [Col("ID", 20, "l", "B"), Col("Judul", 70), Col("Disiplin", 15, "c"), Col("Ukuran", 15, "c"),
            Col("Skala", 15, "c"), Col("Rev", 11, "c"), Col("Hlm", 11, "r"), Col("Status", 31)]
    y = heading(page, x, fy1 - 44, "INDEKS LEMBAR (dari design/sheets.json)", sum(c.width for c in cols))
    _, y = draw_table(page, x, y, cols, rows, size=7.6, lead=1.3, row_xd=lambda row: ("sheet", row[0]))
    y = paragraph(page, x, y - 2, f"Total {len(rows)} lembar, {total_pages} halaman PDF (berkas gabungan "
                  "drawings/pdf/kantor-rpg-sheets-all.pdf, label halaman = ID lembar).", sum(c.width for c in cols),
                  size=6.6)
    y = heading(page, x, y - 2, "LEGENDA STATUS", sum(c.width for c in cols))
    for k, t in list(STATUS_TEXT.items()) + [("DWG native", "BLOCKED: AutoCAD berlisensi tidak tersedia di container "
                                               "cloud. DXF bukan DWG; lihat cad/AUTOCAD-RUNBOOK.md.")]:
        page.text((x, y - 3.0), k, "A-ANNO-NOTE", size=7.4, font="B", color=GREEN)
        y = paragraph(page, x + 30, y, t, sum(c.width for c in cols) - 30, size=7.4)
    y = heading(page, x, y - 2, "CATATAN UMUM", sum(c.width for c in cols))
    for n_ in ["Satuan: dimensi gambar dalam mm (DXF model space 1:1 mm, $INSUNITS = 4), luas dalam m², elevasi "
               "dalam m. Origin (0,0) sudut barat daya L1; X timur, Y utara.",
               "Semua lembar adalah KONSEP untuk review, bukan gambar konstruksi bertanda tangan. Ukuran adalah "
               "proposal (AS-DIM-01), bukan lahan, struktur, atau okupansi yang disahkan (AS-SITE-01).",
               "ICT adalah rancangan virtual, bukan topologi atau perangkat produksi (AS-NET-01)."]:
        y = paragraph(page, x, y, n_, sum(c.width for c in cols), size=7.4, bullet=True)
    # Right column: assumptions from world.json.
    rx = x + sum(c.width for c in cols) + 8
    rw = fx1 - 4 - rx
    ya = heading(page, rx, fy1 - 44, f"DAFTAR ASUMSI ({len(world['assumptions'])}, dari world.json)", rw)
    for a in world["assumptions"]:
        page.text((rx, ya - 2.9), a["id"], "A-ANNO-NOTE", size=6.8, font="B", color=GREEN)
        ya = paragraph(page, rx + 18, ya, a["text"], rw - 18, size=6.8, lead=1.2)
    assert ya > tb[3] + 2, f"A-001 assumptions overflow ({ya:.1f})"
    assert y > fy0 + 2, f"A-001 index overflow ({y:.1f})"
    sd.summary["assumptions"] = len(world["assumptions"])
    return sd
