"""Shared constants, palette, helpers and DXF setup for the kantor-rpg sheet generators."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

from tools.kantor.fonts import register  # noqa: E402
from tools.kantor.geometry import polygon_edges  # noqa: E402

GENERATOR = "cad/generate.py"
GENERATOR_VERSION = "1"
SHEETS_PATH = ROOT / "design" / "sheets.json"
WORLD_PATH = ROOT / "design" / "world.json"
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
        style = doc.styles.add("KR-SANS", font="DejaVuSans.ttf")
        # DejaVu is much wider than the PDF's Alegreya-based face; a width
        # factor keeps table text inside the column widths laid out for the PDF.
        style.dxf.width = 0.8
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
