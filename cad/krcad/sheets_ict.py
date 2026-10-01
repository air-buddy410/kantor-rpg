"""ICT sheets: ICT-001 topology, ICT-101/102 outlet plans, ICT-201 rack
elevations, ICT-301 pathways and riser, ICT-401 port and device schedule.

Everything is the virtual concept from world.json ict and
design/derived/ict-portmap.json; nothing here is a production network."""
from __future__ import annotations

import math

from tools.kantor.geometry import fixture_corners

from krcad.common import *  # noqa: F401,F403
from krcad.draw import (Col, LabelPlacer, SheetDoc, draw_table, frame_and_title, heading, north_arrow, paragraph,
                        scale_bar, table_rows_height, text_w_mm, wrap)
from krcad.plan_prims import plan_base, plan_paper_layout, room_id_labels
from krcad.planmodel import build_plan
from krcad.sheets_a import assumptions_block, make_meta, outside_strips, view_title

ICT = "#1f4d3a"
TRAY = "#8a5a2b"
ROUTE = {"L1": "#2e6b52", "L2": "#9a6a2f"}
VIRTUAL = "RANCANGAN VIRTUAL, BUKAN TOPOLOGI PRODUKSI"
U_M = 0.04445


def portmap_check(world, portmap):
    rows_total = round(sum(c["length_m"] for c in portmap["cables"]), 1)
    return {"cables": len(portmap["cables"]), "sum_length_m": rows_total,
            "declared_total_m": portmap["totals"]["cable_m"],
            "total_ok": abs(rows_total - portmap["totals"]["cable_m"]) < 0.05,
            "revision_ok": portmap.get("worldRevision") == world["revision"]["id"]}


# ------------------------------------------------------------------ ICT-001

