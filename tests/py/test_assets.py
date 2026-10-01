"""Character asset checks with the standard library only (no bpy).

Parses each GLB header and JSON chunk and compares it with design/characters.json,
design/world.json actors and design/asset-registry.json. Blender-side checks
(reopen, deform, slip) live in blender/validate_assets.py.
"""
import json
import struct
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CHARS = json.loads((ROOT / "design" / "characters.json").read_text(encoding="utf-8"))
WORLD = json.loads((ROOT / "design" / "world.json").read_text(encoding="utf-8"))
GLB_DIR = ROOT / "app" / "public" / "assets" / "characters"
IDS = list(CHARS["characters"])
BUILD_HINT = "run: blender -b --factory-startup -noaudio --python blender/characters/build_characters.py"


def glb_path(cid):
    return GLB_DIR / f"{cid.lower()}.glb"


def read_glb(path):
    b = path.read_bytes()
    magic, version, length = struct.unpack("<4sII", b[:12])
    assert magic == b"glTF" and version == 2, (magic, version)
    assert length == len(b), "GLB length field must equal file size"
    clen, ctype = struct.unpack("<I4s", b[12:20])
    assert ctype == b"JSON"
    doc = json.loads(b[20:20 + clen])
    rest = b[20 + clen:]
    blen, btype = struct.unpack("<I4s", rest[:8])
    assert btype == b"BIN\x00" and blen <= len(rest) - 8
    return doc


@pytest.fixture(scope="module", params=IDS)
def glb(request):
    cid = request.param
    p = glb_path(cid)
    if not p.exists():
        pytest.skip(f"{p.relative_to(ROOT)} not generated yet; {BUILD_HINT}")
    return cid, p, read_glb(p)


def test_every_actor_avatar_has_a_character_spec_and_glb():
    for actor in WORLD["actors"]:
        aid = actor["avatarAsset"]
        assert aid in CHARS["characters"], f"{actor['id']} uses {aid} without a characters.json entry"
        assert CHARS["characters"][aid]["actor"] == actor["id"]
        if not glb_path(aid).exists():
            pytest.skip(f"{glb_path(aid).relative_to(ROOT)} missing; {BUILD_HINT}")


def test_animations_are_the_required_set_with_spec_durations(glb):
    cid, _, doc = glb
    names = sorted(a["name"] for a in doc["animations"])
    assert names == sorted(CHARS["animations"])
    fps = CHARS["rig"]["fps"]
    for a in doc["animations"]:
        assert a["channels"] and a["samplers"]
        t_end = max(doc["accessors"][s["input"]]["max"][0] for s in a["samplers"])
        assert abs(t_end - CHARS["animations"][a["name"]]["durationS"]) < 1.01 / fps, (cid, a["name"], t_end)


def test_skin_uses_the_shared_skeleton(glb):
    _, _, doc = glb
    assert doc.get("skins"), "character must be skinned"
    names = [n.get("name") for n in doc["nodes"]]
    joints = sorted(names[i] for i in doc["skins"][0]["joints"])
    assert joints == sorted(CHARS["rig"]["bones"])
    skinned = [n for n in doc["nodes"] if "mesh" in n]
    assert skinned and all("skin" in n for n in skinned), "every mesh node must be skinned"


def test_hair_nodes_match_spec_and_variants(glb):
    cid, _, doc = glb
    names = {n.get("name") for n in doc["nodes"]}
    hair = sorted(n for n in names if n and n.startswith("hair_"))
    var = CHARS["avatarVariants"].get(cid)
    expected = sorted("hair_" + h for h in (var["hairStyles"] if var else [CHARS["characters"][cid]["hair"]["style"]]))
    assert hair == expected
    rig = next(n for n in doc["nodes"] if n.get("name") == "rig")
    default = var["defaultHair"] if var else CHARS["characters"][cid]["hair"]["style"]
    assert rig["extras"]["kantor_default_hair"] == "hair_" + default


def test_ceo_offers_three_by_three_avatar_variants():
    var = CHARS["avatarVariants"]["CH-CEO"]
    assert len(var["hairStyles"]) >= 3 and len(var["palettes"]) >= 3
    assert var["defaultHair"] in var["hairStyles"] and var["defaultPalette"] in var["palettes"]
    p = glb_path("CH-CEO")
    if not p.exists():
        pytest.skip(BUILD_HINT)
    doc = read_glb(p)
    mats = {m["name"] for m in doc["materials"]}
    for name, pal in var["palettes"].items():
        keys = {k for k in pal if k.startswith("outfit_")}
        assert keys and keys <= mats, f"palette {name} targets materials missing from the GLB"


