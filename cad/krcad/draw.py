"""Generic sheet model shared by every non-plan sheet.

A sheet is a list of pages. Each page holds paper primitives (paper mm) and
views; a view holds primitives in world metres plus a scale and a paper
placement. The DXF backend writes view primitives to model space in mm with
one paper-space viewport per view, and paper primitives to the page's layout.
The PDF backend draws the very same objects, so the two outputs cannot drift.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

from tools.kantor.fonts import font_source_note

from krcad.common import *  # noqa: F401,F403
from krcad.common import _setup_dxf, _xdata

FONT_KEYS = ("R", "M", "B")
CAP = 0.7  # cap height / em, used to convert PDF point sizes to DXF text height

# Smallest font size on the sheet being built (pt). Every text helper raises a
# requested size to this floor, so tables, paragraphs and labels reflow at a
# size that prints >= 2,5 mm on A3 (common.legible_pt). SheetDoc sets it; the
# builders run one sheet at a time, so a module value is enough.
_FLOOR = 0.0


def set_text_floor(pt: float) -> None:
    global _FLOOR
    _FLOOR = pt


def text_floor() -> float:
    return _FLOOR


def fs(size: float, rel: float = 1.0) -> float:
    """Requested size raised to the sheet floor (x rel, for headings above body text)."""
    return max(size, _FLOOR * rel)


@dataclass
class Style:
    stroke: str | None = INK
    fill: str | None = None
    width: float = 0.4  # pt
    dash: tuple | None = None
    alpha: float = 1.0


@dataclass
class Prim:
    kind: str  # poly | circle | arc | text | block
    data: dict
    layer: str = "A-ANNO-NOTE"
    style: Style = field(default_factory=Style)
    xd: tuple | None = None  # (kind, id, {extra})
    only: str | None = None  # "pdf" or "dxf"
    z: int = 1  # paper prims: 0 = under views, 1 = over


class Layer:
    """Primitive collector with helpers; used for paper space and views."""

    def __init__(self):
        self.prims: list[Prim] = []

    def add(self, prim):
        self.prims.append(prim)
        return prim

    def poly(self, pts, layer, closed=False, stroke=INK, fill=None, width=0.4, dash=None, alpha=1.0, xd=None,
             only=None, z=1):
        return self.add(Prim("poly", {"pts": [tuple(p) for p in pts], "closed": closed}, layer,
                             Style(stroke, fill, width, dash, alpha), xd, only, z))

    def line(self, a, b, layer, **kw):
        return self.poly([a, b], layer, **kw)

    def rect(self, x0, y0, x1, y1, layer, **kw):
        return self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], layer, closed=True, **kw)

    def circle(self, c, r, layer, stroke=INK, fill=None, width=0.4, xd=None, only=None, z=1, dash=None):
        return self.add(Prim("circle", {"c": tuple(c), "r": r}, layer, Style(stroke, fill, width, dash), xd, only, z))

    def arc(self, c, r, a0, a1, layer, stroke=INK, width=0.4, xd=None, only=None):
        return self.add(Prim("arc", {"c": tuple(c), "r": r, "a0": a0, "a1": a1}, layer, Style(stroke, None, width),
                             xd, only))

    def text(self, pos, text, layer, size=7.0, font="R", color=INK, align="l", rot=0.0, knock=False, xd=None,
             only=None, z=1, alpha=1.0, floor=True):
        # floor=False only for the diagonal watermark, which is background.
        size = fs(size) if floor else size
        return self.add(Prim("text", {"pos": tuple(pos), "text": str(text), "size": size, "font": font,
                                      "align": align, "rot": rot, "knock": knock}, layer,
                             Style(None, color, 0, None, alpha), xd, only, z))


class View(Layer):
    def __init__(self, name, den, origin_mm, clip_mm, model_offset_m=(0.0, 0.0), frozen=()):
        super().__init__()
        self.name = name
        self.den = den
        self.origin = origin_mm
        self.clip = clip_mm  # (x0, y0, x1, y1) paper mm
        self.offset = model_offset_m
        self.frozen = list(frozen)

    def paper(self, p):
        """World metres (view local) -> paper mm."""
        return (self.origin[0] + p[0] * 1000.0 / self.den, self.origin[1] + p[1] * 1000.0 / self.den)

    def m_per_mm(self):
        return self.den / 1000.0


class Page(Layer):
    def __init__(self, size_mm, label=""):
        super().__init__()
        self.size = size_mm
        self.views: list[View] = []
        self.label = label
        self.title_attrs: dict | None = None
        self.title_pos = (0.0, 0.0)

    def view(self, *a, **kw):
        v = View(*a, **kw)
        self.views.append(v)
        return v


class SheetDoc:
    def __init__(self, sheet, world, meta):
        self.sheet = sheet
        self.world = world
        self.meta = meta  # header custom vars + title block attributes
        self.pages: list[Page] = []
        self.summary: dict = {}  # sheet-specific facts for logs/tests
        set_text_floor(legible_pt(sheet["size"]))
        self.body = text_floor()

    def new_page(self, label=""):
        w, h = PAPER_MM[self.sheet["size"]]
        p = Page((w, h), label)
        self.pages.append(p)
        return p


# ------------------------------------------------------------------ fonts / text metrics

_TF = None


def tf():
    global _TF
    if _TF is None:
        _TF = TagFonts()
    return _TF


def font_name(key):
    t = tf()
    return {"R": t.regular, "M": t.medium, "B": t.bold}[key]


def text_w_mm(text, size, font="R"):
    return tf().width(str(text), font_name(font), fs(size)) / PT_PER_MM


def wrap(text, size, width_mm, font="R"):
    from reportlab.lib.utils import simpleSplit
    return simpleSplit(str(text), font_name(font), fs(size), width_mm * PT_PER_MM) or [""]


# ------------------------------------------------------------------ tables

@dataclass
class Col:
    head: str
    width: float  # mm
    align: str = "l"
    font: str = "R"


def table_rows_height(cols, rows, size, lead, pad=1.4):
    size = fs(size)
    hs = []
    for row in rows:
        n = max(len(wrap(cell, size, c.width - 2, c.font)) for cell, c in zip(row, cols))
        hs.append(n * size * lead / PT_PER_MM + pad)
    return hs


def draw_table(page, x, y_top, cols, rows, size=6.6, lead=1.2, layer="A-ANNO-SCHD", max_h=None, zebra=True,
               head_size=None, row_xd=None, pad=1.4):
    """Draw a table from y_top downwards; returns (rows drawn, bottom y).

    Stops before a row would cross y_top - max_h so callers can paginate.
    pad = vertical cell padding (mm) added to each row's text height."""
    size = fs(size)
    head_size = fs(head_size or size)
    width = sum(c.width for c in cols)
    hh = head_size * lead / PT_PER_MM + 2.0
    page.rect(x, y_top - hh, x + width, y_top, layer, stroke=None, fill="#dfe9e3")
    cx = x
    for c in cols:
        tx = cx + 1 if c.align == "l" else cx + c.width - 1 if c.align == "r" else cx + c.width / 2
        page.text((tx, y_top - hh + 0.75), c.head, layer, size=head_size, font="B", color=GREEN, align=c.align)
        cx += c.width
    y = y_top - hh
    heights = table_rows_height(cols, rows, size, lead, pad)
    drawn = 0
    for i, (row, h) in enumerate(zip(rows, heights)):
        if max_h is not None and (y_top - (y - h)) > max_h:
            break
        if zebra and i % 2 == 1:
            page.rect(x, y - h, x + width, y, layer, stroke=None, fill="#f1f5f2")
        cx = x
        for cell, c in zip(row, cols):
            lines = wrap(cell, size, c.width - 2, c.font)
            for j, ln in enumerate(lines):
                tx = cx + 1 if c.align == "l" else cx + c.width - 1 if c.align == "r" else cx + c.width / 2
                page.text((tx, y - (j + 1) * size * lead / PT_PER_MM + 0.15), ln, layer, size=size, font=c.font,
                          color=GREEN if c.font == "B" else INK, align=c.align,
                          xd=row_xd(row) if (row_xd and j == 0 and c is cols[0]) else None)
            cx += c.width
        y -= h
        page.line((x, y), (x + width, y), layer, stroke="#c9d6cf", width=0.25)
        drawn += 1
    page.line((x, y_top), (x + width, y_top), layer, stroke=GREEN, width=0.6)
    page.line((x, y), (x + width, y), layer, stroke=GREEN, width=0.6)
    return drawn, y


