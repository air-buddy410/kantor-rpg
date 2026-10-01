"""Building GLBs vs design/world.json, stdlib only (no Blender).

The expected geometry comes from blender/building/building_spec.py, the same
pure-Python module the Blender builder uses, so a mutated world must produce
mismatches against the committed GLBs (negative tests below).
"""
import copy
import math
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "blender" / "building"))
sys.path.insert(0, str(ROOT / "blender" / "lib"))
import building_spec as S  # noqa: E402
import glb_read as G  # noqa: E402

TOL = 0.01
GLB_DIR = ROOT / "app" / "public" / "assets" / "building"
HINT = "run blender -b --factory-startup -noaudio --python blender/building/build_building.py"


def glb(fid):
    p = GLB_DIR / f"building-{fid}.glb"
    if not p.exists():
        pytest.skip(f"{p.relative_to(ROOT)} missing; {HINT}")
    return G.Glb(p)


def mismatches(g, exp_floor):
    """Every difference between a floor GLB and the expected boxes, as strings."""
    out = []
    nodes = g.nodes_by_name()

    def bounds(name):
        if name not in nodes or "mesh" not in nodes[name]:
            return None
        return G.world_bounds(*g.node_bounds(name))
    for w in exp_floor["walls"]:
        b = bounds(w["id"])
        want = ((w["x0"], w["y0"], w["z0"]), (w["x1"], w["y1"], w["z1"]))
        if b is None:
            out.append(f"{w['id']} missing")
        elif any(abs(u - v) > TOL for u, v in zip(b[0] + b[1], want[0] + want[1])):
            out.append(f"{w['id']} box {b} != {want}")
    names = {w["id"] for w in exp_floor["walls"]}
    extra = {n for n in nodes if n and n.startswith("WALL-")} - names
    out += [f"{n} not in spec" for n in sorted(extra)]
    for o in exp_floor["openings"]:
        b = bounds(o["id"])
        if b is None:
            out.append(f"{o['id']} missing")
            continue
        want = ((o["x0"], o["y0"], o["z0"]), (o["x1"], o["y1"], o["z1"]))
        if any(abs(u - v) > TOL for u, v in zip(b[0] + b[1], want[0] + want[1])):
            out.append(f"{o['id']} box {b} != {want}")
    sl = exp_floor["slab"]
    b = bounds(sl["id"])
    if b is None or abs(b[1][0] - b[0][0] - (sl["x1"] - sl["x0"])) > TOL or abs(b[1][1] - b[0][1] - (sl["y1"] - sl["y0"])) > TOL \
            or abs(b[1][2] - exp_floor["elevation"]) > TOL:
        out.append(f"{sl['id']} extents/elevation {b}")
    return out


@pytest.fixture(scope="module")
def world():
    return S.load_world()


@pytest.fixture(scope="module")
def walls(world):
    return S.load_walls(world)


def test_walls_json_matches_world_revision(world, walls):
    assert walls["worldRevision"] == world["revision"]["id"]
    fresh = S.derive_all(world)
    for fid, fl in fresh["floors"].items():
        assert fl["walls"] == walls["floors"][fid]["walls"], f"{fid}: walls.json stale, run tools/export_runtime.py"
        assert fl["openings"] == walls["floors"][fid]["openings"]


@pytest.mark.parametrize("fid", ["L1", "L2"])
def test_every_wall_and_door_node_exists(world, walls, fid):
    g = glb(fid)
    names = set(g.nodes_by_name())
    exp = S.building_expectations(world, walls)[fid]
    for w in exp["walls"]:
        assert w["id"] in names
    doors = [d["id"] for d in world["doors"] if d["floor"] == fid]
    assert doors
    for d in doors:
        assert f"OPEN-{d}" in names and f"LINTEL-{d}" in names, d
    for r in exp["rooms"]:
        assert f"ROOM-{r}" in names
    assert f"SLAB-{fid}" in names


@pytest.mark.parametrize("fid", ["L1", "L2"])
def test_glb_boxes_match_world(world, walls, fid):
    g = glb(fid)
    exp = S.building_expectations(world, walls)[fid]
    assert mismatches(g, exp) == []


