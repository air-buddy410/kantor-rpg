"""Original in-office artwork and a factual project poster (Kevin brief).

Outputs (all generated here, no third-party images or fonts beyond the OFL
KantorRPG Sans derivative):
- app/public/assets/signage/ART-xx.jpg: one poster per artwork id used by
  fixtures in design/world.json (geometric landscapes, seeded per id).
- drawings/pdf/kantor-rpg-poster.pdf + drawings/previews/kantor-rpg-poster.png:
  A3 project poster whose numbers are read from the dataset and derived
  files, with no performance or capability claims.

Usage: python3 tools/make_signage.py
"""
from __future__ import annotations

import hashlib
import json
import random
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.kantor.fonts import font_source_note, register  # noqa: E402

PALETTE = {
    "cream": (244, 236, 220), "paper": (255, 250, 240), "green": (31, 77, 58), "sage": (156, 177, 151),
    "leaf": (95, 143, 78), "wood": (184, 138, 93), "terracotta": (192, 100, 63), "mustard": (214, 166, 70),
    "blue": (111, 143, 166), "ink": (29, 42, 35),
}
SCHEMES = [
    ("green", "cream", "terracotta"), ("mustard", "green", "paper"), ("blue", "cream", "terracotta"),
    ("sage", "wood", "green"), ("terracotta", "paper", "leaf"), ("cream", "blue", "mustard"),
]
W, H = 360, 504  # 5:7 poster, small enough for the mobile transfer budget


def artwork(art_id: str) -> Image.Image:
    seed = int(hashlib.sha256(art_id.encode()).hexdigest()[:8], 16)
    rnd = random.Random(seed)
    sky, mid, accent = (PALETTE[c] for c in SCHEMES[seed % len(SCHEMES)])
    img = Image.new("RGB", (W, H), sky)
    d = ImageDraw.Draw(img)
    # Sun/disc, then layered rolling hills, then a little building row: a
    # recurring "office in the countryside" motif that ties the set together.
    r = rnd.randint(40, 70)
    cx, cy = rnd.randint(80, W - 80), rnd.randint(90, 180)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PALETTE["paper"] if sky != PALETTE["paper"] else accent)
    layers = [mid, accent, PALETTE["green"]]
    for i, col in enumerate(layers):
        base = 260 + i * 70
        pts = [(0, H)]
        amp = rnd.randint(20, 45)
        for x in range(0, W + 1, 12):
            y = base + amp * (0.5 + 0.5 * __import__("math").sin((x / W) * (2 + i) * 3.14159 + rnd.random() * 6))
            pts.append((x, y))
        pts.append((W, H))
        d.polygon(pts, fill=col)
    x = rnd.randint(30, 120)
    for k in range(rnd.randint(2, 4)):
        bw, bh = rnd.randint(36, 60), rnd.randint(40, 90)
        top = 400 - bh
        d.rounded_rectangle([x, top, x + bw, 400], radius=8, fill=PALETTE["paper"])
        for wy in range(top + 12, 392, 18):
            d.rectangle([x + 8, wy, x + bw - 8, wy + 6], fill=sky)
        x += bw + rnd.randint(8, 20)
    img = img.filter(ImageFilter.SMOOTH)
    d = ImageDraw.Draw(img)
    d.rectangle([0, H - 34, W, H], fill=PALETTE["paper"])
    d.text((14, H - 26), f"kantor-rpg  {art_id}", fill=PALETTE["ink"])
    return img