# ------------------------------------------------------------------ frame, title block, watermark

TB_W = 175.0


def _tb_lines(sheet, world, page_no, page_count, generated_utc, world_sha, tb_w):
    """Title block content and its height, from the sheet's body size."""
    b = fs(0)
    rev = world["revision"]
    lh = b * 1.3 / PT_PER_MM  # field row pitch, mm
    title_pt = max(11.0, b * 1.3)
    titles = wrap(sheet["title"], title_pt, tb_w - 6, "B")[:2]
    fields = [("Skala", f"{sheet['scale']} @ {sheet['size']} lanskap"), ("Revisi", f"{rev['id']} · {rev['date']}"),
              ("Render", generated_utc.replace("T", " ").replace("Z", " UTC")),
              ("Halaman", f"{page_no}/{page_count}"), ("Digambar", DRAWN_BY), ("Diperiksa", CHECKED_BY),
              ("Sumber", f"world.json sha256 {world_sha[:16]}")]
    note = wrap(font_source_note(tf().fonts), b, tb_w - 6)
    band = b * 1.15 * 1.55 / PT_PER_MM
    brand = max(13.0, b * 1.45)
    h = (band + 1.5 + brand * 1.15 / PT_PER_MM + 1.0 + len(titles) * title_pt * 1.15 / PT_PER_MM + 1.0
         + len(fields) * lh + 1.0 + len(note) * lh + 2.0)
    return {"b": b, "lh": lh, "title_pt": title_pt, "titles": titles, "fields": fields, "note": note, "band": band,
            "brand": brand, "h": h}


