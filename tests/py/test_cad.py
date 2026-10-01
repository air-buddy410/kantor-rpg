"""CAD sheet A-101: DXF and PDF regenerated from world.json, then reopened and
compared against the dataset with checks written independently of the generator."""
import copy
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import ezdxf
import pytest
from pypdf import PdfReader

from tools.kantor.geometry import derive_walls, polygon_area

ROOT = Path(__file__).resolve().parents[2]
SHEET_ID = "A-101"
FLOOR = "L1"
PT_PER_MM = 72 / 25.4
REQUIRED_LAYERS = {"A-WALL", "A-DOOR", "A-AREA", "A-ANNO-RMNM", "A-FURN", "A-FURN-IDEN", "A-STRS",
                   "A-ANNO-DIMS", "A-GRID", "A-ANNO-TTLB"}


def _load_generator():
    spec = importlib.util.spec_from_file_location("cad_generate", ROOT / "cad" / "generate.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


gen = _load_generator()


def _sheet(sheet_id):
    sheets = json.loads((ROOT / "design" / "sheets.json").read_text(encoding="utf-8"))["sheets"]
    return next(s for s in sheets if s["id"] == sheet_id)


def _build(world, out, previews=False):
    return gen.build_sheet(_sheet(SHEET_ID), world, out / "cad", out / "pdf", out / "prev", "2026-10-01T00:00:00Z",
                           "0" * 64, previews=previews)


@pytest.fixture(scope="module")
def built(tmp_path_factory, world_master):
    out = tmp_path_factory.mktemp("cad")
    return _build(copy.deepcopy(world_master), out, previews=True)


def _xdata_ids(entity):
    if not entity.has_xdata(gen.APPID):
        return None
    tags = list(entity.get_xdata(gen.APPID))
    return tags[0].value, tags[1].value


def compare_dxf_to_world(dxf_path, world, floor):
    """Independent DXF vs dataset comparison; returns a list of mismatches."""
    errors = []
    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()
    tags = {}
    for e in msp.query('MTEXT[layer=="A-ANNO-RMNM"]'):
        lines = [ln.strip() for ln in e.plain_text().splitlines() if ln.strip()]
        tags[lines[0]] = lines
    outlines = {}
    for e in msp.query('LWPOLYLINE[layer=="A-AREA"]'):
        ident = _xdata_ids(e)
        if ident:
            outlines[ident[1]] = [(round(x / 1000, 6), round(y / 1000, 6)) for x, y in e.get_points("xy")]
    for room in (r for r in world["rooms"] if r["floor"] == floor):
        want = polygon_area(room["polygon"])
        lines = tags.get(room["id"])
        if not lines:
            errors.append(f"{room['id']}: no A-ANNO-RMNM tag")
            continue
        area_line = next((ln for ln in lines if ln.endswith("m²")), None)
        if area_line is None:
            errors.append(f"{room['id']}: tag has no area")
            continue
        got = float(area_line.split()[0].replace(",", "."))
        if abs(got - want) > 0.01:
            errors.append(f"{room['id']}: tag area {got} != world {want:.2f}")
        poly = outlines.get(room["id"])
        if poly is None:
            errors.append(f"{room['id']}: no A-AREA outline")
        elif abs(polygon_area(poly) - want) > 0.01:
            errors.append(f"{room['id']}: outline area {polygon_area(poly):.2f} != world {want:.2f}")
    return errors


# ---------------------------------------------------------------- DXF

def test_dxf_reopens_and_audits_clean(built):
    doc = ezdxf.readfile(built["dxf"])
    auditor = doc.audit()
    assert not auditor.has_errors, [str(e) for e in auditor.errors]
    assert doc.dxfversion == "AC1032"  # R2018
    assert doc.header["$INSUNITS"] == 4  # millimetres
    assert not list(Path(built["dxf"]).parent.glob("*.dwg")), "no DWG may be produced without a native tool"


def test_dxf_required_layers(built):
    doc = ezdxf.readfile(built["dxf"])
    names = {layer.dxf.name for layer in doc.layers}
    assert REQUIRED_LAYERS <= names, REQUIRED_LAYERS - names
    used = {e.dxf.layer for e in doc.modelspace()}
    assert REQUIRED_LAYERS - {"A-ANNO-TTLB"} <= used
    assert any(e.dxf.layer == "A-ANNO-TTLB" for e in doc.layouts.get(SHEET_ID))


def test_dxf_rooms_match_world(built, world):
    assert compare_dxf_to_world(built["dxf"], world, FLOOR) == []


def test_dxf_room_check_detects_off_grid_room(world, world_master, tmp_path):
    # Negative case: the generator draws a mutated world; comparing that DXF
    # with the committed world must flag the moved room.
    room = next(r for r in world["rooms"] if r["id"] == "L1-MEET")
    room["polygon"] = [[0, 0], [8.37, 0], [8.37, 8], [0, 8]]
    mutated = _build(world, tmp_path)
    errors = compare_dxf_to_world(mutated["dxf"], world_master, FLOOR)
    assert any(e.startswith("L1-MEET: tag area") for e in errors), errors
    assert any(e.startswith("L1-MEET: outline area") for e in errors), errors
    assert not any(e.startswith("L1-LOBBY") for e in errors)


def test_dxf_door_and_fixture_ids(built, world):
    msp = ezdxf.readfile(built["dxf"]).modelspace()
    door_x = {_xdata_ids(e)[1] for e in msp.query('*[layer=="A-DOOR"]') if _xdata_ids(e)}
    door_t = {e.dxf.text for e in msp.query('TEXT[layer=="A-DOOR-IDEN"]')}
    want_doors = {d["id"] for d in world["doors"] if d["floor"] == FLOOR}
    assert want_doors <= door_x, want_doors - door_x
    assert want_doors <= door_t, want_doors - door_t
    fx_x = {_xdata_ids(e)[1] for e in msp.query('LWPOLYLINE[layer=="A-FURN" | layer=="A-STRS"]') if _xdata_ids(e)}
    fx_t = {e.dxf.text for e in msp.query('TEXT[layer=="A-FURN-IDEN"]')}
    want_fx = {f["id"] for f in world["fixtures"] if f["floor"] == FLOOR}
    assert want_fx <= fx_x, want_fx - fx_x
    assert want_fx <= fx_t, want_fx - fx_t
    other = {f["id"] for f in world["fixtures"] if f["floor"] != FLOOR}
    assert not (fx_x & other)


def test_dxf_walls_count_and_extents(built, world):
    msp = ezdxf.readfile(built["dxf"]).modelspace()
    walls = list(msp.query('LWPOLYLINE[layer=="A-WALL"]'))
    # Each concept window (P03) splits one exterior wall piece in two.
    n_windows = sum(1 for w in world["windows"] if w["floor"] == FLOOR)
    assert len(walls) == len(derive_walls(world, FLOOR)[0]) + n_windows
    assert len(msp.query('HATCH[layer=="A-WALL"]')) == len(walls)
    pts = [p for w in walls for p in w.get_points("xy")]
    half = world["building"]["wall"]["exterior"] / 2 * 1000
    env = next(f for f in world["floors"] if f["id"] == FLOOR)["envelope"]
    w_mm = max(p[0] for p in env) * 1000
    h_mm = max(p[1] for p in env) * 1000
    assert min(p[0] for p in pts) == pytest.approx(-half)
    assert min(p[1] for p in pts) == pytest.approx(-half)
    assert max(p[0] for p in pts) == pytest.approx(w_mm + half)
    assert max(p[1] for p in pts) == pytest.approx(h_mm + half)
    assert (w_mm, h_mm) == (32000, 24000)


def test_dxf_dimensions_and_grid(built):
    msp = ezdxf.readfile(built["dxf"]).modelspace()
    dims = list(msp.query('DIMENSION[layer=="A-ANNO-DIMS"]'))
    measured = {round(d.get_measurement()) for d in dims}
    assert {32000, 24000} <= measured
    assert len(msp.query('LINE[layer=="A-GRID"]')) >= 4


def test_dxf_sheet_metadata_and_viewport(built):
    doc = ezdxf.readfile(built["dxf"])
    cv = dict(doc.header.custom_vars)
    assert cv["KR_SHEET_ID"] == SHEET_ID
    assert cv["KR_SCALE"] == "1:100 @ A2"
    assert cv["KR_STATUS"] == "KONSEP"
    ps = doc.layouts.get(SHEET_ID)
    vps = [v for v in ps.query("VIEWPORT") if v.dxf.id > 1]
    assert len(vps) == 1
    assert vps[0].dxf.view_height / vps[0].dxf.height == pytest.approx(100)
    ref = next(iter(ps.query('INSERT[name=="KR-TTLB"]')))
    assert ref.get_attrib_text("KR_SHEET_ID") == SHEET_ID
    assert ref.get_attrib_text("KR_REVISION") == cv["KR_REVISION"]


def test_counts_file_matches_dxf(built):
    counts = json.loads(Path(built["counts"]).read_text(encoding="utf-8"))
    msp = ezdxf.readfile(built["dxf"]).modelspace()
    assert counts["totals"]["modelspace"] == len(msp)
    assert counts["modelspace"]["A-WALL"]["LWPOLYLINE"] == counts["expected"]["walls"]


def test_dxf_preview_renders(built):
    png = Path(built["preview_dxf"])
    assert png.stat().st_size > 50_000
    from PIL import Image
    with Image.open(png) as im:
        assert im.size[0] >= 1500


# ---------------------------------------------------------------- PDF

def _pdf_text(pdf):
    out = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True)
    return out.stdout


