"""Export runtime-facing derivations of world.json.

design/derived/walls.json: wall pieces and door openings per floor (runtime,
Blender and CAD all cut the same openings).
design/derived/nav-counts.json: Python navgrid walkable counts that the
TypeScript navgrid must reproduce exactly (parity test).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.kantor.geometry import derive_walls, door_leaves, load_world  # noqa: E402
from tools.kantor.nav import NavGrid  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def main():
    w = load_world()
    walls = {"worldRevision": w["revision"]["id"], "note": "derived by tools/kantor/geometry.py::derive_walls; do not edit", "floors": {}}
    counts = {"worldRevision": w["revision"]["id"], "cell": 0.1, "radius": 0.25, "counts": {}, "probes": {}}
    for f in w["floors"]:
        ws, ops = derive_walls(w, f["id"])
        walls["floors"][f["id"]] = {"walls": ws, "openings": ops, "leaves": door_leaves(w, f["id"])}
        for mode in ("staff", "visitor"):
            g = NavGrid(w, f["id"], mode=mode)
            counts["counts"][f"{f['id']}_{mode}"] = g.walkable_count()
            # A deterministic sample of per-cell results catches offset errors that counts alone could hide.
            probes = []
            for k in range(0, g.w * g.h, 997):
                probes.append(int(g.blocked[k]))
            counts["probes"][f"{f['id']}_{mode}"] = "".join(map(str, probes))
    d = ROOT / "design" / "derived"
    (d / "walls.json").write_text(json.dumps(walls, indent=1) + "\n", encoding="utf-8")
    (d / "nav-counts.json").write_text(json.dumps(counts, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(counts["counts"]))


if __name__ == "__main__":
    main()