def frame_and_title(doc: SheetDoc, page: Page, page_no: int, page_count: int, generated_utc: str, world_sha: str,
                    tb_origin=None, tb_w=TB_W):
    """Border, title block (bottom right), watermark. Returns usable content rect (paper mm).

    The title block grows with the sheet's body size, so callers place their
    content against the returned title block rect, never a fixed height."""
    sheet, world = doc.sheet, doc.world
    W, H = page.size
    fx0, fy0, fx1, fy1 = 20.0, 10.0, W - 10.0, H - 10.0
    page.rect(fx0, fy0, fx1, fy1, "A-ANNO-TTLB", stroke=GREEN, width=1.2)
    page.rect(4, 4, W - 4, H - 4, "A-ANNO-TTLB", stroke=GREEN, width=0.4, only="pdf")
    t = _tb_lines(sheet, world, page_no, page_count, generated_utc, world_sha, tb_w)
    b, lh = t["b"], t["lh"]
    tx0 = tb_origin[0] if tb_origin else fx1 - tb_w
    ty0 = tb_origin[1] if tb_origin else fy0
    tx1, ty1 = tx0 + tb_w, ty0 + t["h"]
    lay = "A-ANNO-TTLB"
    page.rect(tx0, ty0, tx1, ty1, lay, stroke=GREEN, width=0.9, fill="#ffffff")
    rev = world["revision"]
    # Status band: white on deep green.
    y = ty1 - t["band"]
    page.rect(tx0, y, tx1, ty1, lay, stroke=None, fill=GREEN, only="pdf")
    base = y + (t["band"] - b * 1.15 * 0.7 / PT_PER_MM) / 2
    page.text((tx0 + 3, base), f"STATUS {STATUS}", lay, size=b * 1.15, font="B", color="#ffffff", only="pdf")
    page.text((tx1 - 3, base), "Bukan untuk konstruksi", lay, size=b, font="M", color="#ffffff", align="r",
              only="pdf")
    y -= 1.5 + t["brand"] * 0.95 / PT_PER_MM
    page.text((tx0 + 3, y), "kantor-rpg", lay, size=t["brand"], font="B", color=GREEN, only="pdf")
    page.text((tx0 + 3 + text_w_mm("kantor-rpg", t["brand"], "B") + 3, y),
              f"Proyek kantor-rpg · gedung {world['building']['id']}", lay, size=b, color=INK, only="pdf")
    y -= t["brand"] * 0.2 / PT_PER_MM + 1.0
    for ln in t["titles"]:
        y -= t["title_pt"] * 1.15 / PT_PER_MM
        page.text((tx0 + 3, y + t["title_pt"] * 0.2 / PT_PER_MM), ln, lay, size=t["title_pt"], font="B",
                  color=GREEN, only="pdf")
    y -= 1.0
    label_w = max(text_w_mm(k, b, "M") for k, _ in t["fields"]) + 2.0
    fields_top = y
    for k, v in t["fields"]:
        y -= lh
        page.text((tx0 + 3, y + 0.25 * lh), k, lay, size=b, font="M", color=GREY_TEXT, only="pdf")
        page.text((tx0 + 3 + label_w, y + 0.25 * lh), v, lay, size=b, color=INK, only="pdf")
    # Sheet number box beside the fields.
    bw = 40.0
    big = max(20.0, b * 2.2) if len(sheet["id"]) <= 5 else max(16.0, b * 1.9)
    page.rect(tx1 - bw - 3, y, tx1 - 3, fields_top, lay, stroke=GREEN, width=0.8, only="pdf")
    page.text((tx1 - bw, fields_top - lh * 0.85), "Nomor lembar", lay, size=b, font="M", color=GREY_TEXT,
              only="pdf")
    mid = (y + fields_top) / 2
    page.text((tx1 - 3 - bw / 2, mid - big * 0.3 / PT_PER_MM), sheet["id"], lay, size=big, font="B", color=GREEN,
              align="c", only="pdf")
    page.text((tx1 - 3 - bw / 2, y + lh * 0.35), f"Rev {rev['id']} · {page_no}/{page_count}", lay, size=b,
              font="M", color=INK, align="c", only="pdf")
    y -= 1.0
    for ln in t["note"]:
        y -= lh
        page.text((tx0 + 3, y + 0.25 * lh), ln, lay, size=b, color=GREY_TEXT, only="pdf")
    page.title_attrs = dict(doc.meta, KR_PAGE=f"{page_no}/{page_count}")
    page.title_pos = (tx0, ty0)
    # Watermark under everything.
    page.text(((fx0 + fx1) / 2, (fy0 + fy1) / 2), "KONSEP - BUKAN UNTUK KONSTRUKSI", "A-ANNO-WMRK",
              size=56 if W > 500 else 44, font="B", color=GREEN, align="c",
              rot=math.degrees(math.atan2(fy1 - fy0, fx1 - fx0)), z=0, alpha=0.05, floor=False)
    return (fx0, fy0, fx1, fy1), (tx0, ty0, tx1, ty1)


