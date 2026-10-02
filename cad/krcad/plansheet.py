"""A-101/A-102 floor plan sheets (content "plan"): bespoke DXF + PDF writers."""
from __future__ import annotations

import math
from pathlib import Path

from tools.kantor.fonts import font_source_note
from tools.kantor.geometry import fixture_corners

from krcad.common import *  # noqa: F401,F403
from krcad.common import _setup_dxf, _xdata
from krcad.planmodel import _fixture_local, window_tag_outline

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
        t = msp.add_text(d["tag_text"], height=d["tag_size"] / PT_PER_MM * den * 0.72,
                         rotation=d["tag_rot"], dxfattribs={"layer": "A-DOOR-IDEN", "style": "KR-SANS"})
        t.set_placement(P(d["tag_pos"]), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        _xdata(t, "door", d["id"], tag=d["tag_text"])

    for w in plan["windows"]:
        xd = dict(glazing=w["glazing"], room=w["room"], sill=w["sill"], head=w["head"], width=w["width"])
        for a, b in w["faces"] + w["glass"] + w["hatch"]:
            e = msp.add_line(P(a), P(b), dxfattribs={"layer": "A-GLAZ"})
            _xdata(e, "window", w["id"], **xd)
        e = msp.add_lwpolyline([P(p) for p in w["sill_line"]], dxfattribs={"layer": "A-GLAZ"})
        _xdata(e, "window", w["id"], **xd)
        hx = msp.add_lwpolyline([P(q) for q in window_tag_outline(w, den, plan["fonts"])], close=True,
                                dxfattribs={"layer": "A-GLAZ-IDEN"})
        _xdata(hx, "window", w["id"], tag=w["tag_text"])
        t = msp.add_text(w["tag_text"], height=w["tag_size"] / PT_PER_MM * den * 0.72, rotation=w["tag_rot"],
                         dxfattribs={"layer": "A-GLAZ-IDEN", "style": "KR-SANS"})
        t.set_placement(P(w["tag_pos"]), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        _xdata(t, "window", w["id"], tag=w["tag_text"])

    for r in plan["rooms"]:
        pl = msp.add_lwpolyline([P(p) for p in r["polygon"]], close=True, dxfattribs={"layer": "A-AREA"})
        _xdata(pl, "room", r["id"], area_m2=f"{r['area']:.4f}")
        tag = plan["tags"][r["id"]]
        text = "\\P".join(t for t, _, _, _ in tag["lines"])
        # Cap height ~ 0.72 em, converted from the PDF point size at sheet scale.
        mt = msp.add_mtext(text, dxfattribs={"layer": "A-ANNO-RMNM", "style": "KR-SANS",
                                             "char_height": tag["lines"][-1][2] / PT_PER_MM * den * 0.72})
        mt.set_location(P(tag["pos"]), attachment_point=5)
        _xdata(mt, "room", r["id"], area_m2=f"{r['area']:.4f}")
        if tag.get("leader"):
            e = msp.add_line(P(tag["leader"][0]), P(tag["leader"][1]), dxfattribs={"layer": "A-ANNO-RMNM"})
            _xdata(e, "room", r["id"])

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


def write_pdf(sheet, world, plan, layout, path: Path, generated_utc: str, world_sha: str) -> dict:
    from reportlab.lib import colors
    from reportlab.pdfgen import canvas

    tf = plan["fonts"]
    F, FM, FB = tf.regular, tf.medium, tf.bold
    B = legible_pt(sheet["size"])  # every text on the sheet is at least this (prints >= 2,5 mm on A3)
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
            c.setFont(FB, B)
            c.drawCentredString(px, py - B * 0.35, g["label"])

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
            c.setFont(FB, B)
            tw = tf.width(v["label"], FB, B)
            c.setFillColor(colors.white)
            c.rect(lx - tw / 2 - 1.5, ly - B * 0.5, tw + 3, B, stroke=0, fill=1)
            c.setFillColor(col(TERRA))
            c.drawCentredString(lx, ly - B * 0.35, v["label"])

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
        tw = tf.width(d["tag_text"], FM, d["tag_size"])
        c.setFillColor(colors.white)
        c.rect(-tw / 2 - 1, -d["tag_size"] * 0.55, tw + 2, d["tag_size"] * 1.1, stroke=0, fill=1)
        c.setFillColor(col(GREY_TEXT))
        c.setFont(FM, d["tag_size"])
        c.drawCentredString(0, -d["tag_size"] * 0.34, d["tag_text"])
        c.restoreState()

    # Windows: wall faces and sill board in ink, glass as a thin double line,
    # obscured glazing hatched so it reads without colour.
    for w in plan["windows"]:
        c.setStrokeColor(col(GREEN))
        c.setLineWidth(0.45)
        for a, b in w["faces"]:
            c.line(*W(a), *W(b))
        c.setLineWidth(0.3)
        for a, b in w["glass"]:
            c.line(*W(a), *W(b))
        c.setLineWidth(0.4)
        sp = [W(p) for p in w["sill_line"]]
        for a, b in zip(sp, sp[1:]):
            c.line(*a, *b)
        c.setLineWidth(0.25)
        for a, b in w["hatch"]:
            c.line(*W(a), *W(b))
        tx, ty = W(w["tag_pos"])
        c.saveState()
        c.translate(tx, ty)
        c.rotate(w["tag_rot"])
        hexpts, _, _ = window_tag_shape(tf.width(w["tag_text"], FM, w["tag_size"]), w["tag_size"])
        pth = c.beginPath()
        pth.moveTo(*hexpts[0])
        for q in hexpts[1:]:
            pth.lineTo(*q)
        pth.close()
        c.setFillColor(colors.white)
        c.setStrokeColor(col(GREEN))
        c.setLineWidth(0.5)
        c.drawPath(pth, stroke=1, fill=1)
        c.setFillColor(col(INK))
        c.setFont(FM, w["tag_size"])
        c.drawCentredString(0, -w["tag_size"] * 0.35, w["tag_text"])
        c.restoreState()

    # Room tags with a paper knockout so grid lines never cut through text.
    for r in plan["rooms"]:
        tag = plan["tags"][r["id"]]
        if tag.get("leader"):
            a, b_ = tag["leader"]
            c.setStrokeColor(col(GREY_TEXT))
            c.setLineWidth(0.4)
            c.line(*W(a), *W(b_))
            c.setFillColor(col(GREY_TEXT))
            c.circle(*W(a), 1.3, stroke=0, fill=1)
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
    dim_font = B
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

    _pdf_title_strip(c, sheet, world, plan, layout, tf)
    _pdf_panel(c, sheet, world, plan, layout, tf, generated_utc, world_sha)
    c.showPage()
    c.save()
    return {"page_pt": page}


def _pdf_title_strip(c, sheet, world, plan, layout, tf):
    """Title, scale line, graphic scale bar and the floor key, all at the
    sheet's legible size (B)."""
    from reportlab.lib import colors
    col = colors.HexColor
    B = legible_pt(sheet["size"])

    def mm(v):
        return v * PT_PER_MM
    ts = layout["title_strip"]
    floor = plan["floor"]
    c.setFillColor(col(GREEN))
    c.setFont(tf.bold, 20)
    c.drawString(mm(ts[0] + 8), mm(ts[1] + 21), sheet["title"].upper())
    c.setFillColor(col(INK))
    c.setFont(tf.regular, B)
    c.drawString(mm(ts[0] + 8), mm(ts[1] + 14.5), f"Skala {sheet['scale']} @ {sheet['size']}  ·  lantai {floor}")
    c.drawString(mm(ts[0] + 8), mm(ts[1] + 9.5), "Ukuran dalam mm, as ke as dinding")
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
    c.setFont(tf.medium, B)
    for m, x in zip(sb["marks_m"], xs):
        c.drawCentredString(x, y + h + 2.5, str(m))
    c.drawString(xs[-1] + 5, y + 0.6, "m")
    c.setFont(tf.regular, B)
    c.setFillColor(col(GREY_TEXT))
    c.drawString(xs[0], y - B - 1.5, f"Benar pada cetak {sheet['size']} 100%: 10 m = {sb['length_mm']:.0f} mm")
    # Floor key at the right end of the strip.
    _pdf_floor_key(c, world, plan, tf, B, mm(ts[2] - 112), mm(ts[3] - 3))


def _pdf_floor_key(c, world, plan, tf, B, left, top):
    """Schematic floor stack (not to scale) with the current floor filled."""
    from reportlab.lib import colors
    col = colors.HexColor
    floors = sorted(world["floors"], key=lambda f: f["level"])
    band = B * 1.55
    gap = 1.5 * PT_PER_MM
    bw = 46 * PT_PER_MM
    y = top - len(floors) * (band + gap)
    for f in floors:
        current = f["id"] == plan["floor"]
        c.setStrokeColor(col(GREEN))
        c.setLineWidth(0.8 if current else 0.5)
        c.setFillColor(col("#d9e6df") if current else colors.white)
        c.rect(left, y, bw, band, stroke=1, fill=1)
        c.setFillColor(col(GREEN))
        c.setFont(tf.bold, B)
        c.drawString(left + 5, y + band / 2 - B * 0.35, f["id"])
        c.setFillColor(col(INK))
        c.setFont(tf.regular, B)
        c.drawString(left + 6 + tf.width("L2", tf.bold, B) + 6, y + band / 2 - B * 0.35,
                     f"{fmt_elev(f['elevation'])} m")
        c.setFont(tf.bold if current else tf.regular, B)
        c.drawString(left + bw + 6, y + band / 2 - B * 0.35, f["name"].split(" - ")[-1]
                     + (" (lembar ini)" if current else ""))
        y += band + gap
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(1.2)
    base = top - len(floors) * (band + gap) - 1.5
    c.line(left - 4, base, left + bw + 4, base)


def _pdf_panel(c, sheet, world, plan, layout, tf, generated_utc, world_sha):
    """Right panel at the sheet's legible size: north arrow, legend, room list,
    notes, revision history and the title block. The full assumption texts
    live on A-001; this panel cites their IDs."""
    from reportlab.lib import colors
    from reportlab.lib.utils import simpleSplit
    col = colors.HexColor
    B = legible_pt(sheet["size"])
    LH = B * 1.2  # line pitch, pt

    def mm(v):
        return v * PT_PER_MM
    px0, py0, px1, py1 = layout["panel"]
    left = mm(px0 + 6)
    right = mm(px1 - 6)
    width = right - left
    y = mm(py1 - 5)

    def heading(text):
        nonlocal y
        c.setFillColor(col(GREEN))
        c.setFont(tf.bold, B * 1.1)
        c.drawString(left, y - B * 1.1, text)
        y -= B * 1.1 + 4
        c.setStrokeColor(col(GREEN))
        c.setLineWidth(0.4)
        c.line(left, y, right, y)
        y -= 4

    def para(text, x=None, w=None, font=None, color=INK, bullet=False):
        nonlocal y
        x = left if x is None else x
        w = width if w is None else w
        c.setFont(font or tf.regular, B)
        c.setFillColor(col(color))
        lines = simpleSplit(text, font or tf.regular, B, w - (7 if bullet else 0))
        if bullet:
            c.circle(x + 2, y - B * 0.62, 1.1, stroke=0, fill=1)
        for ln in lines:
            y -= LH
            c.drawString(x + (7 if bullet else 0), y + B * 0.22, ln)
        y -= 2

    # North arrow + orientation notes beside it.
    r = mm(8)
    nx, ny = left + r, y - r - B * 1.2
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(0.8)
    c.circle(nx, ny, r, stroke=1, fill=0)
    for side, fill in ((-1, col(GREEN)), (1, colors.white)):
        pth = c.beginPath()
        pth.moveTo(nx, ny + r)
        pth.lineTo(nx + side * r * 0.4, ny - r * 0.6)
        pth.lineTo(nx, ny - r * 0.33)
        pth.close()
        c.setFillColor(fill)
        c.drawPath(pth, stroke=1 if side > 0 else 0, fill=1)
    c.setFillColor(col(GREEN))
    c.setFont(tf.bold, B * 1.1)
    c.drawCentredString(nx, ny + r + 2.5, "U")
    top = y
    para("Utara = sumbu Y+ dunia", x=left + 2 * r + 8, w=width - 2 * r - 8, font=tf.bold)
    para("Origin (0,0) sudut barat daya L1, X timur. Grid acuan konsep (1..n, A..n), bukan grid struktur "
         "(AS-DIM-03).", x=left + 2 * r + 8, w=width - 2 * r - 8)
    y = min(y, top - 2 * r - B * 1.6) - 3

    heading("LEGENDA")
    sw = mm(13)
    items = [("wall_ext", "Dinding luar 0,30 m"), ("wall_int", "Dinding dalam 0,15 m"),
             ("door1", "Pintu tunggal, buka 90°"), ("door2", "Pintu ganda"),
             ("opening", "Bukaan tanpa daun"), ("hatch", "Akses shaft / riser"),
             ("furn", "Furniture (AS-DIM-04)"), ("stair", "Tangga U / lift"),
             ("grid", "Grid acuan konsep"), ("dim", "Dimensi mm, as ke as"),
             ("tag", "Tag ruang: ID, nama, luas"), ("dtag", "Tag pintu Dnn"),
             ("win", "Jendela bening, tag Wnn"), ("win_obs", "Jendela kaca buram")]
    colw = width / 2
    for i in range(0, len(items), 2):
        pair = items[i:i + 2]
        nlines = max(len(simpleSplit(t, tf.regular, B, colw - sw - 8)) for _, t in pair)
        row = max(mm(6.5), nlines * LH + 3)
        cy_ = y - row / 2
        for k, (kind, text) in enumerate(pair):
            x0s = left + k * colw
            _legend_symbol(c, kind, x0s, cy_, sw, tf, B)
            lines = simpleSplit(text, tf.regular, B, colw - sw - 8)
            c.setFillColor(col(INK))
            c.setFont(tf.regular, B)
            for j, ln in enumerate(lines):
                c.drawString(x0s + sw + 5, cy_ - B * 0.35 + (len(lines) - 1) * LH / 2 - j * LH, ln)
        y -= row
    y -= 3

    heading(f"DAFTAR RUANG {plan['floor']} (luas as-drawn)")
    c.setFillColor(col(GREY_TEXT))
    c.setFont(tf.medium, B)
    c.drawString(left, y - B, "ID")
    c.drawString(left + mm(27), y - B, "Nama")
    c.drawRightString(right, y - B, "Luas")
    y -= B + 4
    for r_ in plan["rooms"]:
        name_lines = simpleSplit(r_["name"], tf.regular, B, width - mm(27) - tf.width("000,00 m²", tf.medium, B) - 6)
        c.setFillColor(col(GREEN))
        c.setFont(tf.bold, B)
        c.drawString(left, y - B, r_["id"])
        c.setFillColor(col(INK))
        c.setFont(tf.regular, B)
        for j, ln in enumerate(name_lines):
            c.drawString(left + mm(27), y - B - j * LH, ln)
        c.setFont(tf.medium, B)
        c.drawRightString(right, y - B, fmt_area(r_["area"]))
        y -= LH * len(name_lines) + 1
    total = sum(r_["area"] for r_ in plan["rooms"])
    x0e, y0e, x1e, y1e = plan["extent"]
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(0.4)
    c.line(left, y - 1, right, y - 1)
    y -= 2
    c.setFillColor(col(INK))
    c.setFont(tf.bold, B)
    c.drawString(left, y - B, f"Jumlah {len(plan['rooms'])} ruang")
    c.drawRightString(right, y - B, fmt_area(total))
    y -= LH + 1
    para(f"= envelope {fmt_m(x1e - x0e)} x {fmt_m(y1e - y0e)} m ({fmt_area((x1e - x0e) * (y1e - y0e))})",
         color=GREY_TEXT)
    y -= 3

    heading("CATATAN")
    floor_meta = floor_of(world, plan["floor"])
    seats = sum(1 for sl in world["activitySlots"] if sl["floor"] == plan["floor"] and sl.get("pose") == "sit")
    exits = sum(1 for d in plan["doors"] if d["target"] == "EXT")
    notes = [
        f"Sumber tunggal design/world.json revisi {world['revision']['id']}; dinding dari tools/kantor/geometry.py.",
        f"Pintu: arah buka dan engsel dari doors[].swing. Tag Dnn = pintu D-{plan['floor']}-nn; daftar di A-103.",
        f"Jendela: {len(plan['windows'])} di lantai ini, "
        f"{sum(1 for w in plan['windows'] if w['glazing'] == 'obscured')} buram. Tag Wnn = W-{plan['floor']}-0nn; "
        "ambang dan kepala di A-103 dan A-301.",
        f"Lantai {floor_meta['id']}: {len(plan['rooms'])} ruang, {len(plan['doors'])} pintu/bukaan, "
        f"{len(plan['fixtures']) + len(plan['vlinks'])} fixture, {seats} slot duduk (AS-OCC-02). Exit konsep: {exits}, "
        "belum dinilai terhadap peraturan (AS-OCC-01).",
        "Asumsi AS-DIM-01, AS-DIM-02, AS-DIM-04 dan AS-DIM-05: teks lengkap di A-001.",
        f"DXF pasangan cad/out/{sheet['id']}.dxf (mm, 1:1). DWG native BLOCKED, lihat cad/AUTOCAD-RUNBOOK.md.",
    ]
    for v in world["verticalLinks"]:
        if v["type"] == "escape_concept" and any(e["floor"] == plan["floor"] for e in v["ends"]):
            notes.append(f"{v['id']}: {v['prompt']}; di luar envelope, tidak digambar (AS-EXIT-01).")
    for n in notes:
        para(n, bullet=True)
    notes_bottom = y

    # Revision history sits directly on the title block, as on a paper set.
    rev = world["revision"]
    tb_top = _pdf_title_block(c, sheet, world, plan, layout, tf, generated_utc, world_sha, B)
    rev_lines = simpleSplit(f"{rev['note']}. Lembar dihasilkan dari world.json revisi ini.", tf.regular, B,
                            width - mm(30))
    y = tb_top + 4 + B * 1.1 + 8 + B + 4 + len(rev_lines) * LH + 2
    assert notes_bottom > y + 2, f"{sheet['id']}: panel content runs into the revision table"
    heading("RIWAYAT REVISI")
    c.setFillColor(col(GREY_TEXT))
    c.setFont(tf.medium, B)
    c.drawString(left, y - B, "Rev")
    c.drawString(left + mm(10), y - B, "Tanggal")
    c.drawString(left + mm(30), y - B, "Keterangan")
    y -= B + 4
    c.setFillColor(col(INK))
    c.setFont(tf.bold, B)
    c.drawString(left, y - B, rev["id"])
    c.setFont(tf.regular, B)
    c.drawString(left + mm(10), y - B, rev["date"])
    for j, ln in enumerate(rev_lines):
        c.drawString(left + mm(30), y - B - j * LH, ln)


def _legend_symbol(c, kind, x0s, cy_, sw, tf, B):
    from reportlab.lib import colors
    col = colors.HexColor

    def mm(v):
        return v * PT_PER_MM
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
        c.line(x0s, cy_, x0s + sw - 10, cy_)
        c.setDash()
        c.setStrokeColor(col(DIM))
        c.setFillColor(colors.white)
        c.circle(x0s + sw - 4.5, cy_, B * 0.62, stroke=1, fill=1)
        c.setFillColor(col(INK))
        c.setFont(tf.bold, B)
        c.drawCentredString(x0s + sw - 4.5, cy_ - B * 0.35, "1")
    elif kind == "dim":
        c.setStrokeColor(col(DIM))
        c.setLineWidth(0.35)
        c.line(x0s, cy_ - 4, x0s + sw, cy_ - 4)
        c.setLineWidth(0.9)
        for q in (x0s + 2, x0s + sw - 2):
            c.line(q - 1.6, cy_ - 5.6, q + 1.6, cy_ - 2.4)
        c.setFillColor(col(DIM))
        c.setFont(tf.medium, B)
        c.drawCentredString(x0s + sw / 2, cy_ - 2.5, "8000")
    elif kind == "tag":
        c.setFillColor(col(GREEN))
        c.setFont(tf.bold, B)
        c.drawCentredString(x0s + sw / 2, cy_ - B * 0.35, "ID")
    elif kind in ("win", "win_obs"):
        c.setStrokeColor(col(GREEN))
        wx0, wx1 = x0s + 3, x0s + sw - 3
        c.setFillColor(col(GREEN))
        c.rect(x0s, cy_ - mm(1.5), 3, mm(3.0), stroke=0, fill=1)
        c.rect(wx1, cy_ - mm(1.5), 3, mm(3.0), stroke=0, fill=1)
        c.setLineWidth(0.45)
        for dy in (-mm(1.5), mm(1.5)):
            c.line(wx0, cy_ + dy, wx1, cy_ + dy)
        c.setLineWidth(0.3)
        for dy in (-mm(0.25), mm(0.25)):
            c.line(wx0, cy_ + dy, wx1, cy_ + dy)
        if kind == "win_obs":
            c.setLineWidth(0.25)
            pth = c.beginPath()
            pth.rect(wx0, cy_ - mm(1.5), wx1 - wx0, mm(3.0))
            c.saveState()
            c.clipPath(pth, stroke=0, fill=0)
            xk = wx0 - mm(3.0)
            while xk < wx1:
                c.line(xk, cy_ - mm(1.5), xk + mm(3.0), cy_ + mm(1.5))
                xk += mm(0.9)
            c.restoreState()
    elif kind == "dtag":
        c.setFillColor(col(GREY_TEXT))
        c.setFont(tf.medium, B)
        c.drawCentredString(x0s + sw / 2, cy_ - B * 0.35, "Dnn")


def _pdf_title_block(c, sheet, world, plan, layout, tf, generated_utc, world_sha, B):
    """Title block at the bottom of the panel; returns its top (pt)."""
    from reportlab.lib import colors
    from reportlab.lib.utils import simpleSplit
    col = colors.HexColor

    def mm(v):
        return v * PT_PER_MM
    px0, py0, px1, py1 = layout["panel"]
    left = mm(px0 + 6)
    right = mm(px1 - 6)
    width = right - left
    LH = B * 1.3
    rev = world["revision"]
    floor_meta = floor_of(world, plan["floor"])
    fields = [("Skala", f"{sheet['scale']} @ {sheet['size']} lanskap"),
              ("Revisi", f"{rev['id']}  ·  {rev['date']}"),
              ("Render", generated_utc.replace("T", " ").replace("Z", " UTC")),
              ("Satuan", "mm (dimensi), m² (luas)"),
              ("Digambar", DRAWN_BY),
              ("Diperiksa", CHECKED_BY),
              ("Sumber", f"world.json sha256 {world_sha[:16]}"),
              ("Generator", f"{GENERATOR} v{GENERATOR_VERSION}")]
    note = simpleSplit(font_source_note(tf.fonts), tf.regular, B, width)
    # Heights bottom-up: font note, fields, title, status band, brand line.
    h_note = len(note) * LH + 3
    h_fields = len(fields) * LH + 4
    h_title = B * 1.4 * 1.2 + LH + 4
    h_band = B * 1.15 * 1.6
    h_brand = 17 * 1.3 + 4
    tb_top = mm(py0) + 6 + h_note + h_fields + h_title + h_band + h_brand
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(0.9)
    c.line(mm(px0), tb_top, mm(px1), tb_top)
    yy = tb_top - 17 - 3
    c.setFillColor(col(GREEN))
    c.setFont(tf.bold, 17)
    c.drawString(left, yy, "kantor-rpg")
    c.setFont(tf.regular, B)
    c.setFillColor(col(INK))
    c.drawString(left + tf.width("kantor-rpg", tf.bold, 17) + 8, yy + 1,
                 f"Proyek kantor-rpg  ·  gedung {world['building']['id']}")
    yy -= 8 + h_band
    c.setFillColor(col(GREEN))
    c.rect(left, yy, width, h_band, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont(tf.bold, B * 1.15)
    c.drawString(left + 6, yy + h_band / 2 - B * 0.4, f"STATUS {STATUS}")
    c.setFont(tf.medium, B)
    c.drawRightString(right - 6, yy + h_band / 2 - B * 0.4, "Bukan untuk konstruksi")
    yy -= B * 1.4 + 4
    c.setFillColor(col(GREEN))
    c.setFont(tf.bold, B * 1.4)
    c.drawString(left, yy, sheet["title"])
    c.setFillColor(col(INK))
    c.setFont(tf.regular, B)
    yy -= LH
    c.drawString(left, yy, f"{floor_meta['id']}: {floor_meta['name']}")
    yy -= 4
    label_w = max(tf.width(k, tf.medium, B) for k, _ in fields) + 6
    c.setStrokeColor(col(GRID))
    c.setLineWidth(0.3)
    box_w = mm(36)
    fields_top = yy
    for k, v in fields:
        yy -= LH
        c.setFillColor(col(GREY_TEXT))
        c.setFont(tf.medium, B)
        c.drawString(left, yy + B * 0.25, k)
        c.setFillColor(col(INK))
        c.setFont(tf.regular, B)
        c.drawString(left + label_w, yy + B * 0.25, v)
    # Sheet number block beside the fields.
    bx0 = right - box_w
    c.setStrokeColor(col(GREEN))
    c.setLineWidth(0.9)
    c.rect(bx0, yy, box_w, fields_top - yy, stroke=1, fill=0)
    c.setFillColor(col(GREY_TEXT))
    c.setFont(tf.medium, B)
    c.drawString(bx0 + 4, fields_top - B - 2, "Nomor lembar")
    c.setFillColor(col(GREEN))
    c.setFont(tf.bold, 26)
    c.drawCentredString(bx0 + box_w / 2, (yy + fields_top) / 2 - 8, sheet["id"])
    c.setFillColor(col(INK))
    c.setFont(tf.medium, B)
    c.drawCentredString(bx0 + box_w / 2, yy + 4, f"Rev {rev['id']}")
    yy -= 3
    c.setFillColor(col(GREY_TEXT))
    c.setFont(tf.regular, B)
    for ln in note:
        yy -= LH
        c.drawString(left, yy + B * 0.25, ln)
    return tb_top
