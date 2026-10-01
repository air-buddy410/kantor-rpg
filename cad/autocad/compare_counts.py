"""Compare AutoCAD KRCOUNT output with the generator's <ID>.counts.json.

Usage: python3 cad/autocad/compare_counts.py cad/out/A-101.counts.json path/to/A-101.autocad-counts.txt
Exit 0 when every (layer, type) count and the model space total match, else 1.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def parse_autocad(path: Path):
    counts, total = {}, None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[:2] == ["TOTAL", "MODELSPACE"]:
            total = int(parts[2])
            continue
        # Layer names here never contain spaces, so the split is unambiguous.
        layer, kind, n = parts[0], parts[1], int(parts[2])
        counts[(layer.upper(), kind.upper())] = n
    return counts, total


def main(argv) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    ref = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    want = {(layer.upper(), kind.upper()): n for layer, kinds in ref["modelspace"].items() for kind, n in kinds.items()}
    got, total = parse_autocad(Path(argv[1]))
    bad = 0
    for key in sorted(set(want) | set(got)):
        w, g = want.get(key, 0), got.get(key, 0)
        status = "OK" if w == g else "BEDA"
        bad += w != g
        print(f"{status:4s} {key[0]:14s} {key[1]:12s} generator {w:5d}  autocad {g:5d}")
    # Openings (P03): the per-layer rows above already compare every entity;
    # these lines restate them as door/window numbers an operator can check
    # against the drawing (one A-GLAZ-IDEN text per window, one A-DOOR arc per leaf).
    op = ref.get("openings")
    if op:
        print(f"openings generator: jendela {op['window_symbols']} {op.get('windows_per_floor', {})}, "
              f"daun pintu {op['door_leaves']}, busur {op['door_arcs']}")
        for label, key, n in (("jendela (A-GLAZ-IDEN TEXT)", ("A-GLAZ-IDEN", "TEXT"), op["window_symbols"]),
                              ("busur pintu (A-DOOR ARC)", ("A-DOOR", "ARC"), op["door_arcs"])):
            if key in want:
                print(f"  {label}: generator {n}, autocad {got.get(key, 0)}")
    exp_total = ref["totals"]["modelspace"]
    print(f"total model space generator {exp_total} autocad {total}")
    if total != exp_total:
        bad += 1
    print("HASIL:", "cocok" if bad == 0 else f"{bad} perbedaan")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