def heading(page, x, y, text, width, size=8.5, layer="A-ANNO-NOTE"):
    size = fs(size, 1.1)
    page.text((x, y - size / PT_PER_MM), text, layer, size=size, font="B", color=GREEN)
    yl = y - size / PT_PER_MM - 1.4
    page.line((x, yl), (x + width, yl), layer, stroke=GREEN, width=0.4)
    return yl - 1.6


def paragraph(page, x, y, text, width, size=6.6, font="R", color=INK, layer="A-ANNO-NOTE", lead=1.25, bullet=False):
    size = fs(size)
    lines = wrap(text, size, width - (3 if bullet else 0), font)
    dy = size * lead / PT_PER_MM
    for j, ln in enumerate(lines):
        if bullet and j == 0:
            page.circle((x + 0.8, y - dy * 0.62), 0.38, layer, stroke=None, fill=color)
        page.text((x + (3 if bullet else 0), y - dy * (j + 1) + 0.4), ln, layer, size=size, font=font, color=color)
    return y - dy * len(lines) - 0.8


def scale_bar(page, x, y, den, marks, layer="A-ANNO-TTLB", label=None):
    sb = scale_bar_geometry(den, (x, y), marks)
    for i, (a, b) in enumerate(zip(sb["x_mm"], sb["x_mm"][1:])):
        page.rect(a, y, b, y + 1.8, layer, stroke=GREEN, width=0.4, fill=GREEN if i % 2 == 0 else "#ffffff")
    for m, xx in zip(sb["marks_m"], sb["x_mm"]):
        page.text((xx, y + 2.2 + fs(6) * 0.15 / PT_PER_MM * 2), fmt_m(m), layer, size=6, font="M", align="c")
    page.text((sb["x_mm"][-1] + 2.5, y + 0.2), label or f"m  (1:{den})", layer, size=6)
    return sb