@pytest.mark.parametrize("fid", ["L1", "L2"])
def test_door_gaps_equal_door_width(world, walls, fid):
    g = glb(fid)
    nodes = g.nodes_by_name()
    for d in (d for d in world["doors"] if d["floor"] == fid):
        mn, mx = G.world_bounds(*g.node_bounds(f"OPEN-{d['id']}"))
        ax = 0 if d["wallAxis"] == "x" else 1
        assert abs((mx[ax] - mn[ax]) - d["width"]) <= TOL, d["id"]
        centre = (mn[ax] + mx[ax]) / 2
        assert abs(centre - d["center"][ax]) <= TOL, d["id"]
    assert nodes


def test_floor_elevations_and_vertical_links(world):
    for f in world["floors"]:
        g = glb(f["id"])
        mn, mx = G.world_bounds(*g.node_bounds(f"SLAB-{f['id']}"))
        assert abs(mx[2] - f["elevation"]) <= TOL
        assert abs((mx[0] - mn[0]) - 32) <= TOL and abs((mx[1] - mn[1]) - 24) <= TOL
        for fx in (x for x in world["fixtures"] if x["floor"] == f["id"] and x["type"] in ("stair_u", "lift")):
            prefix = "LIFT" if fx["type"] == "lift" else ("STAIR" if f["elevation"] == 0 else "STAIRWELL")
            mn, mx = G.world_bounds(*g.node_bounds(f"{prefix}-{fx['id']}"))
            assert abs((mn[0] + mx[0]) / 2 - fx["pos"][0]) <= TOL and abs((mn[1] + mx[1]) / 2 - fx["pos"][1]) <= TOL


def test_axis_mapping_world_to_gltf(world, walls):
    """A wall's glTF accessor bounds equal its world box mapped (x, y, z) -> (x, z, -y)."""
    g = glb("L1")
    w = S.building_expectations(world, walls)["L1"]["walls"][0]
    mn, mx = g.node_bounds(w["id"])
    corners = [S.world_to_gltf((x, y, z)) for x in (w["x0"], w["x1"]) for y in (w["y0"], w["y1"]) for z in (w["z0"], w["z1"])]
    want_min = [min(c[i] for c in corners) for i in range(3)]
    want_max = [max(c[i] for c in corners) for i in range(3)]
    assert all(abs(a - b) <= 1e-4 for a, b in zip(mn + mx, want_min + want_max))
    # and a raw vertex from the binary buffer maps back into the world box
    prim = g.mesh_primitives(w["id"])[0]
    v = g.accessor(prim["attributes"]["POSITION"])[0]
    x, y, z = S.gltf_to_world(v)
    assert w["x0"] - 1e-4 <= x <= w["x1"] + 1e-4 and w["y0"] - 1e-4 <= y <= w["y1"] + 1e-4 and w["z0"] - 1e-4 <= z <= w["z1"] + 1e-4


# ------------------------------------------------------------------ negative tests
def test_moved_door_is_detected(world):
    g = glb("L1")
    w2 = copy.deepcopy(world)
    door = next(d for d in w2["doors"] if d["floor"] == "L1" and d["wallAxis"] == "x" and not d["exit"])
    door["center"] = [door["center"][0] + 0.5, door["center"][1]]
    exp = S.building_expectations(w2, S.derive_all(w2))["L1"]
    found = mismatches(g, exp)
    assert any(door["id"] in m for m in found), found[:5]
    assert any(m.startswith("WALL-") for m in found)


def test_changed_wall_thickness_is_detected(world):
    g = glb("L1")
    w2 = copy.deepcopy(world)
    w2["building"]["wall"]["interior"] = 0.20
    exp = S.building_expectations(w2, S.derive_all(w2))["L1"]
    assert len(mismatches(g, exp)) > 10


def test_wrong_axis_mapping_is_detected(world, walls):
    g = glb("L1")
    w = S.building_expectations(world, walls)["L1"]["walls"][0]
    mn, mx = g.node_bounds(w["id"])
    naive = (tuple(mn), tuple(mx))  # treating glTF as world without the swap
    want = ((w["x0"], w["y0"], w["z0"]), (w["x1"], w["y1"], w["z1"]))
    assert any(abs(a - b) > TOL for a, b in zip(naive[0] + naive[1], want[0] + want[1]))