def test_pdf_text_content(built, world):
    text = _pdf_text(built["pdf"])
    for token in (SHEET_ID, world["revision"]["id"], "1:100", "KONSEP", "Bukan untuk konstruksi", "32000", "24000",
                  "AS-DIM-01", "AS-DIM-05", "AS-OCC-02", "Max (supervisor) belum review"):
        assert token in text, token
    for room in (r for r in world["rooms"] if r["floor"] == FLOOR):
        assert room["id"] in text, room["id"]
        assert f"{polygon_area(room['polygon']):.2f}".replace(".", ",") in text, room["id"]
    for room in (r for r in world["rooms"] if r["floor"] != FLOOR):
        assert room["id"] not in text
    assert chr(0x2014) not in text  # house rule: no em dash on sheets


def test_pdf_page_is_a2_landscape_vector(built):
    reader = PdfReader(str(built["pdf"]))
    assert len(reader.pages) == 1
    page = reader.pages[0]
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    assert w == pytest.approx(594 * PT_PER_MM, abs=1.0)
    assert h == pytest.approx(420 * PT_PER_MM, abs=1.0)
    assert len(page.images) == 0  # drawn as vectors, not a raster of the DXF
    pypdf_text = page.extract_text()
    assert SHEET_ID in pypdf_text