def north_arrow(page, x, y, r=6.0, layer="A-ANNO-TTLB"):
    page.circle((x, y), r, layer, stroke=GREEN, width=0.7)
    page.poly([(x, y + r), (x - r * 0.4, y - r * 0.6), (x, y - r * 0.33)], layer, closed=True, stroke=None, fill=GREEN)
    page.poly([(x, y + r), (x + r * 0.4, y - r * 0.6), (x, y - r * 0.33)], layer, closed=True, stroke=GREEN,
              fill="#ffffff", width=0.4)
    page.text((x, y + r + 1.2), "U", layer, size=9, font="B", color=GREEN, align="c")


# ------------------------------------------------------------------ label placement

class LabelPlacer:
    """Greedy collision-avoiding label placement in a view's world metres."""

    def __init__(self, view: View, obstacles=()):
        self.view = view
        self.boxes = list(obstacles)

    def place(self, anchor, text, size, font="M", gap=0.15, prefer=None, extra_cands=()):
        mpm = self.view.m_per_mm()
        w = text_w_mm(text, size, font) * mpm + 0.08
        h = fs(size) / PT_PER_MM * mpm * 1.05
        return self.place_box(anchor, w, h, gap, prefer, extra_cands)

    def place_box(self, anchor, w, h, gap=0.15, prefer=None, extra_cands=()):
        """Same candidate search for a box of w x h world metres."""
        ax, ay = anchor
        cands = list(extra_cands) + [
            (ax + gap, ay - h / 2), (ax - gap - w, ay - h / 2), (ax - w / 2, ay + gap), (ax - w / 2, ay - gap - h),
            (ax + gap, ay + gap), (ax - gap - w, ay + gap), (ax + gap, ay - gap - h), (ax - gap - w, ay - gap - h),
            (ax + 2.5 * gap, ay - h / 2), (ax - 2.5 * gap - w, ay - h / 2), (ax - w / 2, ay + 3 * gap),
            (ax - w / 2, ay - 3 * gap - h)]
        if prefer is not None:
            cands = [cands[prefer]] + cands
        best = None
        for i, (x0, y0) in enumerate(cands):
            box = (x0, y0, x0 + w, y0 + h)
            hit = sum(rect_overlap(box, b) for b in self.boxes)
            cost = hit * 100 + i * 0.002
            if best is None or cost < best[0]:
                best = (cost, box, hit)
        self.boxes.append(best[1])
        return best[1], best[2]


def window_tag_size_m(view: View, text, size):
    """(width, height) in view metres of a hexagon window tag (common.window_tag_shape)."""
    _, hw, hh = window_tag_shape(tf().width(text, font_name("M"), size), size)
    k = view.m_per_mm() / PT_PER_MM
    return 2 * hw * k, 2 * hh * k