# ------------------------------------------------------------------ windows and door leaves (P03)
def node_world_bounds(g, name):
    nodes = g.nodes_by_name()
    if name not in nodes or "mesh" not in nodes[name]:
        return None
    mn, mx = g.node_bounds(name)
    t = nodes[name].get("translation", [0.0, 0.0, 0.0])
    return G.world_bounds([a + b for a, b in zip(mn, t)], [a + b for a, b in zip(mx, t)])


def windows_of(world, fid):
    elev = next(f["elevation"] for f in world["floors"] if f["id"] == fid)
    return {w["id"]: w for w in world["windows"] if w["floor"] == fid}, elev


def window_mismatches(g, world, fid):
    """Every window whose pane node is missing or off the dataset by more than 1 cm."""
    wins, elev = windows_of(world, fid)
    out = []
    for wid, w in wins.items():
        b = node_world_bounds(g, wid)
        if b is None:
            out.append(f"{wid} missing")
            continue
        ax = 0 if w["wallAxis"] == "x" else 1
        c = w["center"][ax]
        if abs((b[0][ax] + b[1][ax]) / 2 - c) > TOL or abs((b[1][ax] - b[0][ax]) - w["width"]) > TOL \
                or abs(b[0][2] - (elev + w["sill"])) > TOL or abs(b[1][2] - (elev + w["head"])) > TOL:
            out.append(f"{wid} at {b}")
    extra = {n for n in g.nodes_by_name() if n and n.startswith("W-")} - set(wins)
    return out + [f"{n} not in dataset" for n in sorted(extra)]


def wall_triangles_in_openings(g, world, fid):
    """(wall node, window id) pairs where a wall triangle reaches inside a window opening."""
    wins, elev = windows_of(world, fid)
    t = world["building"]["wall"]["exterior"]
    e = 0.002
    tris = {}
    for name in (n for n in g.nodes_by_name() if n and n.startswith("WALL-")):
        out = []
        for prim in g.mesh_primitives(name):
            pos = g.accessor(prim["attributes"]["POSITION"])
            idx = g.accessor(prim["indices"])
            out += [[S.gltf_to_world(pos[i]) for i in idx[k:k + 3]] for k in range(0, len(idx), 3)]
        tris[name] = out
    hits = []
    for wid, w in wins.items():
        ax = 0 if w["wallAxis"] == "x" else 1
        lo, hi = [0.0, 0.0, elev + w["sill"] + e], [0.0, 0.0, elev + w["head"] - e]
        lo[ax], hi[ax] = w["center"][ax] - w["width"] / 2 + e, w["center"][ax] + w["width"] / 2 - e
        lo[1 - ax], hi[1 - ax] = w["at"] - t / 2 - e, w["at"] + t / 2 + e
        for name, ts in tris.items():
            for tri in ts:
                if all(min(p[k] for p in tri) < hi[k] and max(p[k] for p in tri) > lo[k] for k in range(3)):
                    hits.append((name, wid))
                    break
    return hits


def hinge_mismatches(g, world, fid):
    """Leaf nodes whose count or origin (glTF node translation) disagrees with door swing data."""
    out, want = [], {}
    for d in (d for d in world["doors"] if d["floor"] == fid and d.get("swing")):
        ax = 0 if d["wallAxis"] == "x" else 1
        lo, hi = d["center"][ax] - d["width"] / 2, d["center"][ax] + d["width"] / 2
        h = d["swing"]["hinge"]
        for i, j in enumerate([lo, hi] if h == "both" else [lo] if h == "low" else [hi], start=1):
            want[f"LEAF-{d['id']}-{i}"] = (j, ax, d["center"][1 - ax])
    nodes = g.nodes_by_name()
    got = {n for n in nodes if n and n.startswith("LEAF-")}
    out += [f"{n} missing" for n in sorted(set(want) - got)] + [f"{n} extra" for n in sorted(got - set(want))]
    for n, (j, ax, at) in want.items():
        if n not in nodes:
            continue
        o = S.gltf_to_world(nodes[n].get("translation", [0, 0, 0]))
        if abs(o[ax] - j) > TOL or abs(o[1 - ax] - at) > world["building"]["wall"]["exterior"] / 2:
            out.append(f"{n} origin {o} not on jamb {j}")
    return out


@pytest.mark.parametrize("fid", ["L1", "L2"])
def test_window_panes_match_dataset(world, fid):
    g = glb(fid)
    wins, _ = windows_of(world, fid)
    assert wins
    assert window_mismatches(g, world, fid) == []
    nodes = g.nodes_by_name()
    for wid, w in wins.items():
        assert f"FRAME-{wid}" in nodes, wid
        mats = {g.material_name(p) for p in g.mesh_primitives(wid)}
        assert mats == {"glass_" + w["glazing"]}, (wid, mats)