def test_scale_bar_true_to_scale(built):
    sb = built["scale_bar"]
    assert sb["marks_m"] == [0, 1, 2, 5, 10]
    assert sb["x_pt"][-1] - sb["x_pt"][0] == pytest.approx(283.46, abs=0.01)
    for m, x in zip(sb["marks_m"], sb["x_mm"]):
        assert x - sb["x_mm"][0] == pytest.approx(m * 10.0)  # 1 m = 10 mm at 1:100
    # Independent of the layout: the helper itself scales with the denominator.
    assert gen.scale_bar_geometry(200)["length_mm"] == pytest.approx(50.0)


def test_plan_origin_maps_world_metres_to_paper(built):
    # One world metre must be exactly 10 mm on paper; the plan sits inside the frame.
    lay = built["layout"]
    ox, oy = lay["origin"]
    assert lay["frame"][0] < ox and ox + 320 < lay["panel"][0]
    assert lay["frame"][1] + 30 < oy and oy + 240 < lay["frame"][3]


def test_unknown_sheet_is_refused():
    assert gen.main(["--sheets", "X-999"]) == 2


def test_autocad_count_comparison_tool(built, tmp_path):
    # Simulates KRCOUNT output from the counts file; one changed number must fail.
    counts = json.loads(Path(built["counts"]).read_text(encoding="utf-8"))
    lines = [f"{layer} {kind} {n}" for layer, kinds in counts["modelspace"].items() for kind, n in kinds.items()]
    good = tmp_path / "ok.txt"
    good.write_text("\n".join(lines + [f"TOTAL MODELSPACE {counts['totals']['modelspace']}"]), encoding="utf-8")
    tool = [sys.executable, str(ROOT / "cad" / "autocad" / "compare_counts.py"), str(built["counts"])]
    assert subprocess.run(tool + [str(good)], capture_output=True).returncode == 0
    bad = tmp_path / "bad.txt"
    n = counts["modelspace"]["A-WALL"]["LWPOLYLINE"]
    tampered = good.read_text(encoding="utf-8").replace(f"A-WALL LWPOLYLINE {n}", f"A-WALL LWPOLYLINE {n - 1}")
    assert tampered != good.read_text(encoding="utf-8")
    bad.write_text(tampered, encoding="utf-8")
    assert subprocess.run(tool + [str(bad)], capture_output=True).returncode == 1
