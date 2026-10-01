"""I-101 finish plan: both floors at 1:200 on one A3, rooms filled by finish.floor."""
from __future__ import annotations

from krcad.common import *  # noqa: F401,F403
from krcad.draw import Col, SheetDoc, draw_table, frame_and_title, heading, paragraph, scale_bar, north_arrow
from krcad.plan_prims import plan_base, room_id_labels
from krcad.planmodel import build_plan
from krcad.sheets_a import make_meta, view_title

# Light fills so ink text stays above 4.5:1; contrast is computed, not assumed.
FINISH_FILLS = ["#e8d5b9", "#cfe0d6", "#d6e3ea", "#f4f4f2", "#dcdcd2", "#e6dcef", "#e3e9c9", "#f0cfc4", "#d9c3a5",
                "#f3e3c3"]


def finish_palette(world):
    counts = {}
    for r in world["rooms"]:
        counts[r["finish"]["floor"]] = counts.get(r["finish"]["floor"], 0) + 1
    keys = sorted(counts, key=lambda k: (-counts[k], k))
    if len(keys) > len(FINISH_FILLS):
        raise ValueError("more floor finishes than fills; extend FINISH_FILLS")
    pal = {k: FINISH_FILLS[i] for i, k in enumerate(keys)}
    for k, c in pal.items():
        for txt in (INK, GREEN):
            ratio = contrast_ratio(txt, c)
            if ratio < 4.5:
                raise ValueError(f"finish fill {c} for '{k}' gives {ratio:.2f}:1 with {txt}")
    return pal, counts


def build_finish(sheet, ctx):
    world = ctx["world"]
    den = int(sheet["scale"].split(":")[1])
    sd = SheetDoc(sheet, world, make_meta(sheet, world, ctx, "L1, L2"))
    page = sd.new_page()
    (fx0, fy0, fx1, fy1), tb = frame_and_title(sd, page, 1, 1, ctx["utc"], ctx["sha"])
    pal, counts = finish_palette(world)
    origins = {"L1": (fx0 + 16, 136), "L2": (fx0 + 206, 136)}
    areas = {}
    for i, f in enumerate(sorted(world["floors"], key=lambda f: f["elevation"])):
        plan = build_plan(world, f["id"], den, with_tags=False)
        ox, oy = origins[f["id"]]
        x0, y0, x1, y1 = plan["extent"]
        W, H = (x1 - x0) * 1000 / den, (y1 - y0) * 1000 / den
        v = page.view(f"finish-{f['id']}", den, (ox, oy), (ox - 6, oy - 6, ox + W + 6, oy + H + 6),
                      model_offset_m=(i * 40.0, 0.0))
        for r in world["rooms"]:
            if r["floor"] != f["id"]:
                continue
            fin = r["finish"]["floor"]
            v.poly(r["polygon"], "I-FLOR-PATT", closed=True, stroke=None, fill=pal[fin],
                   xd=("room", r["id"], {"finish_floor": fin}))
            areas[fin] = areas.get(fin, 0.0) + plan_area(r)
        plan_base(v, plan, mode="full", fixtures=None, grid=False, room_outline=True)
        room_id_labels(v, plan, [w["rect"] for w in plan["walls"]], size=5.0)
        view_title(page, ox, oy + H + 9, f"FINISH LANTAI {f['id']}", f"1:{den} · {f['name']}", size=9)
    north_arrow(page, fx1 - 12, fy1 - 20, r=5)
    # Legend.
    x = fx0 + 4
    y = 122
    y = heading(page, x, y, "LEGENDA FINISH LANTAI (finish.floor di world.json)", 200, size=8)
    rows = []
    for k in pal:
        rows.append(["", k if k != "-" else "- (tanpa finish: shaft/riser)", str(counts[k]),
                     f"{areas.get(k, 0):.2f}".replace(".", ","), f"{contrast_ratio(INK, pal[k]):.1f}:1".replace(".", ",")])
    cols = [Col("", 8), Col("Finish", 92), Col("Ruang", 16, "r"), Col("Luas m²", 22, "r", "M"),
            Col("Kontras teks", 24, "r")]
    _, yb = draw_table(page, x, y, cols, rows, size=6.4, lead=1.25, zebra=False)
    # Swatches in the empty first column, aligned with the drawn rows.
    from krcad.draw import table_rows_height
    hh = 6.4 * 1.25 / PT_PER_MM + 2.0
    yy = y - hh
    for k, h in zip(pal, table_rows_height(cols, rows, 6.4, 1.25)):
        page.rect(x + 1.2, yy - h + 0.8, x + 6.8, yy - 0.8, "I-FLOR-PATT", stroke=GREY_TEXT, fill=pal[k], width=0.3)
        yy -= h
    total = sum(areas.values())
    page.text((x, yb - 4), f"Total luas {fmt_area(total)} (dua lantai), {sum(counts.values())} ruang.",
              "A-ANNO-NOTE", size=6.6, font="M")
    nx = x + 172
    ny = 122
    ny = heading(page, nx, ny, "CATATAN", tb[0] - nx - 6 + (fx1 - tb[0]), size=8)
    for n_ in ["Warna = finish lantai per ruang dari world.json; finish dinding dan plafon tercantum di A-103.",
               "Finish adalah proposal konsep (status ruang 'proposal konsep'), bukan spesifikasi material.",
               "Luas as-drawn di as dinding (AS-DIM-02); ukuran gedung proposal (AS-DIM-01, AS-DIM-03).",
               "Kontras teks dihitung (WCAG) terhadap setiap warna isi; minimum 4,5:1."]:
        ny = paragraph(page, nx, ny, n_, fx1 - nx - 4, size=6.4, bullet=True)
    scale_bar(page, x, fy0 + 5, den, (0, 2, 5, 10, 20))
    sd.summary = {"finishes": {k: {"rooms": counts[k], "area_m2": round(areas.get(k, 0), 2)} for k in pal},
                  "total_m2": round(total, 2)}
    return sd


def plan_area(room):
    from tools.kantor.geometry import polygon_area
    return polygon_area(room["polygon"])