def window_tag(view: View, centre, text, size, layer, xd=None, rot=0.0, stroke=GREEN):
    """Hexagon tag with the short window tag text centred in it (view metres)."""
    pts, _, _ = window_tag_shape(tf().width(text, font_name("M"), size), size)
    k = view.m_per_mm() / PT_PER_MM
    r = math.radians(rot)
    c, s = math.cos(r), math.sin(r)
    x0, y0 = centre
    view.poly([(x0 + (px * c - py * s) * k, y0 + (px * s + py * c) * k) for px, py in pts], layer, closed=True,
              stroke=stroke, fill="#ffffff", width=0.45, xd=xd)
    off = size * 0.35 * k  # baseline 0,35 em below centre centres the cap height
    view.text((x0 + off * s, y0 - off * c), text, layer, size=size, font="M", color=INK, align="c", rot=rot, xd=xd)


# ------------------------------------------------------------------ DXF backend

def _ensure_layer(doc, name):
    if name not in doc.layers:
        doc.layers.add(name, color=7)


def _dxf_entity(space, prim: Prim, T, height_scale, doc):
    """Write one primitive. T maps coordinates; height_scale maps pt -> drawing units."""
    import ezdxf
    att = {"layer": prim.layer}
    st = prim.style
    out = []
    if prim.kind == "poly":
        pts = [T(p) for p in prim.data["pts"]]
        if st.fill and prim.data["closed"] and len(pts) >= 3:
            h = space.add_hatch(dxfattribs=att)
            h.set_solid_fill(color=7, rgb=hex_rgb(st.fill))
            h.paths.add_polyline_path(pts, is_closed=True)
            out.append(h)
        if st.stroke:
            e = space.add_lwpolyline(pts, close=prim.data["closed"], dxfattribs=dict(att))
            e.rgb = hex_rgb(st.stroke)
            if st.dash:
                e.dxf.linetype = "DASHED"
                e.dxf.ltscale = max(0.1, height_scale * 0.5)
            out.append(e)
    elif prim.kind == "circle":
        c = T(prim.data["c"])
        r = prim.data["r"] * T.scale
        if st.fill:
            h = space.add_hatch(dxfattribs=att)
            h.set_solid_fill(color=7, rgb=hex_rgb(st.fill))
            h.paths.add_edge_path().add_arc(c, r, 0, 360)
            out.append(h)
        if st.stroke:
            e = space.add_circle(c, r, dxfattribs=dict(att))
            e.rgb = hex_rgb(st.stroke)
            out.append(e)
    elif prim.kind == "arc":
        e = space.add_arc(T(prim.data["c"]), prim.data["r"] * T.scale, prim.data["a0"], prim.data["a1"],
                          dxfattribs=dict(att))
        e.rgb = hex_rgb(st.stroke or INK)
        out.append(e)
    elif prim.kind == "text":
        d = prim.data
        e = space.add_text(d["text"], height=d["size"] * CAP * height_scale,
                           rotation=d["rot"], dxfattribs={**att, "style": "KR-SANS", "width": 0.8})
        align = {"l": ezdxf.enums.TextEntityAlignment.LEFT, "c": ezdxf.enums.TextEntityAlignment.CENTER,
                 "r": ezdxf.enums.TextEntityAlignment.RIGHT}[d["align"]]
        e.set_placement(T(d["pos"]), align=align)
        if st.fill:
            rgb = hex_rgb(st.fill)
            if st.alpha < 1:
                # DXF has no text transparency; blend toward paper white instead.
                rgb = tuple(round(c * st.alpha * 3 + 255 * (1 - st.alpha * 3)) for c in rgb)
            e.rgb = rgb
        out.append(e)
    if prim.xd:
        kind, ident = prim.xd[0], prim.xd[1]
        extra = prim.xd[2] if len(prim.xd) > 2 else {}
        for e in out:
            _xdata(e, kind, ident, **extra)
    return out


class _T:
    def __init__(self, fn, scale):
        self.fn = fn
        self.scale = scale

    def __call__(self, p):
        return self.fn(p)


