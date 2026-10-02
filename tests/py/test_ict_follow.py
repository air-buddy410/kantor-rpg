"""ICT outlets follow furniture (Studio layouts) + Python/TS parity cases.

The cases file app/tests/fixtures/ict-follow-cases.json is generated here and
replayed by app/tests/unit/ict.test.ts against app/src/world/ict.ts; the test
below fails if the committed file is stale.
"""
import copy
import json
import subprocess
import sys

from tools.kantor.ict_follow import derive_outlets
from tools.ict_derive import derive
from tools.validate_world import Report, check_ict

from conftest import ROOT

CASES = ROOT / "app" / "tests" / "fixtures" / "ict-follow-cases.json"


def apply_ops(fixtures, ops):
    """Ops mirror the Studio editor (move/delete/add); replayed in TS too."""
    f = copy.deepcopy(fixtures)
    for op in ops:
        if op["kind"] == "move":
            next(x for x in f if x["id"] == op["id"])["pos"] = list(op["pos"])
        elif op["kind"] == "delete":
            f = [x for x in f if x["id"] != op["id"]]
        else:
            f.append(copy.deepcopy(op["fixture"]))
    return f


def _cases(world):
    cat = world["catalog"]
    disp = next(x["id"] for x in world["fixtures"] if x["type"] == "wall_display" and x["floor"] == "L2")
    def new(fid, t, pos):
        return {"id": fid, "floor": "L1", "room": "L1-IMPL", "type": t, "asset": "AST-" + t.upper(), "pos": pos,
                "rot": 0, "size": list(cat[t]["size"]), "collider": cat[t]["collider"]}
    specs = [
        ("identity", []),
        ("move-desk", [{"kind": "move", "id": "FX-L1-053", "pos": [8.25, 13.0]}]),
        ("move-display-l2", [{"kind": "move", "id": disp, "pos": [12.0, 0.5]}]),
        ("delete-desk", [{"kind": "delete", "id": "FX-L1-055"}]),
        ("add-desk", [{"kind": "add", "fixture": new("FX-L1-D001", "desk", [12.75, 11.5])}]),
        ("add-chair-no-outlet", [{"kind": "add", "fixture": new("FX-L1-D002", "chair", [12.75, 12.5])}]),
        ("move-then-delete", [{"kind": "move", "id": "FX-L1-053", "pos": [8.25, 13.0]}, {"kind": "delete", "id": "FX-L1-053"}]),
    ]
    return [{"name": n, "ops": ops, "expected": derive_outlets(world, apply_ops(world["fixtures"], ops))} for n, ops in specs]


def test_identity_keeps_seed_outlets(world):
    r = derive_outlets(world, world["fixtures"])
    assert r["outlets"] == world["ict"]["outlets"] and not (r["moved"] or r["removed"] or r["added"])


def test_moved_desk_moves_its_outlet(world):
    case = next(c for c in _cases(world) if c["name"] == "move-desk")["expected"]
    o = next(x for x in case["outlets"] if x["serves"] == "FX-L1-053")
    assert o["pos"] == [8.25, 13.0] and case["moved"] == [o["id"]]


def test_deleted_and_added_furniture(world):
    cases = {c["name"]: c["expected"] for c in _cases(world)}
    gone = next(o["id"] for o in world["ict"]["outlets"] if o["serves"] == "FX-L1-055")
    assert cases["delete-desk"]["removed"] == [gone]
    assert cases["add-desk"]["added"] == ["TO-L1-D001"]
    new = next(o for o in cases["add-desk"]["outlets"] if o["id"] == "TO-L1-D001")
    assert new["ports"] == 2 and new["domain"] == "NET-OFFICE" and new["serves"] == "FX-L1-D001"
    assert cases["add-chair-no-outlet"]["added"] == []


def test_port_map_follows_layout(world):
    """A moved desk changes its cable length; a deleted desk drops 2 ports; FK checks still pass."""
    base = derive(world)
    w = copy.deepcopy(world)
    fx = next(f for f in w["fixtures"] if f["id"] == "FX-L1-055")
    w["fixtures"].remove(fx)
    w["ict"]["outlets"] = derive_outlets(world, w["fixtures"])["outlets"]
    res = derive(w)
    assert res["totals"]["ports"] == base["totals"]["ports"] - 2 and not res["errors"]
    rep = Report()
    check_ict(w, rep)
    assert not rep.failures, rep.failures


def test_cli_layout_option(tmp_path, world):
    fixtures = apply_ops(world["fixtures"], next(c for c in _cases(world) if c["name"] == "add-desk")["ops"])
    doc = {"format": "kantor-rpg-layout", "version": 2, "worldRevision": world["revision"]["id"],
           "savedAt": "2026-10-01T00:00:00Z", "note": "test", "fixtures": fixtures}
    lay = tmp_path / "layout.json"
    lay.write_text(json.dumps(doc), encoding="utf-8")
    r = subprocess.run([sys.executable, "tools/ict_derive.py", "--layout", str(lay), "--out", str(tmp_path / "out")],
                       cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    res = json.loads((tmp_path / "out" / "ict-portmap.json").read_text())
    assert res["layout"]["added"] == ["TO-L1-D001"] and res["totals"]["outlets"] == len(world["ict"]["outlets"]) + 1
    bad = dict(doc, worldRevision="P01")
    lay.write_text(json.dumps(bad), encoding="utf-8")
    r = subprocess.run([sys.executable, "tools/ict_derive.py", "--layout", str(lay), "--out", str(tmp_path / "o2")],
                       cwd=ROOT, capture_output=True, text=True)
    assert r.returncode != 0 and "P01" in r.stderr


def test_parity_cases_file_is_fresh(world):
    fresh = json.dumps({"worldRevision": world["revision"]["id"], "cases": _cases(world)}, indent=1) + "\n"
    if "--regen" in sys.argv or not CASES.exists():
        CASES.write_text(fresh, encoding="utf-8")
    assert CASES.read_text(encoding="utf-8") == fresh, "run: python3 tests/py/test_ict_follow.py --regen"


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    w = json.loads((ROOT / "design" / "world.json").read_text(encoding="utf-8"))
    CASES.write_text(json.dumps({"worldRevision": w["revision"]["id"], "cases": _cases(w)}, indent=1) + "\n", encoding="utf-8")
    print(CASES)
