"""Character asset checks with the standard library only (no bpy).

Parses each GLB (JSON chunk, binary buffer, sparse morph accessors, embedded
PNG atlas) and compares it with design/characters.json, design/world.json
actors and design/asset-registry.json. Blender-side checks (reopen, deform,
slip, LOD1 following the clips) live in blender/validate_assets.py.
"""
import json
import struct
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "blender" / "lib"))
import glb_read as G  # noqa: E402

CHARS = json.loads((ROOT / "design" / "characters.json").read_text(encoding="utf-8"))
WORLD = json.loads((ROOT / "design" / "world.json").read_text(encoding="utf-8"))
GLB_DIR = ROOT / "app" / "public" / "assets" / "characters"
IDS = list(CHARS["characters"])
BUILD_HINT = "run: blender -b --factory-startup -noaudio --python blender/characters/build_characters.py"


ATLAS = CHARS["atlas"]
EXPR = CHARS["expressions"]["names"]


def glb_path(cid):
    return GLB_DIR / f"{cid.lower()}.glb"


def default_hair(cid):
    var = CHARS["avatarVariants"].get(cid)
    return "hair_" + (var["defaultHair"] if var else CHARS["characters"][cid]["hair"]["style"])


def lod0_nodes(doc, cid):
    """Visible LOD0 mesh nodes: body, the default hair and any held prop."""
    names = [n["name"] for n in doc["nodes"] if "mesh" in n]
    return ["body", default_hair(cid)] + sorted(n for n in names if n.startswith("prop_"))


def mix_hex(a, b, t):
    a, b = G.hex_rgb(a), G.hex_rgb(b)
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(a, b))


def zone_colors(spec):
    """Expected cell colours; mirrors build_characters.zone_colors (fixed face colours + spec)."""
    c = {"skin": spec["skin"], "eyes": "#2B1F1D", "eye_iris": spec["eyes"]["iris"], "eye_highlight": "#FFFCF4",
         "mouth": "#7A3A2E", "blush": mix_hex(spec["skin"], "#E0705E", 0.45), "hair": spec["hair"]["color"]}
    c.update(spec["outfit"]["colors"])
    c.update(spec.get("propColors", {}))
    return c


