import json
import math

from tools.ict_derive import derive


def test_portmap_unique_and_routed(world):
    res = derive(world)
    assert res["errors"] == []
    ports = [c["outletPort"] for c in res["cables"]]
    assert len(ports) == len(set(ports))
    assert len({(c["patchPanel"], c["ppPort"]) for c in res["cables"]}) == len(ports)
    assert len({(c["switch"], c["switchPort"]) for c in res["cables"]}) == len(ports)
    outlets = {o["id"]: o for o in world["ict"]["outlets"]}
    assert sum(o["ports"] for o in outlets.values()) == len(ports)
    for c in res["cables"]:
        o = outlets[c["outlet"]]
        straight = math.dist(c["route"][0][:2], o["pos"])
        # A routed run can never beat the straight line from rack to outlet.
        assert c["horizontal_m"] + 1e-6 >= straight
        assert abs(c["length_m"] - (c["horizontal_m"] + c["vertical_m"] + c["slack_m"])) < 0.11
        assert c["length_m"] <= world["ict"]["pathways"]["maxLinkM"]


def test_l2_cables_include_riser(world):
    res = derive(world)
    l2 = [c for c in res["cables"] if c["floor"] == "L2"]
    assert l2 and all(c["vertical_m"] >= world["ict"]["pathways"]["riserVertical"] for c in l2)


def test_bom_has_no_prices(world):
    res = derive(world)
    assert res["bom"]["price"] is None
    assert "price" not in json.dumps(res["bom"]["items"])


def test_spare_failure_path(world):
    # Remove the third switch: the spare check must fail loudly, not silently pack ports.
    rk = world["ict"]["racks"][0]
    rk["contents"] = [c for c in rk["contents"] if c["device"] != "SW-ACC-03"]
    res = derive(world)
    assert any("spare below" in e for e in res["errors"])


def test_over_length_failure_path(world):
    world["ict"]["pathways"]["maxLinkM"] = 30.0
    res = derive(world)
    assert any("over 30.0 m" in e for e in res["errors"])
