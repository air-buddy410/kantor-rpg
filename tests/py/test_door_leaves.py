"""Door leaves (R2): one derivation feeds runtime, collision and the Blender check.

tools/kantor/geometry.py::door_leaves turns world.json swing data into leaves
(hinge point on the wall face of the 'into' side, length, closed/open angle)
and the rectangle an open leaf occupies. The navgrid (Python and TS) blocks
that rectangle, so an open leaf is solid exactly where CAD draws it and the
Blender LEAF-* node hinges.
"""
import json
import math

from conftest import ROOT
from tools.kantor.geometry import door_leaves
from tools.kantor.nav import NavGrid


def leaves(world, floor):
    return door_leaves(world, floor)


def test_one_leaf_per_single_two_per_double(world):
    for floor in ("L1", "L2"):
        doors = [d for d in world["doors"] if d["floor"] == floor and d.get("swing")]
        expected = sum(2 if d["type"] == "double" else 1 for d in doors)
        assert len(leaves(world, floor)) == expected


def test_open_leaf_lies_in_the_into_room_and_is_blocked_in_navgrid(world):
    rooms = {r["id"]: r for r in world["rooms"]}
    from tools.kantor.geometry import point_in_polygon
    for floor in ("L1", "L2"):
        g = NavGrid(world, floor)
        for lf in leaves(world, floor):
            x0, y0, x1, y1 = lf["openRect"]
            mid = ((x0 + x1) / 2, (y0 + y1) / 2)
            if lf["into"] == "EXT":
                # Exit leaves open outward, outside the envelope the navgrid covers.
                assert not (0 <= mid[0] <= 32 and 0 <= mid[1] <= 24), lf["id"]
                continue
            assert point_in_polygon(mid, rooms[lf["into"]]["polygon"]), lf["id"]
            i, j = g.cell_of(mid)
            assert g.raw[j * g.w + i] == 1, f"{lf['id']}: open leaf not solid in navgrid"


def test_leaf_length_and_angles(world):
    doors = {d["id"]: d for d in world["doors"]}
    for floor in ("L1", "L2"):
        for lf in leaves(world, floor):
            d = doors[lf["door"]]
            want = d["width"] / (2 if d["type"] == "double" else 1)
            assert abs(lf["length"] - want) < 1e-9
            assert abs(abs(((lf["openDeg"] - lf["closedDeg"] + 180) % 360) - 180) - 90) < 1e-9


def test_derived_walls_json_carries_the_leaves(world):
    derived = json.loads((ROOT / "design" / "derived" / "walls.json").read_text(encoding="utf-8"))
    for floor in ("L1", "L2"):
        assert derived["floors"][floor]["leaves"] == leaves(world, floor)


def test_blender_leaf_nodes_hinge_where_the_runtime_hinges(world):
    """Blender building GLB LEAF-<door>-<n> node translation (glTF = x, z, -y) vs derived hinge."""
    import struct
    for floor in ("L1", "L2"):
        b = (ROOT / "app" / "public" / "assets" / "building" / f"building-{floor}.glb").read_bytes()
        n = struct.unpack("<I", b[12:16])[0]
        gl = json.loads(b[20:20 + n])
        nodes = {nd.get("name"): nd for nd in gl["nodes"]}
        for lf in leaves(world, floor):
            nd = nodes.get(lf["id"])
            assert nd is not None, f"{lf['id']} missing in building-{floor}.glb"
            t = nd.get("translation", [0, 0, 0])
            assert math.hypot(t[0] - lf["hinge"][0], -t[2] - lf["hinge"][1]) < 0.011, (lf["id"], t, lf["hinge"])