@pytest.mark.parametrize("fid", ["L1", "L2"])
def test_walls_have_no_geometry_inside_window_openings(world, fid):
    assert wall_triangles_in_openings(glb(fid), world, fid) == []


@pytest.mark.parametrize("fid", ["L1", "L2"])
def test_swing_door_leaves_hinge_on_dataset_jamb(world, fid):
    g = glb(fid)
    assert hinge_mismatches(g, world, fid) == []
    nodes = g.nodes_by_name()
    swing = [d for d in world["doors"] if d["floor"] == fid and d.get("swing")]
    leaves = [n for n in nodes if n and n.startswith("LEAF-")]
    assert len(leaves) == sum(2 if d["swing"]["hinge"] == "both" else 1 for d in swing)
    for n in leaves:
        assert set(nodes[n]) & {"rotation", "scale", "matrix"} == set(), n


@pytest.mark.parametrize("fid", ["L1", "L2"])
def test_leaf_open_rotation_swings_into_the_named_side(world, fid):
    """Rotating each closed leaf by its extras kantor_open_deg (about glTF +Y) must put its free
    edge on the side of the room it opens into (EXT = outside the envelope)."""
    g = glb(fid)
    nodes = g.nodes_by_name()
    rooms = {r["id"]: r for r in world["rooms"]}
    doors = {d["id"]: d for d in world["doors"]}
    for n in (n for n in nodes if n and n.startswith("LEAF-")):
        ex = nodes[n]["extras"]
        d = doors[ex["kantor_door"]]
        o = S.gltf_to_world(nodes[n]["translation"])
        mn, mx = g.node_bounds(n)
        # free edge: the local x/y extreme farthest from the hinge, in world axes
        lmn, lmx = G.world_bounds(mn, mx)
        ax = 0 if d["wallAxis"] == "x" else 1
        far = [0.0, 0.0]
        far[ax] = lmx[ax] if abs(lmx[ax]) > abs(lmn[ax]) else lmn[ax]
        a = math.radians(ex["kantor_open_deg"])
        rx, ry = far[0] * math.cos(a) - far[1] * math.sin(a), far[0] * math.sin(a) + far[1] * math.cos(a)
        tip = (o[0] + rx, o[1] + ry)
        into = ex["kantor_into"]
        if into == "EXT":
            other = next(r for r in d["rooms"] if r != "EXT")
            assert not S.point_in_polygon(tip, rooms[other]["polygon"]), n
        else:
            assert S.point_in_polygon(tip, rooms[into]["polygon"]), (n, tip)


def test_moved_window_is_detected(world):
    g = glb("L1")
    w2 = copy.deepcopy(world)
    win = next(w for w in w2["windows"] if w["floor"] == "L1" and w["wallAxis"] == "x")
    win["center"] = [win["center"][0] + 1.0, win["center"][1]]
    assert any(win["id"] in m for m in window_mismatches(g, w2, "L1"))
    # the old wall is solid where the moved window would now be
    assert any(wid == win["id"] for _, wid in wall_triangles_in_openings(g, w2, "L1"))


def test_flipped_hinge_is_detected(world):
    g = glb("L1")
    w2 = copy.deepcopy(world)
    d = next(d for d in w2["doors"] if d["floor"] == "L1" and d.get("swing", {}).get("hinge") == "low")
    d["swing"]["hinge"] = "high"
    assert any(d["id"] in m for m in hinge_mismatches(g, w2, "L1"))
    d2 = next(d for d in w2["doors"] if d["floor"] == "L1" and d.get("swing", {}).get("hinge") == "both")
    d2["swing"]["hinge"] = "low"
    assert any(f"LEAF-{d2['id']}-2 extra" == m for m in hinge_mismatches(g, w2, "L1"))


def test_validation_report_passed():
    rep = ROOT / "docs" / "evidence" / "HARDENING" / "blender-building-validate.json"
    if not rep.exists():
        pytest.skip("run blender/building/validate_building.py")
    import json
    data = json.loads(rep.read_text(encoding="utf-8"))
    assert data["passed"] is True and not data["failed"]
