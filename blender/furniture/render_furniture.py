"""Contact sheet of every furniture type (Cycles CPU, low samples).

Run after build_furniture.py:
  blender -b --factory-startup -noaudio --python blender/furniture/render_furniture.py

Writes assets/previews/furniture-sheet.png: 9 x 6 grid, each cell a 3/4 front
view (front = -Y) framed to the item's own size, labelled with its catalog type.
"""
from __future__ import annotations

import math
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "lib"))
import furniture_spec as FS  # noqa: E402
import kantor_blender as K  # noqa: E402

ROOT = FS.ROOT
BLEND = ROOT / "blender" / "out" / "furniture.blend"
OUT = ROOT / "assets" / "previews" / "furniture-sheet.png"
COLS, ROWS, CELL = 9, 6, 160
MAX_BYTES = 400_000


def main():
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    catalog, _ = FS.load_catalog()
    objs = {o["kantor_type"]: o for o in bpy.data.objects if o.name.startswith("FURN-")}
    K.setup_cycles(CELL, CELL, 32, outline=True)
    bpy.context.scene.render.line_thickness = 0.8
    K.world_bg("#F3EAD7", "#F6EEE2", 0.7)
    K.sun("key", (50, 0, -32), 2.8, "#FFF1DE", 10)
    K.sun("rim", (60, 0, 160), 0.8, "#FFF6EA", 10)
    # labels live in their own collection that the outline line set skips
    labels = bpy.data.collections.new("labels")
    bpy.context.scene.collection.children.link(labels)
    ls = bpy.context.scene.view_layers[0].freestyle_settings.linesets[0]
    ls.select_by_collection = True
    ls.collection = labels
    ls.collection_negation = "EXCLUSIVE"
    tmp = Path(tempfile.mkdtemp(prefix="kantor-furn-"))
    cells = []
    view = Vector((-0.55, -1.0, 0.62)).normalized()
    for t in catalog:
        for o in objs.values():
            o.hide_render = o["kantor_type"] != t
        w, d, h = catalog[t]["size"]
        mount = float(objs[t].get("kantor_mount_height_m", 0.0))
        # frame by the projected bbox so a mat and a stair both fill the cell
        corners = [Vector((sx * w / 2, sy * d / 2, z)) for sx in (-1, 1) for sy in (-1, 1) for z in (0, h)]
        right = Vector((0, 0, 1)).cross(view).normalized()
        up = view.cross(right).normalized()
        xs = [c.dot(right) for c in corners]
        ys = [c.dot(up) for c in corners]
        span = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.22 + 0.15
        center = Vector((0, 0, h / 2))
        cam = K.look_at_camera(tuple(center + view * 30), tuple(center), ortho=span, name="cam_" + t)
        cam.location = center + view * 30 - up * (span * 0.06)
        lab = bpy.data.curves.new("lab", "FONT")
        lab.body = t + (f"  (+{mount:.1f} m)" if mount else "")
        lab.size = span * 0.085
        lab.align_x = "CENTER"
        lo = bpy.data.objects.new("lab", lab)
        lo.data.materials.append(K.emission_mat("lab_mat", "#2F5D50"))
        labels.objects.link(lo)
        lo.parent = cam
        lo.location = (0, -span * 0.43, -1.0)
        cells.append(K.render_pixels(tmp / f"{t}.png"))
        bpy.data.objects.remove(lo, do_unlink=True)
        bpy.data.objects.remove(cam, do_unlink=True)
        print(f"CELL {t}")
    blank = np.ones_like(cells[0])
    blank[..., :3] = [c / 255 for c in (0xF3, 0xEA, 0xD7)]
    while len(cells) < COLS * ROWS:
        cells.append(blank)
    rows = [np.concatenate(cells[r * COLS:(r + 1) * COLS], axis=1) for r in range(ROWS)]
    sheet = np.concatenate(rows[::-1], axis=0)  # Blender buffers are bottom-up
    K.save_png(K.median3_keep_lines(sheet), OUT, quant=5)
    size = OUT.stat().st_size
    print(f"FURNITURE_SHEET -> {OUT.relative_to(ROOT)} bytes={size} {'OK' if size <= MAX_BYTES else 'OVER_BUDGET'}")
    sys.exit(0 if size <= MAX_BYTES else 1)


if __name__ == "__main__":
    main()