def _title_block_def(doc):
    name = "KR-TTLB-G"
    if name in doc.blocks:
        return name
    blk = doc.blocks.new(name)
    tags = ["KR_SHEET_ID", "KR_TITLE", "KR_FLOOR", "KR_SCALE", "KR_REVISION", "KR_REV_DATE", "KR_RENDER_UTC",
            "KR_STATUS", "KR_NOTE", "KR_DRAWN", "KR_CHECK", "KR_PAGE", "KR_WORLD_SHA256"]
    for i, tag in enumerate(tags):
        col, row = i // 7, i % 7
        h = 4.0 if tag == "KR_SHEET_ID" else 1.3 if tag == "KR_WORLD_SHA256" else 2.0
        blk.add_attdef(tag, insert=(3 + col * 85, 50.0 - 7 - row * 6.2), height=h,
                       dxfattribs={"layer": "A-ANNO-TTLB", "style": "KR-SANS"})
    blk.add_lwpolyline([(0, 0), (TB_W, 0), (TB_W, 50.0), (0, 50.0)], close=True, dxfattribs={"layer": "A-ANNO-TTLB"})
    return name


def write_dxf_doc(sd: SheetDoc, path: Path):
    import ezdxf
    doc = ezdxf.new("R2018", setup=True)
    _setup_dxf(doc)
    for key, val in sd.meta.items():
        doc.header.custom_vars.append(key, str(val))
    msp = doc.modelspace()
    layers_used = {p.layer for pg in sd.pages for p in pg.prims} | {p.layer for pg in sd.pages for v in pg.views
                                                                    for p in v.prims}
    for name in sorted(layers_used):
        _ensure_layer(doc, name)
    _ensure_layer(doc, "A-ANNO-VPRT")
    tb = _title_block_def(doc)
    n = len(sd.pages)
    for i, page in enumerate(sd.pages):
        name = sd.sheet["id"] if n == 1 else f"{sd.sheet['id']}-{i + 1}"
        if i == 0 and "Layout1" in doc.layouts:
            doc.layouts.rename("Layout1", name)
            ps = doc.layouts.get(name)
        else:
            ps = doc.layouts.new(name)
        ps.page_setup(size=page.size, margins=(0, 0, 0, 0), units="mm", offset=(0, 0), rotation=0, scale=1)
        T = _T(lambda p: (p[0], p[1]), 1.0)
        for prim in page.prims:
            if prim.only != "pdf":
                _dxf_entity(ps, prim, T, 1.0 / PT_PER_MM, doc)
        for v in page.views:
            ox, oy = v.offset

            def mT(p, ox=ox, oy=oy):
                return ((p[0] + ox) * 1000.0, (p[1] + oy) * 1000.0)
            Tm = _T(mT, 1000.0)
            for prim in v.prims:
                if prim.only != "pdf":
                    _dxf_entity(msp, prim, Tm, v.den / PT_PER_MM, doc)
            cx0, cy0, cx1, cy1 = v.clip
            pc = ((cx0 + cx1) / 2, (cy0 + cy1) / 2)
            view_c = ((pc[0] - v.origin[0]) * v.den + ox * 1000.0, (pc[1] - v.origin[1]) * v.den + oy * 1000.0)
            vp = ps.add_viewport(center=pc, size=(cx1 - cx0, cy1 - cy0), view_center_point=view_c,
                                 view_height=(cy1 - cy0) * v.den, dxfattribs={"layer": "A-ANNO-VPRT"})
            if v.frozen:
                vp.frozen_layers = v.frozen
        if page.title_attrs is not None:
            ref = ps.add_blockref(tb, page.title_pos, dxfattribs={"layer": "A-ANNO-TTLB"})
            tags = {a.dxf.tag for a in doc.blocks[tb].attdefs()}
            ref.add_auto_attribs({k: str(v) for k, v in page.title_attrs.items() if k in tags})
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(path)


# ------------------------------------------------------------------ PDF backend

