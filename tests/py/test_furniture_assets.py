"""Furniture GLBs vs the world.json catalog, stdlib only (no Blender)."""
import copy
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "blender" / "furniture"))
sys.path.insert(0, str(ROOT / "blender" / "lib"))
import furniture_spec as FS  # noqa: E402
import glb_read as G  # noqa: E402

CATALOG, ASSETS = FS.load_catalog()
TYPES = list(CATALOG)
HINT = "run blender -b --factory-startup -noaudio --python blender/furniture/build_furniture.py"


def palette_names():
    src = (ROOT / "app" / "src" / "world" / "palette.ts").read_text(encoding="utf-8")
    env = re.search(r"export const ENV[^=]*=\s*\{(.*?)\n\}", src, re.S).group(1)
    return set(re.findall(r"(\w+):\s*0x[0-9a-fA-F]{6}", env)) | {"art_a", "art_b", "art_c"}


def load(t):
    p = FS.glb_path(t)
    if not p.exists():
        pytest.skip(f"{p.relative_to(ROOT)} missing; {HINT}")
    return G.Glb(p)


def problems(g, t, size):
    """All contract violations of one furniture GLB against a catalog size."""
    out = []
    name = f"FURN-{t}"
    nodes = g.nodes_by_name()
    if [n for n, v in nodes.items() if "mesh" in v] != [name]:
        return [f"mesh nodes {list(nodes)}"]
    mn, mx = G.world_bounds(*g.node_bounds(name))
    dims = [mx[i] - mn[i] for i in range(3)]
    if any(abs(a - b) > FS.TOL_M for a, b in zip(dims, size)):
        out.append(f"dims {dims} != {size}")
    if abs(mn[0] + mx[0]) / 2 > 0.01 or abs(mn[1] + mx[1]) / 2 > 0.01:
        out.append("not centred")
    if abs(mn[2]) > 0.002:
        out.append(f"min z {mn[2]}")
    tris = g.node_triangles(name)
    if tris > FS.tri_budget(size):
        out.append(f"triangles {tris} > {FS.tri_budget(size)}")
    if t in FS.FRONT_RULES:
        mat, side, zmin = FS.FRONT_RULES[t]
        ys = []
        for p in g.mesh_primitives(name):
            if g.material_name(p) == mat:
                ys += [G.gltf_to_world(v)[1] for v in g.accessor(p["attributes"]["POSITION"]) if G.gltf_to_world(v)[2] >= zmin]
        y = sum(ys) / len(ys) if ys else None
        if y is None or (side == "-" and y >= -0.005) or (side == "+" and y <= 0.005):
            out.append(f"front probe {mat} mean y {y}")
    return out


@pytest.mark.parametrize("t", TYPES)
def test_furniture_glb_meets_catalog_contract(t):
    g = load(t)
    assert problems(g, t, CATALOG[t]["size"]) == []
    mats = {m["name"] for m in g.doc["materials"]}
    assert mats <= palette_names(), mats - palette_names()


def test_every_type_has_rule_or_is_declared_symmetric():
    for t in TYPES:
        assert (t in FS.FRONT_RULES) != (t in FS.SYMMETRIC), t


def test_mount_heights_match_runtime_panels():
    ts = ROOT / "app" / "src" / "world" / "furniture.ts"
    src = ts.read_text(encoding="utf-8") if ts.exists() else ""
    found = {t: re.search(rf"case '{t}':\s*\n?\s*panel\(w, h, d, ([0-9.]+)", src) for t in FS.MOUNT_HEIGHT_M}
    if not any(found.values()):
        pytest.skip("runtime no longer builds wall panels procedurally; mount heights live in GLB extras")
    for t, hgt in FS.MOUNT_HEIGHT_M.items():
        m = found[t]
        assert m and abs(float(m.group(1)) - hgt) < 1e-9, t


def test_negative_wrong_catalog_size_is_detected():
    g = load("desk")
    size = copy.deepcopy(CATALOG["desk"]["size"])
    size[0] += 0.10
    assert any(p.startswith("dims") for p in problems(g, "desk", size))


def test_negative_flipped_front_is_detected():
    g = load("chair")
    rule = FS.FRONT_RULES["chair"]
    FS.FRONT_RULES["chair"] = (rule[0], "-" if rule[1] == "+" else "+", rule[2])
    try:
        assert any(p.startswith("front probe") for p in problems(g, "chair", CATALOG["chair"]["size"]))
    finally:
        FS.FRONT_RULES["chair"] = rule


def test_registry_has_one_validated_entry_per_type():
    reg = json.loads((ROOT / "design" / "asset-registry.json").read_text(encoding="utf-8"))
    furn = {a["catalogType"]: a for a in reg["assets"] if a.get("kind") == "furniture"}
    assert sorted(furn) == sorted(TYPES)
    for t, a in furn.items():
        assert a["id"] == ASSETS[t]
        assert a["status"] == "generated+validated", t
        assert a["collider"] == {"type": "box", "size": CATALOG[t]["size"]}
        for k in ("glb", "blend", "preview", "source"):
            assert (ROOT / a[k]).exists(), (t, k)
        assert a["glbBytes"] == (ROOT / a["glb"]).stat().st_size, f"{t}: registry stale, rerun validator"
        assert a["triangles"]["lod0Visible"] <= a["triangles"]["budget"]


def test_contact_sheet_and_report():
    sheet = ROOT / "assets" / "previews" / "furniture-sheet.png"
    assert sheet.exists() and sheet.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert sheet.stat().st_size <= 400_000
    rep = json.loads((ROOT / "docs" / "evidence" / "M3" / "furniture-validate.json").read_text(encoding="utf-8"))
    assert rep["passed"] is True and rep["types"] == len(TYPES)
