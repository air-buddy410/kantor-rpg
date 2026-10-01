"""Q-01 trace: every PRD v0.1 section 5 function maps to rooms, and every room maps back.

Room variety is kept only while this passes (ADR-008). Fails on: a function
with no room, a room id missing from the dataset or on the wrong floor, a room
traced by no function, or a function phrase that no longer appears in the PRD.

Usage: python3 tools/prd_trace.py [--out docs/evidence/HARDENING/prd-trace.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def trace(world: dict, spec: dict, prd_text: str) -> dict:
    rooms = {r["id"]: r for r in world["rooms"]}
    problems = []
    norm = re.sub(r"\s+", " ", prd_text.lower())
    covered = {}
    for fn in spec["functions"]:
        if not fn["rooms"]:
            problems.append(f"{fn['id']}: no room")
        # The phrase (or each part around '/') must still be in the PRD so the
        # trace cannot outlive a PRD edit unnoticed.
        key = fn["prd"].lower().split(" dengan ")[0]
        if not all(part.strip() in norm for part in re.split(r"\s+dan\s+|/", key) if part.strip()):
            problems.append(f"{fn['id']}: phrase '{fn['prd']}' not found in PRD")
        for rid in fn["rooms"]:
            r = rooms.get(rid)
            if not r:
                problems.append(f"{fn['id']}: unknown room {rid}")
            elif r["floor"] != fn["floor"]:
                problems.append(f"{fn['id']}: {rid} is on {r['floor']}, not {fn['floor']}")
            covered.setdefault(rid, []).append(fn["id"])
    untraced = sorted(set(rooms) - set(covered))
    problems += [f"{rid}: traced by no PRD function" for rid in untraced]
    return {"functions": len(spec["functions"]), "rooms": len(rooms), "roomsTraced": len(covered),
            "untracedRooms": untraced, "problems": problems, "map": covered}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    args = ap.parse_args()
    world = json.loads((ROOT / "design" / "world.json").read_text(encoding="utf-8"))
    spec = json.loads((ROOT / "design" / "prd-function-trace.json").read_text(encoding="utf-8"))
    rep = trace(world, spec, (ROOT / "PRD" / "PRD-v0.1.md").read_text(encoding="utf-8"))
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(rep, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"functions={rep['functions']} rooms={rep['rooms']} traced={rep['roomsTraced']} problems={len(rep['problems'])}")
    for p in rep["problems"]:
        print("  FAIL", p)
    return 1 if rep["problems"] else 0


if __name__ == "__main__":
    sys.exit(main())