def build_topology(sheet, ctx):
    world, pm = ctx["world"], ctx["portmap"]
    ict = world["ict"]
    sd = SheetDoc(sheet, world, make_meta(sheet, world, ctx))
    page = sd.new_page()
    (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, 1, 1, ctx["utc"], ctx["sha"])
    lay = "ICT-TOPO"
    page.text((fx0 + 6, fy1 - 10), "TOPOLOGI JARINGAN (VIRTUAL)", lay, size=13, font="B", color=GREEN)
    page.rect(fx0 + 6, fy1 - 19, fx0 + 6 + text_w_mm(VIRTUAL, 9, "B") + 6, fy1 - 13.5, lay, stroke=None, fill=TERRA)
    page.text((fx0 + 9, fy1 - 17.6), VIRTUAL, lay, size=9, font="B", color="#ffffff")
    racks = {d["device"]: (r["id"], d) for r in ict["racks"] for d in r["contents"]}

    def box(x, y, w, h, title, lines, fill="#eef4f0", stroke=GREEN, ident=None):
        page.rect(x, y, x + w, y + h, lay, stroke=stroke, fill=fill, width=0.8, xd=("device", ident or title))
        page.text((x + 2, y + h - 4.4), title, lay, size=8, font="B", color=GREEN, xd=("device", ident or title))
        yy = y + h - 8.4
        for ln in lines:
            page.text((x + 2, yy), ln, lay, size=6.4, color=INK)
            yy -= 3.2
        return (x, y, x + w, y + h)

    def link(a, b, label=None, dash=None, color=GREEN, width=0.7):
        page.line(a, b, lay, stroke=color, width=width, dash=dash)
        if label:
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            page.text((mx + 1, my), label, lay, size=5.4, font="M", color=GREY_TEXT, knock=True)

    cx = fx0 + 120
    gw = racks.get("GW-DEMO-01")
    b_gw = box(cx - 30, 236, 60, 16, "GW-DEMO-01", [f"gateway virtual · {gw[0]} U{gw[1]['u']}",
                                                   "tanpa ISP/IP nyata (AS-NET-01)"])
    agg = racks.get("SW-AGG-01")
    b_agg = box(cx - 30, 206, 60, 16, "SW-AGG-01", [f"switch agregasi · {agg[0]} U{agg[1]['u']}",
                                                  f"{ict['rackDeviceTypes']['switch_aggregation']['ports']} port, "
                                                  f"{ict['rackDeviceTypes']['switch_aggregation']['uplinks']} uplink"])
    link(((b_gw[0] + b_gw[2]) / 2, b_gw[1]), ((b_agg[0] + b_agg[2]) / 2, b_agg[3]), "uplink konsep", dash=(3, 2))
    sws = pm["switches"]
    sw_boxes = {}
    per_sw = {}
    for c in pm["cables"]:
        d = per_sw.setdefault(c["switch"], {"types": {}, "pps": {}, "floors": {}, "domains": {}})
        d["types"][c["endpoint"]] = d["types"].get(c["endpoint"], 0) + 1
        d["pps"][c["patchPanel"]] = d["pps"].get(c["patchPanel"], 0) + 1
        d["floors"][c["floor"]] = d["floors"].get(c["floor"], 0) + 1
        d["domains"][c["domain"]] = d["domains"].get(c["domain"], 0) + 1
    n = len(sws)
    span = 220
    for i, s in enumerate(sws):
        x = fx0 + 10 + i * (span / max(n, 1)) + 2
        rk = racks.get(s["switch"])
        poe = f"PoE worst-case {s['poeWorstCaseW']:g} W" if s["poeWorstCaseW"] else "PoE 0 W"
        sw_boxes[s["switch"]] = box(x, 166, 70, 24, s["switch"],
                                    [f"akses 48 PoE · {rk[0]} U{rk[1]['u']}" if rk else "akses 48 PoE",
                                     f"terpakai {s['used']}/{s['ports']}, cadangan uplink {s['uplinksReserved']}",
                                     f"{poe}; budget belum divalidasi"], ident=s["switch"])
        b = sw_boxes[s["switch"]]
        link(((b_agg[0] + b_agg[2]) / 2, b_agg[1]), ((b[0] + b[2]) / 2, b[3]), None, dash=(3, 2))
    page.text((cx + 32, 198), "uplink konsep: hierarki dari tipe perangkat, port uplink belum dipetakan", lay,
              size=5.4, color=GREY_TEXT)
    pps = sorted({c["patchPanel"] for c in pm["cables"]} | {d["device"] for r in ict["racks"] for d in r["contents"]
                                                             if d["type"] == "patch_panel_24"})
    pp_boxes = {}
    for i, p in enumerate(pps):
        used = sum(1 for c in pm["cables"] if c["patchPanel"] == p)
        rk = racks.get(p)
        x = fx0 + 10 + i * (span / len(pps)) + 2
        pp_boxes[p] = box(x, 128, 52, 17, p, [f"patch panel 24 · {rk[0]} U{rk[1]['u']}" if rk else "patch panel",
                                              f"port terpakai {used}/24"], fill="#f6f2ea", ident=p)
    for sname, d in per_sw.items():
        sb = sw_boxes[sname]
        for p, k in d["pps"].items():
            pb = pp_boxes[p]
            link(((sb[0] + sb[2]) / 2, sb[1]), ((pb[0] + pb[2]) / 2, pb[3]), f"{k} kabel patch", width=0.5)
    # Endpoint groups per switch.
    for i, s in enumerate(sws):
        d = per_sw.get(s["switch"], {"types": {}, "floors": {}, "domains": {}})
        x = sw_boxes[s["switch"]][0]
        lines = [f"{t}: {k}" for t, k in sorted(d["types"].items())]
        lines.append("lantai " + ", ".join(f"{f} {k}" for f, k in sorted(d["floors"].items())))
        hgt = 9 + 3.2 * len(lines)
        box(x, 104 - hgt, 70, hgt, f"Endpoint {s['switch']}", lines, fill="#ffffff", stroke=GREY_TEXT,
            ident=f"EP-{s['switch']}")
    for p, pb in pp_boxes.items():
        page.line(((pb[0] + pb[2]) / 2, pb[1]), ((pb[0] + pb[2]) / 2, 108), lay, stroke=GREY_TEXT, width=0.4,
                  dash=(2, 1.5))
    page.text((fx0 + 12, 120), "kabel horizontal ke outlet (detail per port di ICT-401)", lay, size=6.2,
              color=GREY_TEXT)
    # Right column: domains, counts, racks.
    rx = fx0 + 246
    rw = fx1 - rx - 4
    y = heading(page, rx, fy1 - 24, "DOMAIN (ID abstrak, AS-NET-01)", rw, size=8)
    drows = []
    for dm in ict["domains"]:
        k = sum(1 for c in pm["cables"] if c["domain"] == dm["id"])
        drows.append([dm["id"], dm["label"], str(k), dm["note"]])
    _, y = draw_table(page, rx, y, [Col("Domain", 30, "l", "B"), Col("Label", 18), Col("Port", 12, "r"),
                                    Col("Catatan", rw - 60)], drows, size=6.2)
    devs = ict["devices"]
    aps = [d for d in devs if d["type"] == "ap"]
    cams = [d for d in devs if d["type"] == "camera"]
    y = heading(page, rx, y - 4, "JUMLAH DARI DATA", rw, size=8)
    facts = [("Outlet", f"{pm['totals']['outlets']} outlet, {pm['totals']['ports']} port"),
             ("Patch panel", f"{len(pps)} x 24 = {pm['totals']['patchPanelPorts']} port, terpakai "
                             f"{pm['totals']['patchPanelPortsUsed']}"),
             ("Access point", f"{len(aps)} placeholder (AS-ICT-01): " + ", ".join(
                 f"{f} {sum(1 for a in aps if a['floor'] == f)}" for f in ("L1", "L2"))),
             ("Kamera", f"{len(cams)} opsional konsep: " + ", ".join(
                 f"{f} {sum(1 for a in cams if a['floor'] == f)}" for f in ("L1", "L2"))),
             ("Kabel", f"{len(pm['cables'])} kabel, total {pm['totals']['cable_m']:g} m (AS-ICT-02)".replace(".", ",")),
             ("PoE", f"worst-case {pm['poeTotalWorstCaseW']:g} W dari kelas IEEE (AS-ICT-04); belum divalidasi")]
    for k, t in facts:
        page.text((rx, y - 2.6), k, lay, size=6.4, font="B", color=GREEN)
        y = paragraph(page, rx + 22, y, t, rw - 22, size=6.4)
    y = heading(page, rx, y - 3, "RACK", rw, size=8)
    for r in ict["racks"]:
        t = ", ".join(f"{d['device']} U{d['u']}" for d in sorted(r["contents"], key=lambda d: -d["u"]))
        page.text((rx, y - 2.6), r["id"], lay, size=6.4, font="B", color=GREEN, xd=("rack", r["id"]))
        y = paragraph(page, rx + 22, y, f"{r['room']}, {r['units']}U: {t}", rw - 22, size=6.0)
    y = paragraph(page, rx, y - 2, "SRV-DEMO-01 dan NAS-DEMO-01 belum punya port map; koneksinya tidak digambar.",
                  rw, size=6.0, color=GREY_TEXT)
    assert y > tb[3] + 2, f"ICT-001 right column overflow {y:.1f}"
    sd.summary = {"switches": len(sws), "patch_panels": len(pps), "aps": len(aps), "cameras": len(cams),
                  "domains": len(ict["domains"])}
    return sd


# ------------------------------------------------------------------ ICT-101 / ICT-102

def _outlet_symbol(v, pos, size_m, xd):
    x, y = pos
    s = size_m
    v.poly([(x - s, y - s * 0.8), (x + s, y - s * 0.8), (x, y + s * 0.9)], "ICT-OUTL", closed=True, stroke=ICT,
           fill="#ffffff", width=0.6, xd=xd)