def layout():
    return {z: [i % ATLAS["columns"], i // ATLAS["columns"]] for i, z in enumerate(ATLAS["zoneOrder"])}


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


@pytest.fixture(scope="module", params=IDS)
def glbx(request):
    """Full reader (binary buffer access) for accessor-level checks."""
    cid = request.param
    p = glb_path(cid)
    if not p.exists():
        pytest.skip(f"{p.relative_to(ROOT)} not generated yet; {BUILD_HINT}")
    return cid, G.Glb(p)


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
    zones = doc["scenes"][0]["extras"]["kantor_atlas"]["zones"]
    for name, pal in var["palettes"].items():
        keys = {k for k in pal if k.startswith("outfit_")}
        assert keys and keys <= set(zones), f"palette {name} targets atlas zones missing from the GLB"


def test_one_matte_atlas_material_with_nearest_png(glb):
    _, _, doc = glb
    assert [m["name"] for m in doc["materials"]] == [ATLAS["material"]]
    pbr = doc["materials"][0]["pbrMetallicRoughness"]
    assert pbr.get("metallicFactor", 1.0) == 0.0
    assert 0.8 <= pbr.get("roughnessFactor", 1.0) <= 0.9
    assert "baseColorTexture" in pbr
    assert len(doc["images"]) == 1 and doc["images"][0]["mimeType"] == "image/png"
    (smp,) = doc["samplers"]
    assert smp["magFilter"] == 9728 and smp["minFilter"] in (9728, 9984), smp  # NEAREST (mipmap nearest)
    for mesh in doc["meshes"]:
        assert all(p.get("material") == 0 for p in mesh["primitives"])


def test_atlas_png_cells_hold_character_colours(glbx):
    cid, g = glbx
    w, h, rows = G.decode_png(g.image_bytes(0))
    assert (w, h) == (ATLAS["sizePx"], ATLAS["sizePx"])
    cell = ATLAS["cellPx"]
    for zone, hexc in zone_colors(CHARS["characters"][cid]).items():
        col, row = layout()[zone]
        texels = {rows[y][x][:3] for y in range(row * cell, (row + 1) * cell) for x in range(col * cell, (col + 1) * cell)}
        assert texels == {G.hex_rgb(hexc)}, (cid, zone, texels, hexc)


def test_atlas_extras_contract_and_uvs(glbx):
    cid, g = glbx
    doc = g.doc
    meta = doc["scenes"][0]["extras"]["kantor_atlas"]
    rig = next(n for n in doc["nodes"] if n.get("name") == "rig")
    assert rig["extras"]["kantor_atlas"] == meta
    assert set(meta) == {"size", "cell", "zones"}
    assert meta["size"] == ATLAS["sizePx"] and meta["cell"] == ATLAS["cellPx"]
    assert meta["zones"] == layout()
    assert set(CHARS["materialNames"]["required"]) <= set(meta["zones"])
    zone_at = {tuple(v): z for z, v in meta["zones"].items()}
    k = meta["size"] / meta["cell"]
    for node in (n for n in doc["nodes"] if "mesh" in n):
        for prim in g.mesh_primitives(node["name"]):
            for u, v in set(g.accessor(prim["attributes"]["TEXCOORD_0"])):
                assert abs(u * k % 1 - 0.5) < 1e-3 and abs(v * k % 1 - 0.5) < 1e-3, (cid, node["name"], u, v)
                assert G.atlas_zone_of_uv(u, v, meta["size"], meta["cell"], zone_at), (cid, node["name"], u, v)


def test_one_primitive_per_node_and_lod0_draw_calls(glb):
    cid, _, doc = glb
    for node in (n for n in doc["nodes"] if "mesh" in n):
        assert len(doc["meshes"][node["mesh"]]["primitives"]) == 1, (cid, node["name"])
    nodes = lod0_nodes(doc, cid)
    props = [n for n in nodes if n.startswith("prop_")]
    assert len(nodes) == CHARS["budgets"]["visiblePrimitivesLOD0"] + len(props)
    assert len(props) <= 1


def test_expression_morph_targets_move_only_the_face(glbx):
    cid, g = glbx
    doc = g.doc
    body = next(n for n in doc["nodes"] if n.get("name") == "body")
    mesh = doc["meshes"][body["mesh"]]
    assert mesh["extras"]["targetNames"] == EXPR
    prim = mesh["primitives"][0]
    assert len(prim["targets"]) == len(EXPR)
    names = [n.get("name") for n in doc["nodes"]]
    head = [names[i] for i in doc["skins"][0]["joints"]].index("head")
    joints = g.accessor(prim["attributes"]["JOINTS_0"])
    weights = g.accessor(prim["attributes"]["WEIGHTS_0"])
    for name, t in zip(EXPR, prim["targets"]):
        acc = doc["accessors"][t["POSITION"]]
        assert "sparse" in acc, (cid, name)
        d = g.accessor(t["POSITION"])
        moved = [i for i in g.sparse_indices(t["POSITION"]) if any(abs(c) > 1e-7 for c in d[i])]
        assert moved, (cid, name)
        assert max(sum(c * c for c in d[i]) ** 0.5 for i in moved) >= 0.002, (cid, name)
        for i in moved:
            hw = sum(w for j, w in zip(joints[i], weights[i]) if j == head)
            assert hw >= 0.999, (cid, name, i, hw)
    for node in (n for n in doc["nodes"] if "mesh" in n and n["name"] != "body"):
        assert not any(p.get("targets") for p in doc["meshes"][node["mesh"]]["primitives"]), node["name"]


def test_lod1_is_one_skinned_mesh_under_budget(glbx):
    cid, g = glbx
    doc = g.doc
    nodes = g.nodes_by_name()
    lod = nodes["lod1"]
    assert "skin" in lod and "mesh" in lod
    tris = g.node_triangles("lod1")
    assert tris <= CHARS["budgets"]["npcTrianglesLOD1"], (cid, tris)
    rig = nodes["rig"]["extras"]
    assert rig["kantor_lod1_tris"] == tris and rig["kantor_lod1_node"] == "lod1"
    assert rig["kantor_lod0_tris"] == sum(g.node_triangles(n) for n in lod0_nodes(doc, cid))
    assert rig["kantor_expressions"] == ",".join(EXPR)
    assert isinstance(rig["kantor_walk_native_speed_mps"], float)
    # LOD1 must be a real reduction of the same character, not a copy
    assert tris < 0.5 * rig["kantor_lod0_tris"]
    mn, mx = g.node_bounds("lod1")
    bmn, bmx = g.node_bounds("body")
    assert abs(mn[1]) < 0.01 and abs(mx[1] - max(bmx[1], g.node_bounds(default_hair(cid))[1][1])) < 0.03


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
        if (name.startswith("hair_") and name != default_hair) or name == "lod1":
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


def test_character_faces_plus_z_in_gltf(glbx):
    _, g = glbx
    meta = g.doc["scenes"][0]["extras"]["kantor_atlas"]
    zone_at = {tuple(v): z for z, v in meta["zones"].items()}
    prim = g.mesh_primitives("body")[0]
    uv = g.accessor(prim["attributes"]["TEXCOORD_0"])
    pos = g.accessor(prim["attributes"]["POSITION"])
    eyes = [p for p, (u, v) in zip(pos, uv) if G.atlas_zone_of_uv(u, v, meta["size"], meta["cell"], zone_at) == "eye_iris"]
    assert eyes
    assert min(p[2] for p in eyes) > 0.05, "eyes must sit on the +Z (forward) side"


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
        assert a["triangles"]["lod1"] <= CHARS["budgets"]["npcTrianglesLOD1"]
        assert a["materials"] == [ATLAS["material"]]
        assert a["lod"]["lod1"]["node"] == "lod1"
        assert a["expressions"]["names"] == EXPR
        assert a["atlas"]["zones"] == layout()
        assert a["glbBytes"] == (ROOT / a["glb"]).stat().st_size, f"{cid}: registry is stale, rerun validate"


def test_previews_are_pngs_under_budget():
    names = [f"{cid.lower()}-sheet.png" for cid in IDS] + ["ch-ceo-deform.png", "ch-ceo-variants.png",
                                                            "character-expressions.png", "character-lod.png"]
    for n in names:
        p = ROOT / "assets" / "previews" / n
        if not p.exists():
            pytest.skip(f"{n} missing; run blender/characters/render_sheet.py")
        assert p.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
        assert p.stat().st_size <= CHARS["budgets"]["previewBytesMax"], (n, p.stat().st_size)


def test_validation_report_passed():
    rep = ROOT / "docs" / "evidence" / "HARDENING" / "blender-characters-validate.json"
    if not rep.exists():
        pytest.skip("run blender/validate_assets.py")
    data = json.loads(rep.read_text(encoding="utf-8"))
    assert data["passed"] is True
    assert sorted(data["characters"]) == sorted(IDS)
    for cid, c in data["characters"].items():
        clips = c["blend_report"]["clips"]
        for gait in ("walk", "run"):
            assert clips[gait]["slip_ratio"] < 0.05, (cid, gait, clips[gait])
        assert all(c["lod1_bbox_dev_m"] <= 0.03 for c in clips.values()), cid
