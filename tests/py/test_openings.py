"""Door swing and concept window metadata (P03): positive and negative cases."""
from tools.validate_world import Report, check_adjacency, check_openings, swing_boxes


def failed(rep):
    return {c["check"] for c in rep.checks if not c["ok"]}


def run_openings(world):
    rep = Report()
    check_openings(world, rep)
    return rep


def test_every_swing_door_has_swing_and_others_do_not(world):
    for d in world["doors"]:
        assert ("swing" in d) == (d["type"] in ("single", "double")), d["id"]


def test_exit_doors_open_outward(world):
    exits = [d for d in world["doors"] if d["exit"] and "swing" in d]
    assert exits and all(d["swing"]["into"] == "EXT" for d in exits)


def test_swing_box_lies_on_into_side(world):
    d = next(x for x in world["doors"] if x["id"] == "D-L1-15")  # CEO door from north corridor
    (x0, y0, x1, y1), = swing_boxes(world, d)
    assert y0 >= 18.5 - 1e-9 and y1 - y0 == d["width"]


def test_swing_into_unconnected_room_rejected(world):
    d = next(x for x in world["doors"] if x["id"] == "D-L1-15")
    d["swing"]["into"] = "L1-HUGO"
    assert "door_swing_metadata" in failed(run_openings(world))


def test_exit_swinging_inward_rejected(world):
    d = next(x for x in world["doors"] if x["id"] == "D-L1-EXW")
    d["swing"]["into"] = "L1-CORR"
    assert "door_swing_metadata" in failed(run_openings(world))


def test_swing_blocked_by_fixture_rejected(world):
    d = next(x for x in world["doors"] if x["id"] == "D-L1-15")
    fx = next(f for f in world["fixtures"] if f["room"] == "L1-CEO" and f["collider"])
    fx["pos"] = [d["center"][0] - 0.2 if d["swing"]["hinge"] == "low" else d["center"][0] + 0.2, d["center"][1] + 0.5]
    assert "door_swing_clear_of_fixtures" in failed(run_openings(world))


def test_window_in_server_rejected(world):
    w = dict(world["windows"][0], id="W-L1-999", room="L1-SERVER", center=[27.0, 24], at=24, wallAxis="x")
    world["windows"].append(w)
    assert "windows_on_exterior_walls" in failed(run_openings(world))


def test_interior_window_rejected(world):
    w = next(x for x in world["windows"] if x["room"] == "L1-CEO")
    w["at"], w["center"] = 18.5, [w["center"][0], 18.5]
    assert "windows_on_exterior_walls" in failed(run_openings(world))


def test_window_over_door_rejected(world):
    d = next(x for x in world["doors"] if x["id"] == "D-L1-EXW")
    w = next(x for x in world["windows"] if x["wallAxis"] == "y" and x["at"] == 0 and x["floor"] == "L1")
    w["center"] = [0, d["center"][1]]
    assert "windows_clear_of_doors_and_each_other" in failed(run_openings(world))


def test_clear_glass_in_wet_room_rejected(world):
    w = next(x for x in world["windows"] if x["room"] == "L2-WC")
    w["glazing"] = "clear"
    assert "windows_on_exterior_walls" in failed(run_openings(world))


def test_tall_fixture_in_front_of_window_rejected(world):
    w = next(x for x in world["windows"] if x["room"] == "L1-CEO")
    fx = next(f for f in world["fixtures"] if f["room"] == "L1-CEO" and f["size"][2] > 1.0)
    off = 0.2 + (fx["size"][1] if fx["rot"] in (0, 180) else fx["size"][0]) / 2
    fx["pos"] = [w["center"][0], w["at"] - off] if w["wallAxis"] == "x" else [w["at"] + off, w["center"][1]]
    assert "windows_not_blocked_by_tall_fixtures" in failed(run_openings(world))


def test_gym_over_quiet_room_rejected(world):
    # Q-03: moving the gym over the CEO room must fail ADJ-11.
    gym = next(r for r in world["rooms"] if r["id"] == "L2-GYM")
    gym["polygon"] = [[0, 18.5], [7, 18.5], [7, 24], [0, 24]]
    world["adjacency"] = [a for a in world["adjacency"] if a["id"] == "ADJ-11"]
    out = check_adjacency(world, Report(), grids={})
    adj11 = next(a for a in out if a["id"] == "ADJ-11")
    assert not adj11["ok"] and "L1-CEO" in adj11["detail"]["sensitive"]