def build_ict_plan(sheet, ctx):
    world, pm = ctx["world"], ctx["portmap"]
    ict = world["ict"]
    floor = sheet["floor"]
    den = int(sheet["scale"].split(":")[1])
    plan = build_plan(world, floor, den, with_tags=False)
    sd = SheetDoc(sheet, world, make_meta(sheet, world, ctx, floor))
    page = sd.new_page()
    lay = plan_paper_layout(sheet, plan, den)
    (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, 1, 1, ctx["utc"], ctx["sha"],
                                               tb_origin=(lay["panel"][0], lay["frame"][1]), tb_w=150)
    page.line((lay["panel"][0], fy0), (lay["panel"][0], fy1), "A-ANNO-TTLB", stroke=GREEN, width=0.8)
    z = lay["zone"]
    v = page.view("ict", den, lay["origin"], (z[0] + 1, z[1] + 1, z[2] - 1, z[3] - 1))
    plan_base(v, plan, mode="light", fixtures="faint")
    rooms_cat = {r["id"]: r["category"] for r in world["rooms"]}
    # Trays and riser.
    pw_ = ict["pathways"]
    for t in pw_["trays"]:
        if t["floor"] != floor:
            continue
        v.line(t["from"], t["to"], "ICT-TRAY", stroke=TRAY, width=2.2, alpha=0.5, xd=("tray", t["id"]))
        v.line(t["from"], t["to"], "ICT-TRAY", stroke=TRAY, width=0.4, dash=(4, 2))
        mx, my = (t["from"][0] + t["to"][0]) / 2, (t["from"][1] + t["to"][1]) / 2
        horiz = abs(t["from"][1] - t["to"][1]) < 1e-6
        lab = (mx - 3.0, my + 0.35) if horiz else (mx + 0.35, my + 1.5)
        v.text(lab, f"{t['id']} +{pw_['trayHeight']:.1f} m".replace(".", ","), "ICT-TRAY", size=5.2, font="M",
               color=TRAY, rot=0 if horiz else 90, knock=True, xd=("tray", t["id"]))
        for node, jp in t.get("joins", []):
            v.line(next(n["pos"] for n in pw_["nodes"] if n["id"] == node), jp, "ICT-TRAY", stroke=TRAY, width=1.2)
    for n in pw_["nodes"]:
        if n["floor"] == floor and "RISER" in n["id"] and not n["id"].endswith("-S"):
            x, y = n["pos"]
            v.rect(x - 0.3, y - 0.3, x + 0.3, y + 0.3, "ICT-RISR", stroke=TRAY, fill="#f3e6d6", width=0.8,
                   xd=("node", n["id"]))
            v.text((x, y + 0.45), "RISER", "ICT-RISR", size=5.2, font="B", color=TRAY, align="c", knock=True)
    for e in pw_["edges"]:
        a = next(n for n in pw_["nodes"] if n["id"] == e[0])
        b = next(n for n in pw_["nodes"] if n["id"] == e[1])
        if a["floor"] == b["floor"] == floor:
            v.line(a["pos"], b["pos"], "ICT-TRAY", stroke=TRAY, width=1.2)
    for r in ict["racks"]:
        if r["floor"] != floor:
            continue
        fx = next(f for f in world["fixtures"] if f["id"] == r["fixture"])
        v.poly(fixture_corners(fx), "ICT-RACK", closed=True, stroke=ICT, fill="#cfe0d6", width=0.7,
               xd=("rack", r["id"]))
    wall_rects = [w["rect"] for w in plan["walls"]]
    placer = LabelPlacer(v, obstacles=list(wall_rects) + outside_strips(plan))
    # Rack labels as one block beside the pair of racks.
    rk = [r for r in ict["racks"] if r["floor"] == floor]
    if rk:
        fxs = [next(f for f in world["fixtures"] if f["id"] == r["fixture"]) for r in rk]
        ax = max(f["pos"][0] for f in fxs) + 0.5
        ay = max(f["pos"][1] for f in fxs) + 0.3
        for i, r in enumerate(rk):
            v.text((ax, ay - i * 0.42), r["id"], "ICT-RACK", size=5.4, font="B", color=ICT, knock=True,
                   xd=("rack", r["id"]))
        placer.boxes.append((ax, ay - 0.6, ax + 2.4, ay + 0.3))
    outlets = [o for o in ict["outlets"] if o["floor"] == floor]
    devs = [d for d in ict["devices"] if d["floor"] == floor]
    for o in outlets:
        x, y = o["pos"]
        placer.boxes.append((x - 0.2, y - 0.2, x + 0.2, y + 0.2))
    for d in devs:
        x, y = d["pos"]
        placer.boxes.append((x - 0.32, y - 0.32, x + 0.32, y + 0.32))
    for o in outlets:
        _outlet_symbol(v, o["pos"], 0.17, ("outlet", o["id"], {"ports": o["ports"], "domain": o["domain"]}))
        label = f"{o['id']} ({o['ports']})"
        box, _ = placer.place(o["pos"], label, 4.6, "M", gap=0.22)
        v.text((box[0] + 0.04, box[1] + (box[3] - box[1]) * 0.2), label, "ICT-OUTL-IDEN", size=4.6, font="M",
               color=INK, knock=True, xd=("outlet", o["id"]))
    wet_cams = []
    for d in devs:
        x, y = d["pos"]
        if d["type"] == "ap":
            v.circle((x, y), 0.3, "ICT-AP", stroke=ICT, fill="#ffffff", width=0.8, xd=("device", d["id"]))
            v.text((x, y - 0.09), "AP", "ICT-AP", size=4.6, font="B", color=ICT, align="c")
            label = f"{d['id']} placeholder"
        else:
            if rooms_cat.get(d["room"]) == "wet":
                wet_cams.append(d["id"])
            a = math.radians(d.get("aimDeg", 0))
            v.rect(x - 0.18, y - 0.18, x + 0.18, y + 0.18, "ICT-CAM", stroke=TERRA, fill="#ffffff", width=0.8,
                   xd=("device", d["id"]))
            tip = (x + 0.9 * math.cos(a), y + 0.9 * math.sin(a))
            v.line((x, y), tip, "ICT-CAM", stroke=TERRA, width=0.6)
            v.poly([tip, (tip[0] - 0.22 * math.cos(a - 0.45), tip[1] - 0.22 * math.sin(a - 0.45)),
                    (tip[0] - 0.22 * math.cos(a + 0.45), tip[1] - 0.22 * math.sin(a + 0.45))], "ICT-CAM",
                   closed=True, stroke=None, fill=TERRA)
            placer.boxes.append((min(x, tip[0]) - 0.1, min(y, tip[1]) - 0.1, max(x, tip[0]) + 0.1,
                                 max(y, tip[1]) + 0.1))
            label = f"{d['id']} (arah konsep)"
        box, _ = placer.place((x, y), label, 4.8, "B", gap=0.38)
        v.text((box[0] + 0.04, box[1] + (box[3] - box[1]) * 0.2), label, "ICT-DEV-IDEN", size=4.8, font="B",
               color=ICT if d["type"] == "ap" else TERRA, knock=True, xd=("device", d["id"]))
    if wet_cams:
        raise ValueError(f"camera in wet room on {floor}: {wet_cams}")
    room_id_labels(v, plan, wall_rects, size=5.4, obstacles=placer.boxes, color=GREY_TEXT)
    view_title(page, fx0 + 6, fy0 + 17, sheet["title"].upper(), f"Skala {sheet['scale']} @ {sheet['size']}")
    page.text((fx0 + 6, fy0 + 9), "Label outlet: ID (jumlah port). Tray di +3,2 m (AS-ICT-02). "
              "AP placeholder tanpa klaim radius Wi-Fi (AS-ICT-01).", "A-ANNO-NOTE", size=7)
    scale_bar(page, fx0 + 200, fy0 + 12, den, (0, 1, 2, 5, 10))
    # Panel.
    px0 = lay["panel"][0] + 5
    pw = lay["panel"][2] - 5 - px0
    y = fy1 - 4
    north_arrow(page, px0 + 8, y - 11, r=6)
    page.text((px0 + 20, y - 8), VIRTUAL.capitalize(), "A-ANNO-NOTE", size=7.4, font="B", color=TERRA)
    page.text((px0 + 20, y - 12.5), f"Lantai {floor}: {floor_of(world, floor)['name']}", "A-ANNO-NOTE", size=7)
    page.text((px0 + 20, y - 16.5), "Sumber: world.json ict + design/derived/ict-portmap.json", "A-ANNO-NOTE", size=6.5)
    y -= 24
    y = heading(page, px0, y, "LEGENDA", pw)
    leg = [("outlet", "Outlet data (segitiga), label ID (port)"), ("ap", "Access point placeholder (AS-ICT-01)"),
           ("cam", "Kamera opsional + arah konsep (bukan FOV terukur)"), ("tray", "Tray kabel +3,2 m"),
           ("riser", "Riser vertikal ke lantai lain"), ("rack", "Rack 42U (target)")]
    for i, (k, t) in enumerate(leg):
        cx_ = px0 + (i % 2) * pw / 2
        cy_ = y - (i // 2) * 7 - 4
        if k == "outlet":
            page.poly([(cx_ + 1, cy_ - 1.2), (cx_ + 5, cy_ - 1.2), (cx_ + 3, cy_ + 2)], "ICT-OUTL", closed=True,
                      stroke=ICT, fill="#ffffff", width=0.6)
        elif k == "ap":
            page.circle((cx_ + 3, cy_), 2.2, "ICT-AP", stroke=ICT, width=0.7)
        elif k == "cam":
            page.rect(cx_ + 1.5, cy_ - 1.2, cx_ + 3.9, cy_ + 1.2, "ICT-CAM", stroke=TERRA, width=0.7)
            page.line((cx_ + 3.9, cy_), (cx_ + 7, cy_), "ICT-CAM", stroke=TERRA, width=0.6)
        elif k == "tray":
            page.line((cx_, cy_), (cx_ + 7, cy_), "ICT-TRAY", stroke=TRAY, width=2.0)
        elif k == "riser":
            page.rect(cx_ + 1.5, cy_ - 1.6, cx_ + 4.7, cy_ + 1.6, "ICT-RISR", stroke=TRAY, fill="#f3e6d6", width=0.7)
        else:
            page.rect(cx_ + 1, cy_ - 1.6, cx_ + 6, cy_ + 1.6, "ICT-RACK", stroke=ICT, fill="#cfe0d6", width=0.6)
        for j, ln in enumerate(wrap(t, 6.2, pw / 2 - 12)[:2]):
            page.text((cx_ + 9, cy_ - 1 - j * 2.6 + (1.3 if len(wrap(t, 6.2, pw / 2 - 12)) > 1 else 0)), ln,
                      "A-ANNO-NOTE", size=6.2)
    y -= ((len(leg) + 1) // 2) * 7 + 3
    y = heading(page, px0, y, f"OUTLET {floor} ({len(outlets)} outlet, {sum(o['ports'] for o in outlets)} port)", pw)
    fx_ids = {}
    rows = [[o["id"], o["room"].split("-", 1)[1], str(o["ports"]), o["domain"].replace("NET-", ""),
             o["serves"]] for o in outlets]
    cols = [Col("ID", 18, "l", "B"), Col("Ruang", 14), Col("Port", 7, "r"), Col("Domain", 13), Col("Melayani", 17)]
    half = (len(rows) + 1) // 2
    _, y1 = draw_table(page, px0, y, cols, rows[:half], size=5.6, lead=1.15, row_xd=lambda r: ("outlet", r[0]))
    _, y2 = draw_table(page, px0 + pw / 2 + 0.5, y, cols, rows[half:], size=5.6, lead=1.15,
                       row_xd=lambda r: ("outlet", r[0])) if rows[half:] else (0, y)
    y = min(y1, y2) - 4
    y = heading(page, px0, y, f"PERANGKAT {floor} (AP {sum(1 for d in devs if d['type'] == 'ap')}, kamera "
                f"{sum(1 for d in devs if d['type'] == 'camera')})", pw)
    drows = [[d["id"], d["room"].split("-", 1)[1], d["outlet"], f"{d['z']:.1f} m".replace(".", ","),
              str(d["poeClass"]), d["status"]] for d in devs]
    _, y = draw_table(page, px0, y, [Col("ID", 18, "l", "B"), Col("Ruang", 16), Col("Outlet", 18), Col("Tinggi", 12),
                                     Col("PoE", 8, "r"), Col("Status", pw - 72)], drows, size=5.8,
                      row_xd=lambda r: ("device", r[0]))
    y = assumptions_block(page, px0, y - 3, pw, world, ["AS-ICT-01", "AS-ICT-02", "AS-ICT-03", "AS-NET-01"], size=6.2)
    assert y > tb[3] + 2, f"{sheet['id']}: panel overflow {y:.1f}"
    sd.summary = {"outlets": len(outlets), "ports": sum(o["ports"] for o in outlets),
                  "aps": sum(1 for d in devs if d["type"] == "ap"),
                  "cameras": sum(1 for d in devs if d["type"] == "camera"), "wet_room_cameras": wet_cams}
    return sd


# ------------------------------------------------------------------ ICT-201

TYPE_FILL = {"patch_panel_24": "#cfe0d6", "cable_manager": "#eef0ee", "switch_access_48_poe": "#bcd3c6",
             "switch_aggregation": "#a9c6b6", "gateway_virtual": "#e8d5b9", "server_placeholder": "#d6e3ea",
             "storage_placeholder": "#e6dcef", "pdu": "#f0cfc4", "ups_placeholder": "#f3e3c3"}
TYPE_LABEL = {"patch_panel_24": "patch panel 24 port", "cable_manager": "cable manager",
              "switch_access_48_poe": "switch akses 48 port PoE (model TBD)",
              "switch_aggregation": "switch agregasi (model TBD)", "gateway_virtual": "gateway virtual (demo)",
              "server_placeholder": "server placeholder", "storage_placeholder": "storage placeholder",
              "pdu": "PDU", "ups_placeholder": "UPS placeholder (rating TBD, AS-ICT-05)"}


def build_racks(sheet, ctx):
    world = ctx["world"]
    ict = world["ict"]
    den = int(sheet["scale"].split(":")[1])
    sd = SheetDoc(sheet, world, make_meta(sheet, world, ctx, "L1"))
    page = sd.new_page()
    (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, 1, 1, ctx["utc"], ctx["sha"])
    devices = 0
    for i, r in enumerate(ict["racks"]):
        fx = next(f for f in world["fixtures"] if f["id"] == r["fixture"])
        W, D, H = fx["size"]
        units = r["units"]
        base = (H - units * U_M) / 2
        ox, oy = fx0 + 18 + i * 112, 150
        v = page.view(f"rack-{r['id']}", den, (ox, oy), (ox - 14, oy - 8, ox + W * 1000 / den + 80, oy + H * 1000 / den + 8),
                      model_offset_m=(i * 3.0, -20.0))
        v.rect(0, 0, W, H, "ICT-RACK", stroke=ICT, fill="#f4f6f5", width=1.0, xd=("rack", r["id"]))
        rail0 = (W - 0.4826) / 2
        v.rect(rail0, base, W - rail0, base + units * U_M, "ICT-RACK", stroke=GRID, width=0.3)
        for u in range(1, units + 1):
            zb = base + (u - 1) * U_M
            v.line((rail0, zb), (rail0 + 0.02, zb), "ICT-RACK", stroke=GRID, width=0.2)
            v.text((-0.03, zb + U_M * 0.25), str(u), "ICT-RACK-IDEN", size=3.8, color=GREY_TEXT, align="r")
        for d in sorted(r["contents"], key=lambda d: -d["u"]):
            zb = base + (d["u"] - 1) * U_M
            zt = zb + d["height"] * U_M
            v.rect(rail0 + 0.004, zb + 0.002, W - rail0 - 0.004, zt - 0.002, "ICT-RACK-DEV", stroke=ICT,
                   fill=TYPE_FILL.get(d["type"], "#ffffff"), width=0.4,
                   xd=("rack_device", d["device"], {"rack": r["id"], "u": d["u"], "height": d["height"]}))
            v.text((W / 2, zb + U_M * 0.22), d["device"], "ICT-RACK-IDEN", size=4.3, font="B", color=INK, align="c",
                   xd=("rack_device", d["device"]))
            ulab = f"U{d['u']}" + (f"-{d['u'] + d['height'] - 1}" if d["height"] > 1 else "")
            v.line((W, (zb + zt) / 2), (W + 0.12, (zb + zt) / 2), "ICT-RACK-IDEN", stroke=GREY_TEXT, width=0.25)
            v.text((W + 0.15, (zb + zt) / 2 - U_M * 0.32), f"{ulab}  {TYPE_LABEL.get(d['type'], d['type'])}",
                   "ICT-RACK-IDEN", size=4.9, color=INK)
            devices += 1
        v.line((-0.4, 0), (W + 1.6, 0), "ICT-RACK", stroke=INK, width=0.9)
        view_title(page, ox - 6, oy + H * 1000 / den + 12, f"{r['id']} TAMPAK DEPAN",
                   f"1:{den} · {r['room']} · {units}U", size=9)
    # Clearance plan 1:100 from the rack fixtures and catalog clearance (AS-ICT-06).
    cden = 100
    room = next(rr for rr in world["rooms"] if rr["id"] == ict["racks"][0]["room"])
    xs = [p[0] for p in room["polygon"]]
    ys = [p[1] for p in room["polygon"]]
    cx0, cy0 = fx0 + 250, 168
    cv = page.view("clearance", cden, (cx0 - min(xs) * 10, cy0 - min(ys) * 10),
                   (cx0 - 6, cy0 - 6, cx0 + (max(xs) - min(xs)) * 10 + 34, cy0 + (max(ys) - min(ys)) * 10 + 6),
                   model_offset_m=(0, 0))
    cv.poly(room["polygon"], "A-WALL", closed=True, stroke=GREEN, width=1.2)
    clr = world["catalog"]["rack_42u"]["clearance"]
    for r in ict["racks"]:
        fx = next(f for f in world["fixtures"] if f["id"] == r["fixture"])
        W, D = fx["size"][:2]
        from krcad.planmodel import _fixture_local as L
        front = [L(fx, -W / 2, -D / 2), L(fx, W / 2, -D / 2), L(fx, W / 2, -D / 2 - clr["front"]),
                 L(fx, -W / 2, -D / 2 - clr["front"])]
        rear = [L(fx, -W / 2, D / 2), L(fx, W / 2, D / 2), L(fx, W / 2, D / 2 + clr["rear"]),
                L(fx, -W / 2, D / 2 + clr["rear"])]
        cv.poly(front, "ICT-CLRZ", closed=True, stroke=TERRA, fill="#f6e3da", width=0.3, dash=(2, 1))
        cv.poly(rear, "ICT-CLRZ", closed=True, stroke=TERRA, fill="#f6e3da", width=0.3, dash=(2, 1))
        cv.poly(fixture_corners(fx), "ICT-RACK", closed=True, stroke=ICT, fill="#cfe0d6", width=0.6,
                xd=("rack", r["id"]))
        cv.text(fx["pos"], r["id"][-2:], "ICT-RACK-IDEN", size=5, font="B", color=ICT, align="c")
    cv.text((min(xs) + 0.3, min(ys) + 0.3), room["id"], "A-ANNO-RMNM", size=6, font="B", color=GREEN)
    cv.text((max(xs) + 0.3, 21.0), f"depan {fmt_m(clr['front'])} m", "ICT-CLRZ", size=5.6, color=TERRA)
    cv.text((max(xs) + 0.3, 23.3), f"belakang {fmt_m(clr['rear'])} m", "ICT-CLRZ", size=5.6, color=TERRA)
    page.text((cx0 - 4, cy0 + (max(ys) - min(ys)) * 10 + 9), "CLEARANCE RACK 1:100 (AS-ICT-06)", "A-ANNO-NOTE",
              size=8, font="B", color=GREEN)
    # Contents table.
    rows = []
    for r in ict["racks"]:
        for d in sorted(r["contents"], key=lambda d: -d["u"]):
            ports = ict["rackDeviceTypes"].get(d["type"], {}).get("ports")
            rows.append([r["id"], f"U{d['u']}", str(d["height"]), d["device"], TYPE_LABEL.get(d["type"], d["type"]),
                         str(ports) if ports else "-"])
    x = fx0 + 250
    y = 150
    y = heading(page, x, y, "ISI RACK (world.json racks[].contents)", fx1 - x - 4, size=8)
    _, y = draw_table(page, x, y, [Col("Rack", 18, "l", "B"), Col("U", 9), Col("Tinggi", 10, "r"),
                                   Col("Perangkat", 23, "l", "B"), Col("Tipe", fx1 - x - 4 - 72), Col("Port", 12, "r")],
                      rows, size=5.6, row_xd=lambda rr: ("rack_device", rr[3]))
    yn = fy0 + 46
    for n_ in [f"Skala tampak rack 1:{den}; 1U = 44,45 mm, nomor U dihitung dari bawah.",
               "Model switch, PDU dan UPS belum dipilih (AS-ICT-04, AS-ICT-05); tidak ada harga.",
               f"Clearance depan {fmt_m(clr['front'])} m / belakang {fmt_m(clr['rear'])} m adalah target konsep dari "
               "catalog (AS-ICT-06), wajib diverifikasi ke standar yang dipilih."]:
        yn = paragraph(page, fx0 + 4, yn, n_, tb[0] - fx0 - 12, size=6.2, bullet=True)
    assert y > tb[3] + 2, f"ICT-201 table overflow {y:.1f}"
    sd.summary = {"racks": len(ict["racks"]), "devices": devices}
    return sd


# ------------------------------------------------------------------ ICT-301

def route_segments(cable):
    """Split a portmap route into per-floor polylines (riser hops excluded)."""
    segs = []
    cur = []
    cur_f = None
    for x, y, f in cable["route"]:
        if f != cur_f and cur:
            segs.append((cur_f, cur))
            cur = []
        cur_f = f
        cur.append((x, y))
    if cur:
        segs.append((cur_f, cur))
    return [(f, pts) for f, pts in segs if len(pts) >= 2]


def build_pathways(sheet, ctx):
    world, pm = ctx["world"], ctx["portmap"]
    ict = world["ict"]
    den = int(sheet["scale"].split(":")[1])
    sd = SheetDoc(sheet, world, make_meta(sheet, world, ctx, "L1, L2"))
    page = sd.new_page()
    (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, 1, 1, ctx["utc"], ctx["sha"])
    floors = sorted(world["floors"], key=lambda f: f["elevation"])
    origins = {floors[0]["id"]: (fx0 + 16, 136), floors[1]["id"]: (fx0 + 206, 136)}
    route_counts = {}
    views = {}
    for i, f in enumerate(floors):
        plan = build_plan(world, f["id"], den, with_tags=False)
        ox, oy = origins[f["id"]]
        x0, y0, x1, y1 = plan["extent"]
        Wm, Hm = (x1 - x0) * 1000 / den, (y1 - y0) * 1000 / den
        v = page.view(f"path-{f['id']}", den, (ox, oy), (ox - 6, oy - 6, ox + Wm + 6, oy + Hm + 6),
                      model_offset_m=(i * 40.0, 0.0))
        views[f["id"]] = v
        plan_base(v, plan, mode="light", fixtures=None, grid=False, doors=False, vlinks=True)
        for t in ict["pathways"]["trays"]:
            if t["floor"] == f["id"]:
                v.line(t["from"], t["to"], "ICT-TRAY", stroke=TRAY, width=3.0, alpha=0.35, xd=("tray", t["id"]))
        view_title(page, ox, oy + Hm + 9, f"JALUR KABEL {f['id']}", f"1:{den} · tray +3,2 m", size=9)
    for c in pm["cables"]:
        for fl, pts in route_segments(c):
            views[fl].poly(pts, "ICT-ROUT", stroke=ROUTE[c["floor"]], width=0.35, alpha=1.0,
                           xd=("cable", c["cable"], {"floor": c["floor"], "segment_floor": fl}))
        route_counts[c["floor"]] = route_counts.get(c["floor"], 0) + 1
    for f in floors:
        v = views[f["id"]]
        for n in ict["pathways"]["nodes"]:
            if n["floor"] == f["id"] and "RISER" in n["id"] and not n["id"].endswith("-S"):
                x, y = n["pos"]
                v.rect(x - 0.45, y - 0.45, x + 0.45, y + 0.45, "ICT-RISR", stroke=TRAY, fill="#f3e6d6", width=0.8,
                       xd=("node", n["id"]))
                v.text((x, y + 0.8), "RISER", "ICT-RISR", size=5, font="B", color=TRAY, align="c", knock=True)
        for r in ict["racks"]:
            if r["floor"] == f["id"]:
                fx = next(ff for ff in world["fixtures"] if ff["id"] == r["fixture"])
                v.poly(fixture_corners(fx), "ICT-RACK", closed=True, stroke=ICT, fill="#cfe0d6", width=0.6,
                       xd=("rack", r["id"]))
        for o in ict["outlets"]:
            if o["floor"] == f["id"]:
                v.circle(o["pos"], 0.16, "ICT-OUTL", stroke=None, fill=ROUTE[f["id"]], xd=("outlet", o["id"]))
    # Lengths summary.
    x = fx0 + 4
    y = 122
    y = heading(page, x, y, "RINGKASAN PANJANG KABEL (ict-portmap.json)", 205, size=8)
    rows = []
    for f in floors:
        cs = [c for c in pm["cables"] if c["floor"] == f["id"]]
        if not cs:
            continue
        L = [c["length_m"] for c in cs]
        rows.append([f["id"], str(len(cs)), f"{sum(L):.1f}", f"{min(L):.1f}", f"{max(L):.1f}",
                     f"{sum(L) / len(L):.1f}"])
    allL = [c["length_m"] for c in pm["cables"]]
    rows.append(["Total", str(len(allL)), f"{sum(allL):.1f}", f"{min(allL):.1f}", f"{max(allL):.1f}",
                 f"{sum(allL) / len(allL):.1f}"])
    rows = [[c.replace(".", ",") for c in r] for r in rows]
    _, y = draw_table(page, x, y, [Col("Lantai", 18, "l", "B"), Col("Kabel", 16, "r"), Col("Total m", 22, "r", "M"),
                                   Col("Min m", 18, "r"), Col("Maks m", 18, "r"), Col("Rata m", 18, "r")], rows,
                      size=6.4)
    chk = portmap_check(world, pm)
    sum_txt = f"{chk['sum_length_m']:.1f}".replace(".", ",")
    decl_txt = f"{chk['declared_total_m']:.1f}".replace(".", ",")
    y = paragraph(page, x, y - 1.5, f"Cek: jumlah baris {sum_txt} m vs total port map {decl_txt} m: "
                  f"{'COCOK' if chk['total_ok'] else 'TIDAK COCOK'}. Semua kabel di bawah target "
                  f"{ict['pathways']['maxLinkM']:g} m (AS-ICT-03).", 130, size=6.2)
    # Riser schematic.
    rx, ry = fx0 + 150, 70
    page.text((rx, ry + 40), "SKEMA RISER", "ICT-RISR", size=8, font="B", color=GREEN)
    n_up = route_counts.get(floors[1]["id"], 0)
    page.rect(rx, ry, rx + 20, ry + 10, "ICT-RISR", stroke=ICT, fill="#cfe0d6", width=0.6)
    page.text((rx + 10, ry + 4), "RK-L1", "ICT-RISR", size=6, font="B", align="c")
    page.line((rx + 20, ry + 5), (rx + 40, ry + 5), "ICT-RISR", stroke=TRAY, width=1.4)
    page.rect(rx + 40, ry, rx + 46, ry + 34, "ICT-RISR", stroke=TRAY, fill="#f3e6d6", width=0.6)
    page.line((rx + 46, ry + 29), (rx + 62, ry + 29), "ICT-RISR", stroke=ROUTE["L2"], width=1.4)
    page.text((rx + 48, ry + 31), f"L2: {n_up} kabel", "ICT-RISR", size=6, font="M", color=ROUTE["L2"])
    page.text((rx, ry - 4), f"L1: {route_counts.get(floors[0]['id'], 0)} kabel tetap di L1 (tray L1)", "ICT-RISR",
              size=6, font="M", color=ROUTE["L1"])
    page.text((rx + 48, ry + 17), f"naik {fmt_m(ict['pathways']['riserVertical'])} m", "ICT-RISR", size=6,
              color=TRAY)
    yn = fy0 + 46
    for n_ in ["Garis hijau = kabel endpoint L1, coklat = kabel endpoint L2 (bagian di L1 ikut warna lantai tujuan).",
               "Panjang = route tray + naik rack 1,2 m + riser 4,0 m (L2) + drop + slack 3,3 m (AS-ICT-02)."]:
        yn = paragraph(page, fx0 + 4, yn, n_, 140, size=6.0, bullet=True)
    scale_bar(page, fx0 + 4, fy0 + 4, den, (0, 2, 5, 10, 20))
    sd.summary = {"route_counts": route_counts, "check": chk}
    return sd


# ------------------------------------------------------------------ ICT-401

def build_port_schedule(sheet, ctx):
    world, pm = ctx["world"], ctx["portmap"]
    sd = SheetDoc(sheet, world, make_meta(sheet, world, ctx, "L1, L2"))
    chk = portmap_check(world, pm)
    cols = [Col("Kabel", 31, "l", "B"), Col("Port outlet", 27), Col("Ruang", 23), Col("PP/port", 20),
            Col("Switch/port", 27), Col("Domain", 23), Col("PoE", 10, "r"), Col("m", 13, "r", "M"),
            Col("Label sisi rack", 54), Col("Label sisi outlet", 54), Col("Endpoint", 58)]
    rows = [[c["cable"], c["outletPort"], c["room"], f"{c['patchPanel']}/{c['ppPort']:02d}",
             f"{c['switch']}/{c['switchPort']:02d}", c["domain"], str(c.get("poeClass") or "-"),
             f"{c['length_m']:.1f}".replace(".", ","), c["labelRackEnd"], c["labelOutletEnd"],
             f"{c['endpoint']} {c['serves']}"] for c in pm["cables"]]
    total = round(sum(c["length_m"] for c in pm["cables"]), 1)
    rows.append(["Total", f"{len(pm['cables'])} kabel", "", "", "", "", "", f"{total:.1f}".replace(".", ","),
                 f"port map: {pm['totals']['cable_m']:g} m".replace(".", ","),
                 "COCOK" if chk["total_ok"] else "TIDAK COCOK", ""])
    avail = 287 - 10 - 64 - 10
    chunks = []
    rest = rows
    while rest:
        hs = table_rows_height(cols, rest, 6.2, 1.15)
        used, n = 6, 0
        for h in hs:
            if used + h > avail:
                break
            used += h
            n += 1
        chunks.append(rest[:max(n, 1)])
        rest = rest[max(n, 1):]
    npages = len(chunks) + 1
    for i, chunk in enumerate(chunks):
        page = sd.new_page(f"{i + 1}/{npages}")
        (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, i + 1, npages, ctx["utc"], ctx["sha"])
        page.text((fx0 + 4, fy1 - 9), "PORT SCHEDULE", "A-ANNO-NOTE", size=10, font="B", color=GREEN)
        page.text((fx0 + 46, fy1 - 8.7), f"{VIRTUAL.lower()} · sumber design/derived/ict-portmap.json "
                  f"(world {pm.get('worldRevision')})", "A-ANNO-NOTE", size=7)
        draw_table(page, fx0 + 4, fy1 - 13, cols, chunk, size=6.2, lead=1.15,
                   row_xd=lambda r: ("cable", r[0]) if r[0].startswith("C-") else None)
        paragraph(page, fx0 + 4, fy0 + 46, "Label dua ujung: sisi rack 'PP-nn-pp > port outlet', sisi outlet "
                  "sebaliknya. Panjang mengikuti AS-ICT-02; batas 90 m AS-ICT-03.", tb[0] - fx0 - 12, size=6.2)
    page = sd.new_page(f"{npages}/{npages}")
    (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, npages, npages, ctx["utc"], ctx["sha"])
    page.text((fx0 + 4, fy1 - 9), "BOM RINGKAS DAN POE", "A-ANNO-NOTE", size=10, font="B", color=GREEN)
    y = heading(page, fx0 + 4, fy1 - 14, f"BOM (tanpa harga): {pm['bom']['status']}", 200, size=8)
    brows = [[b["item"], b["unit"], f"{b['qty']:g}".replace(".", ",")] for b in pm["bom"]["items"]]
    _, y = draw_table(page, fx0 + 4, y, [Col("Item", 150), Col("Satuan", 20), Col("Jumlah", 30, "r", "M")], brows,
                      size=6.4)
    y = paragraph(page, fx0 + 4, y - 2, f"Harga: tidak ada ({pm['bom']['priceSource']}; AS-ICT-05).", 200, size=6.4)
    x2 = fx0 + 215
    y2 = heading(page, x2, fy1 - 14, "POE PER SWITCH (BELUM DIVALIDASI)", fx1 - x2 - 4, size=8)
    prows = [[s["switch"], f"{s['used']}/{s['ports']}", str(s["spare"]), f"{s['poeWorstCaseW']:g}",
              "belum ada" if s["poeBudgetW"] is None else f"{s['poeBudgetW']:g}", s["poeStatus"]]
             for s in pm["switches"]]
    _, y2 = draw_table(page, x2, y2, [Col("Switch", 24, "l", "B"), Col("Port", 14), Col("Spare", 12, "r"),
                                      Col("Worst W", 15, "r"), Col("Budget W", 16, "r"), Col("Status", fx1 - x2 - 85)],
                       prows, size=6.2)
    y2 = paragraph(page, x2, y2 - 2, f"Total PoE worst-case {pm['poeTotalWorstCaseW']:g} W dari nilai PSE kelas IEEE "
                   "(AS-ICT-04): belum divalidasi karena datasheet switch belum dipilih.", fx1 - x2 - 4, size=6.4)
    y2 = heading(page, x2, y2 - 3, "TOTAL", fx1 - x2 - 4, size=8)
    for k, val in [("Outlet / port", f"{pm['totals']['outlets']} / {pm['totals']['ports']}"),
                   ("Panjang kabel", f"{total:.1f} m (baris) vs {pm['totals']['cable_m']:g} m (port map): "
                                     f"{'COCOK' if chk['total_ok'] else 'TIDAK COCOK'}".replace(".", ",")),
                   ("Terpanjang / terpendek", f"{pm['totals']['max_length_m']:g} / {pm['totals']['min_length_m']:g} m"
                    .replace(".", ",")),
                   ("Revisi data", f"port map {pm.get('worldRevision')} / world {world['revision']['id']}: "
                                   f"{'sama' if chk['revision_ok'] else 'BEDA, regenerasi port map'}")]:
        page.text((x2, y2 - 2.6), k, "A-ANNO-NOTE", size=6.4, font="B", color=GREEN)
        y2 = paragraph(page, x2 + 34, y2, val, fx1 - x2 - 38, size=6.4)
    assert y > fy0 + 2, f"ICT-401 BOM overflow {y:.1f}"
    sd.summary = {"check": chk, "rows": len(pm["cables"]), "pages": npages, "printed_total_m": total}
    return sd
