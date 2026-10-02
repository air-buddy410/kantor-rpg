"""World dataset checks, including negative mutations that must be caught."""
from tools.validate_world import Report, check_doors, check_fixtures, check_ict, check_navigation, check_rooms, run


def failed(rep):
    return {c["check"] for c in rep.checks if not c["ok"]}


def test_committed_world_passes_all_checks(world):
    rep, adjacency = run(world)
    assert not rep.failures, rep.failures
    assert all(a["ok"] for a in adjacency)


def test_overlapping_room_detected(world):
    room = next(r for r in world["rooms"] if r["id"] == "L1-MEET")
    room["polygon"] = [[0, 0], [9, 0], [9, 8], [0, 8]]
    rep = Report()
    check_rooms(world, rep)
    assert "rooms_no_overlap_L1" in failed(rep)
    assert "rooms_cover_envelope_L1" in failed(rep)


def test_room_outside_envelope_detected(world):
    room = next(r for r in world["rooms"] if r["id"] == "L2-READ")
    room["polygon"] = [[-1, 0], [8, 0], [8, 8], [-1, 8]]
    rep = Report()
    check_rooms(world, rep)
    assert "rooms_in_envelope_L2" in failed(rep)


def test_door_off_wall_detected(world):
    door = next(d for d in world["doors"] if d["id"] == "D-L1-10")
    door["center"] = [10, 11.5]
    rep = Report()
    check_doors(world, rep)
    assert "doors_on_shared_walls" in failed(rep)


def test_fixture_overlap_and_door_block_detected(world):
    fx = next(f for f in world["fixtures"] if f["room"] == "L1-IMPL" and f["type"] == "desk")
    fx["pos"] = [10.0, 11.0]  # in front of D-L1-10 and onto the chair row
    rep = Report()
    check_fixtures(world, rep)
    assert "door_zones_clear" in failed(rep)


def test_billiard_clearance_detected(world):
    table = next(f for f in world["fixtures"] if f["type"] == "billiard_table")
    table["pos"] = [9.3, 21.4]
    rep = Report()
    check_fixtures(world, rep)
    assert "functional_clearances" in failed(rep)


def test_nav_detects_blocked_room(world):
    # A storage shelf dropped into the CEO doorway seals the room.
    world["fixtures"].append({"id": "FX-L1-999", "floor": "L1", "room": "L1-CEO", "type": "storage_shelf",
                              "asset": "AST-STORAGE-SHELF", "pos": [3.5, 19.0], "rot": 0, "size": [1.8, 0.5, 2.0], "collider": True})
    rep = Report()
    check_navigation(world, rep)
    assert "nav_all_rooms_reachable_staff" in failed(rep)


def test_visitor_cannot_reach_server_even_if_door_public_elsewhere(world):
    rep = Report()
    check_navigation(world, rep)
    assert "nav_restricted_locked_for_visitor" not in failed(rep)
    door = next(d for d in world["doors"] if d["id"] == "D-L1-19")
    door["access"] = "public"
    rep = Report()
    check_navigation(world, rep)
    assert "nav_restricted_locked_for_visitor" in failed(rep)


def test_camera_in_shower_rejected(world):
    cam = next(d for d in world["ict"]["devices"] if d["type"] == "camera")
    cam["room"] = "L2-SHOWER"
    cam["floor"] = "L2"
    cam["pos"] = [27.5, 5.0]
    rep = Report()
    check_ict(world, rep)
    assert "ict_no_camera_in_wet_rooms" in failed(rep)


def test_orphan_outlet_rejected(world):
    world["ict"]["outlets"][0]["serves"] = "FX-L1-404"
    rep = Report()
    check_ict(world, rep)
    assert "ict_foreign_keys" in failed(rep)


def test_rack_unit_collision_rejected(world):
    world["ict"]["racks"][0]["contents"][1]["u"] = 40
    rep = Report()
    check_ict(world, rep)
    assert "ict_foreign_keys" in failed(rep)


def test_seed_drift_detected(world):
    world["fixtures"][0]["pos"] = [14.0, 5.1]
    rep, _ = run(world)
    assert "world_matches_authoring_seed" in failed(rep)