def poster_pdf(out_pdf: Path, out_png: Path) -> dict:
    from reportlab.lib.pagesizes import A3
    from reportlab.lib.colors import HexColor
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader

    fonts = register()
    world = json.loads((ROOT / "design" / "world.json").read_text(encoding="utf-8"))
    cap = json.loads((ROOT / "design" / "derived" / "capacity.json").read_text(encoding="utf-8"))
    ict = json.loads((ROOT / "design" / "derived" / "ict-portmap.json").read_text(encoding="utf-8"))
    reg = json.loads((ROOT / "drawings" / "register.json").read_text(encoding="utf-8"))
    produced = [s for s in reg.get("sheets", []) if s.get("status") == "produced"]
    facts = [
        ("2 lantai", f"{int(cap['gross_m2'])} m2 gross (proposal konsep)"),
        (f"{sum(1 for r in world['rooms'] if r['category'] != 'shaft')} ruang", "kerja di L1, rekreasi di L2"),
        (f"{len(world['fixtures'])} fixture", f"{len(world['activitySlots'])} slot aktivitas"),
        (f"{sum(1 for a in world['actors'] if a['kind'] == 'npc')} persona", "simulasi berlabel, bukan status kerja nyata"),
        (f"{ict['totals']['outlets']} outlet ICT", f"{ict['totals']['ports']} port, rancangan virtual"),
        (f"{len(produced)} lembar gambar", "DXF + PDF konsep; DWG native BLOCKED"),
    ]
    c = canvas.Canvas(str(out_pdf), pagesize=A3, initialFontName=fonts["KR-Sans"], initialFontSize=12)
    c.setTitle("kantor-rpg: poster proyek")
    c.setAuthor("kantor-rpg generator (Claude Code cloud)")
    w, h = A3
    c.setFillColor(HexColor("#f4ecdc"))
    c.rect(0, 0, w, h, fill=1, stroke=0)
    art = artwork("POSTER")
    c.drawImage(ImageReader(art), 60, h - 60 - 520, width=w - 120, height=520, preserveAspectRatio=False)
    c.setFillColor(HexColor("#1f4d3a"))
    c.setFont(fonts["KR-Sans-Bold"], 64)
    c.drawString(60, h - 640, "kantor-rpg")
    c.setFont(fonts["KR-Sans"], 22)
    c.setFillColor(HexColor("#1d2a23"))
    c.drawString(60, h - 680, "Kantor virtual dua lantai untuk dijelajahi sebagai CEO.")
    y = h - 740
    for big, small in facts:
        c.setFont(fonts["KR-Sans-Bold"], 26)
        c.setFillColor(HexColor("#1f4d3a"))
        c.drawString(60, y, big)
        c.setFont(fonts["KR-Sans"], 16)
        c.setFillColor(HexColor("#1d2a23"))
        c.drawString(300, y + 4, small)
        y -= 46
    c.setFillColor(HexColor("#9a4322"))
    c.setFont(fonts["KR-Sans-Bold"], 15)
    c.drawString(60, 110, "Status: eksperimen pribadi, demo simulasi offline. Bukan gambar konstruksi, bukan klaim performa.")
    c.setFillColor(HexColor("#4b5a51"))
    c.setFont(fonts["KR-Sans"], 11)
    c.drawString(60, 84, f"Angka dibaca dari design/world.json revisi {world['revision']['id']} dan file turunan saat generate. Artwork dibuat oleh tools/make_signage.py.")
    c.drawString(60, 68, font_source_note(fonts))
    c.showPage()
    c.save()
    subprocess.run(["pdftoppm", "-r", "30", "-png", "-singlefile", str(out_pdf), str(out_png.with_suffix(""))], check=True)
    return {"facts": facts}


def main() -> int:
    world = json.loads((ROOT / "design" / "world.json").read_text(encoding="utf-8"))
    ids = sorted({f["artwork"] for f in world["fixtures"] if f.get("artwork")})
    out = ROOT / "app" / "public" / "assets" / "signage"
    out.mkdir(parents=True, exist_ok=True)
    for art_id in ids:
        artwork(art_id).save(out / f"{art_id}.jpg", quality=82, optimize=True)
    pdf = ROOT / "drawings" / "pdf" / "kantor-rpg-poster.pdf"
    png = ROOT / "drawings" / "previews" / "kantor-rpg-poster.png"
    poster_pdf(pdf, png)
    total = sum((out / f"{i}.jpg").stat().st_size for i in ids)
    print(json.dumps({"artworks": len(ids), "bytes": total, "poster": str(pdf.relative_to(ROOT))}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