def test_required_material_names_present(glb):
    _, _, doc = glb
    mats = {m["name"] for m in doc["materials"]}
    assert set(CHARS["materialNames"]["required"]) <= mats
    for m in doc["materials"]:
        pbr = m.get("pbrMetallicRoughness", {})
        assert pbr.get("metallicFactor", 1.0) == 0.0, m["name"]


def test_size_triangle_and_height_budgets(glb):
    cid, path, doc = glb
    spec = CHARS["characters"][cid]
    budgets = CHARS["budgets"]
    assert path.stat().st_size <= budgets["glbBytesTarget"]
    var = CHARS["avatarVariants"].get(cid)
    default_hair = "hair_" + (var["defaultHair"] if var else spec["hair"]["style"])
    tris, ymin, ymax = 0, 1e9, -1e9
    for node in doc["nodes"]:
        if "mesh" not in node:
            continue
        name = node["name"]
        if name.startswith("hair_") and name != default_hair:
            continue
        for prim in doc["meshes"][node["mesh"]]["primitives"]:
            tris += doc["accessors"][prim["indices"]]["count"] // 3
            pos = doc["accessors"][prim["attributes"]["POSITION"]]
            ymin, ymax = min(ymin, pos["min"][1]), max(ymax, pos["max"][1])
    budget = budgets["playerTrianglesLOD0" if spec["kind"] == "player" else "npcTrianglesLOD0"]
    assert tris <= budget, (cid, tris, budget)
    assert abs(ymin) < 0.005, f"feet should be on the floor, min y {ymin}"
    h = spec["body"]["heightM"]
    assert abs((ymax - ymin) - h) <= budgets["heightTolerance"] * h, (cid, ymax - ymin, h)


def test_character_faces_plus_z_in_gltf(glb):
    _, _, doc = glb
    body = next(n for n in doc["nodes"] if n.get("name") == "body")
    mat_index = {m["name"]: i for i, m in enumerate(doc["materials"])}["eye_iris"]
    prims = [p for p in doc["meshes"][body["mesh"]]["primitives"] if p.get("material") == mat_index]
    assert prims
    for p in prims:
        pos = doc["accessors"][p["attributes"]["POSITION"]]
        assert pos["min"][2] > 0.05, "eyes must sit on the +Z (forward) side"


def test_registry_entries_match_files():
    reg_path = ROOT / "design" / "asset-registry.json"
    if not reg_path.exists():
        pytest.skip("design/asset-registry.json is written by blender/validate_assets.py")
    reg = {a["id"]: a for a in json.loads(reg_path.read_text(encoding="utf-8"))["assets"]}
    for cid, spec in CHARS["characters"].items():
        a = reg.get(cid)
        assert a is not None, f"{cid} missing from asset registry"
        assert a["kind"] == "character"
        assert a["status"] == "generated+validated", (cid, a["status"])
        for key in ("glb", "blend", "preview", "source"):
            assert a[key] and (ROOT / a[key]).exists(), (cid, key, a.get(key))
        assert a["collider"]["type"] == "capsule"
        assert sorted(a["animations"]) == sorted(CHARS["animations"])
        assert a["triangles"]["lod0Visible"] <= a["triangles"]["budget"]
        assert a["glbBytes"] == (ROOT / a["glb"]).stat().st_size, f"{cid}: registry is stale, rerun validate"


def test_previews_are_pngs_under_budget():
    names = [f"{cid.lower()}-sheet.png" for cid in IDS] + ["ch-ceo-deform.png", "ch-ceo-variants.png"]
    for n in names:
        p = ROOT / "assets" / "previews" / n
        if not p.exists():
            pytest.skip(f"{n} missing; run blender/characters/render_sheet.py")
        assert p.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
        assert p.stat().st_size <= CHARS["budgets"]["previewBytesMax"], (n, p.stat().st_size)


def test_validation_report_passed():
    rep = ROOT / "docs" / "evidence" / "M1" / "blender-validate.json"
    if not rep.exists():
        pytest.skip("run blender/validate_assets.py")
    data = json.loads(rep.read_text(encoding="utf-8"))
    assert data["passed"] is True
    assert sorted(data["characters"]) == sorted(IDS)
    for cid, c in data["characters"].items():
        clips = c["blend_report"]["clips"]
        for gait in ("walk", "run"):
            assert clips[gait]["slip_ratio"] < 0.05, (cid, gait, clips[gait])
