"""Telecom outlets follow furniture (Office Studio layouts).

Same algorithm as app/src/world/ict.ts (parity test: tests/py/test_ict_follow.py
writes the cases, app/tests/unit/ict.test.ts replays them):
- device outlets (AP, camera) never move;
- an outlet serving a fixture takes that fixture's floor, room and position;
- if the fixture is gone, its outlet is removed (no endpoint left to serve);
- a fixture whose type has a rule in world.ict.outletRules but no outlet gets
  a new one with a stable id derived from the fixture id
  (FX-L1-D003 -> TO-L1-D003), so undo/redo and re-import give the same ids.
"""
from __future__ import annotations

import re


def _r3(v: float) -> float:
    # Match JS Math.round(v * 1000) / 1000 (half away from zero for positives).
    import math
    return math.floor(v * 1000 + 0.5) / 1000


def outlet_id_for(fixture_id: str, floor: str) -> str:
    m = re.match(r"^FX-(L[12])-(.+)$", fixture_id)
    return f"TO-{m.group(1)}-{m.group(2)}" if m else f"TO-{floor}-{fixture_id.replace('FX-', '')}"


def derive_outlets(world: dict, fixtures: list[dict]) -> dict:
    ict = world["ict"]
    rules, mount_z = ict["outletRules"], ict["mountZ"]
    by_id = {f["id"]: f for f in fixtures}
    devices = {d["id"] for d in ict["devices"]}
    out, moved, removed = [], [], []
    served = set()
    for o in ict["outlets"]:
        if o["serves"] in devices:
            out.append(dict(o))
            continue
        fx = by_id.get(o["serves"])
        if fx is None:
            removed.append(o["id"])
            continue
        served.add(fx["id"])
        pos = [_r3(fx["pos"][0]), _r3(fx["pos"][1])]
        rec = dict(o, floor=fx["floor"], room=fx["room"], pos=pos)
        if pos != o["pos"] or fx["floor"] != o["floor"]:
            moved.append(o["id"])
        out.append(rec)
    added = []
    for fx in sorted(fixtures, key=lambda f: f["id"]):
        rule = rules.get(fx["type"])
        if not rule or fx["id"] in served:
            continue
        oid = outlet_id_for(fx["id"], fx["floor"])
        added.append(oid)
        out.append({"id": oid, "floor": fx["floor"], "room": fx["room"], "pos": [_r3(fx["pos"][0]), _r3(fx["pos"][1])],
                    "mount": rule["mount"], "z": mount_z[rule["mount"]], "ports": rule["ports"], "serves": fx["id"],
                    "domain": rule["domainByFloor"][fx["floor"]], "endpointTypes": list(rule["endpointTypes"])})
    return {"outlets": out, "moved": moved, "removed": removed, "added": added}


def apply_layout(world: dict, fixtures: list[dict]) -> tuple[dict, dict]:
    """Copy of world with the layout's fixtures and re-derived outlets."""
    import copy
    w = copy.deepcopy(world)
    res = derive_outlets(world, fixtures)
    w["fixtures"] = copy.deepcopy(fixtures)
    w["ict"]["outlets"] = res["outlets"]
    return w, res
