"""Q-01 trace (ADR-008): PRD functions <-> rooms, with negative cases."""
import copy
import json

from tools.prd_trace import ROOT, trace

SPEC = json.loads((ROOT / "design" / "prd-function-trace.json").read_text(encoding="utf-8"))
PRD = (ROOT / "PRD" / "PRD-v0.1.md").read_text(encoding="utf-8")


def test_every_function_and_room_traced(world):
    rep = trace(world, SPEC, PRD)
    assert rep["problems"] == [] and rep["roomsTraced"] == len(world["rooms"])


def test_extra_room_without_function_fails(world):
    world["rooms"].append(dict(world["rooms"][0], id="L1-EXTRA"))
    assert "L1-EXTRA: traced by no PRD function" in trace(world, SPEC, PRD)["problems"]


def test_function_losing_its_room_fails(world):
    spec = copy.deepcopy(SPEC)
    world["rooms"] = [r for r in world["rooms"] if r["id"] != "L2-BILLIARD"]
    assert any("unknown room L2-BILLIARD" in p for p in trace(world, spec, PRD)["problems"])


def test_phrase_removed_from_prd_fails(world):
    assert any("PF-L2-04" in p for p in trace(world, SPEC, PRD.replace("biliar", "snooker"))["problems"])
