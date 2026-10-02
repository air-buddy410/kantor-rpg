"""Register a TrueType derivative of Alegreya Sans (SIL OFL 1.1) for ReportLab.

ReportLab cannot read CFF-flavoured OTF, so the Debian package fonts are
converted to TrueType outlines into .cache/fonts at build time, with digits
remapped to lining figures (drawing dimensions read badly in old-style
figures). Both changes make it a Modified Version under the OFL, so the
family is renamed "KantorRPG Sans" (Reserved Font Name rule) and keeps the
OFL and attribution. The converted files are build intermediates and are not
committed; PDFs embed subsets only.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache" / "fonts"
SYSTEM_DIR = Path("/usr/share/fonts/opentype/alegreya-sans")
WEIGHTS = {"KR-Sans": "AlegreyaSans-Regular", "KR-Sans-Medium": "AlegreyaSans-Medium",
           "KR-Sans-Bold": "AlegreyaSans-Bold", "KR-Sans-Italic": "AlegreyaSans-Italic"}
FAMILY = "KantorRPG Sans"
DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
CONVERTER_VERSION = "2"
_registered = None


def _otf_to_ttf(src: Path, dst: Path) -> None:
    from fontTools.ttLib import TTFont, newTable
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    font = TTFont(str(src))
    glyph_order = font.getGlyphOrder()
    glyf = newTable("glyf")
    glyf.glyphOrder = glyph_order
    glyf.glyphs = {}
    gs = font.getGlyphSet()
    for name in glyph_order:
        pen = TTGlyphPen(gs)
        gs[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
        glyf[name] = pen.glyph()
    font["glyf"] = glyf
    font["loca"] = newTable("loca")
    maxp = font["maxp"]
    maxp.tableVersion = 0x00010000
    for attr in ("maxZones", "maxTwilightPoints", "maxStorage", "maxFunctionDefs", "maxInstructionDefs",
                 "maxStackElements", "maxSizeOfInstructions", "maxComponentElements"):
        setattr(maxp, attr, 0)
    maxp.maxZones = 1
    font["head"].glyphDataFormat = 0
    font["post"].formatType = 2.0
    font["post"].extraNames = []
    font["post"].mapping = {}
    font["post"].glyphOrder = glyph_order
    for tag in ("CFF ", "VORG"):
        if tag in font:
            del font[tag]
    font.sfntVersion = "\x00\x01\x00\x00"
    names = set(glyph_order)
    for table in font["cmap"].tables:
        if not table.isUnicode():
            continue
        for i, d in enumerate(DIGITS):
            if f"{d}.lf" in names and (0x30 + i) in table.cmap:
                table.cmap[0x30 + i] = f"{d}.lf"
    style = src.stem.split("-")[-1]
    ps = f"KantorRPGSans-{style}"
    note = ("Derived from Alegreya Sans (c) 2013 Juan Pablo del Peral, Huerta Tipografica. "
            "Converted to TrueType with lining figures by kantor-rpg tools. SIL Open Font License 1.1.")
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in (1, 3, 4, 6, 16, 17, 21, 22):
            name.removeNames(nameID=rec.nameID)
    name.setName(FAMILY, 1, 3, 1, 0x409)
    name.setName(f"{ps};kantor-rpg;{CONVERTER_VERSION}", 3, 3, 1, 0x409)
    name.setName(f"{FAMILY} {style}", 4, 3, 1, 0x409)
    name.setName(ps, 6, 3, 1, 0x409)
    name.setName(note, 5, 3, 1, 0x409)
    dst.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(dst))


def register() -> dict:
    """Return {alias: font name}; falls back to Helvetica when the font is missing."""
    global _registered
    if _registered is not None:
        return _registered
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont as RLTTFont

    names = {}
    for alias, base in WEIGHTS.items():
        src = SYSTEM_DIR / f"{base}.otf"
        dst = CACHE / f"KantorRPGSans-{base.split('-')[-1]}-v{CONVERTER_VERSION}.ttf"
        if not dst.exists() and src.exists():
            _otf_to_ttf(src, dst)
        if dst.exists():
            pdfmetrics.registerFont(RLTTFont(alias, str(dst)))
            names[alias] = alias
        else:
            names[alias] = "Helvetica-Bold" if "Bold" in alias else "Helvetica"
    _registered = names
    return names


def font_source_note(names: dict) -> str:
    if names.get("KR-Sans") == "KR-Sans":
        return ("Huruf: KantorRPG Sans, turunan Alegreya Sans karya Juan Pablo del Peral (SIL OFL 1.1, "
                "paket Debian fonts-alegreya-sans), subset tertanam.")
    return "Huruf: Helvetica fallback (Alegreya Sans tidak tersedia saat build)."