def _pdf_prim(c, prim: Prim, T, scale_len):
    from reportlab.lib import colors
    st = prim.style
    col = colors.HexColor
    if prim.kind == "text":
        d = prim.data
        x, y = T(d["pos"])
        fn = font_name(d["font"])
        c.saveState()
        c.translate(x, y)
        if d["rot"]:
            c.rotate(d["rot"])
        if d["knock"]:
            w = tf().width(d["text"], fn, d["size"])
            ox = 0 if d["align"] == "l" else -w / 2 if d["align"] == "c" else -w
            c.setFillColor(colors.white)
            c.rect(ox - 1, -d["size"] * 0.25, w + 2, d["size"] * 1.05, stroke=0, fill=1)
        c.setFillColor(col(st.fill or INK))
        if st.alpha < 1:
            c.setFillAlpha(st.alpha)
        c.setFont(fn, d["size"])
        if d["align"] == "l":
            c.drawString(0, 0, d["text"])
        elif d["align"] == "c":
            c.drawCentredString(0, 0, d["text"])
        else:
            c.drawRightString(0, 0, d["text"])
        c.restoreState()
        return
    c.saveState()
    if st.stroke:
        c.setStrokeColor(col(st.stroke))
        c.setLineWidth(st.width)
        if st.dash:
            c.setDash(list(st.dash))
    if st.fill:
        c.setFillColor(col(st.fill))
    if st.alpha < 1:
        c.setFillAlpha(st.alpha)
        c.setStrokeAlpha(st.alpha)
    if prim.kind == "poly":
        pts = [T(p) for p in prim.data["pts"]]
        pth = c.beginPath()
        pth.moveTo(*pts[0])
        for p in pts[1:]:
            pth.lineTo(*p)
        if prim.data["closed"]:
            pth.close()
        c.drawPath(pth, stroke=1 if st.stroke else 0, fill=1 if (st.fill and prim.data["closed"]) else 0)
    elif prim.kind == "circle":
        x, y = T(prim.data["c"])
        c.circle(x, y, prim.data["r"] * scale_len, stroke=1 if st.stroke else 0, fill=1 if st.fill else 0)
    elif prim.kind == "arc":
        x, y = T(prim.data["c"])
        r = prim.data["r"] * scale_len
        c.arc(x - r, y - r, x + r, y + r, prim.data["a0"], (prim.data["a1"] - prim.data["a0"]) % 360)
    c.restoreState()


def write_pdf_doc(sd: SheetDoc, path: Path):
    from reportlab.pdfgen import canvas
    t = tf()
    W, H = sd.pages[0].size
    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), pagesize=(W * PT_PER_MM, H * PT_PER_MM), pageCompression=1,
                      initialFontName=t.regular, initialFontSize=8)
    rev = sd.world["revision"]
    c.setTitle(f"{sd.sheet['id']} {sd.sheet['title']} ({rev['id']})")
    c.setAuthor(DRAWN_BY)
    c.setSubject(f"kantor-rpg {sd.sheet['id']} {STATUS}, bukan untuk konstruksi")
    c.setCreator(f"{GENERATOR} v{GENERATOR_VERSION} (ReportLab)")
    for page in sd.pages:
        c.setPageSize((page.size[0] * PT_PER_MM, page.size[1] * PT_PER_MM))

        def Tp(p):
            return (p[0] * PT_PER_MM, p[1] * PT_PER_MM)
        for prim in page.prims:
            if prim.z == 0 and prim.only != "dxf":
                _pdf_prim(c, prim, Tp, PT_PER_MM)
        for v in page.views:
            c.saveState()
            x0, y0, x1, y1 = v.clip
            pth = c.beginPath()
            pth.rect(x0 * PT_PER_MM, y0 * PT_PER_MM, (x1 - x0) * PT_PER_MM, (y1 - y0) * PT_PER_MM)
            c.clipPath(pth, stroke=0, fill=0)

            def Tv(p, v=v):
                q = v.paper(p)
                return (q[0] * PT_PER_MM, q[1] * PT_PER_MM)
            for prim in v.prims:
                if prim.only != "dxf":
                    _pdf_prim(c, prim, Tv, 1000.0 / v.den * PT_PER_MM)
            c.restoreState()
        for prim in page.prims:
            if prim.z != 0 and prim.only != "dxf":
                _pdf_prim(c, prim, Tp, PT_PER_MM)
        c.showPage()
    c.save()
    return {"page_pt": (W * PT_PER_MM, H * PT_PER_MM), "pages": len(sd.pages)}
