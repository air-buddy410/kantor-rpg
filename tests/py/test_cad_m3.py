"""M3 drawing set: every sheet in design/sheets.json regenerated into a tmp dir,
reopened, and checked against world.json / ict-portmap.json with helpers
written independently of the generator. Negative cases prove the helpers bite."""
import copy
import importlib.util
import json
import re
import subprocess
from pathlib import Path

import ezdxf
import pytest
from pypdf import PdfReader

from tools.kantor.geometry import polygon_area

ROOT = Path(__file__).resolve().parents[2]
PT_PER_MM = 72 / 25.4
PAPER = {"A2": (594, 420), "A3": (420, 297)}
SHEETS = json.loads((ROOT / "design" / "sheets.json").read_text(encoding="utf-8"))["sheets"]
PORTMAP = json.loads((ROOT / "design" / "derived" / "ict-portmap.json").read_text(encoding="utf-8"))
APPID = "KANTOR_RPG"


def _load_generator():
    spec = importlib.util.spec_from_file_location("cad_generate_m3", ROOT / "cad" / "generate.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


gen = _load_generator()


@pytest.fixture(scope="module")
def built(tmp_path_factory, world_master):
    out = tmp_path_factory.mktemp("set")
    dirs = {k: out / k for k in ("dxf", "pdf", "prev")}
    world = copy.deepcopy(world_master)
    results = gen.build_set(SHEETS, world, dirs["dxf"], dirs["pdf"], dirs["prev"], "2026-10-01T00:00:00Z", "0" * 64,
                            previews=False, portmap=copy.deepcopy(PORTMAP))
    sets = gen.consolidate({"project": "kantor-rpg", "sheets": SHEETS}, dirs["pdf"])
    return {"results": results, "sets": sets, "dirs": dirs, "out": out}


def pdf_text(path):
    # -raw keeps content-stream order, so a table row stays on one line even
    # where the rotated watermark confuses -layout's column analysis.
    return subprocess.run(["pdftotext", "-raw", str(path), "-"], capture_output=True, text=True,
                          check=True).stdout


def xdata_ids(doc, kind):
    ids = {}
    for space in [doc.modelspace()] + [lay for lay in doc.layouts if not lay.is_modelspace]:
        for e in space:
            if e.has_xdata(APPID):
                tags = [t.value for t in e.get_xdata(APPID)]
                if tags[0] == kind:
                    ids.setdefault(tags[1], []).append((e, tags[2:]))
    return ids


# ---------------------------------------------------------------- independent consistency helpers

def check_room_schedule(text, world):
    errors = []
    lines = text.splitlines()
    for r in world["rooms"]:
        want = f"{polygon_area(r['polygon']):.2f}".replace(".", ",")
        hit = [ln for ln in lines if re.search(rf"(^|\s){re.escape(r['id'])}\s", ln)]
        if not hit:
            errors.append(f"{r['id']}: missing")
        elif not any(re.search(rf"\s{re.escape(want)}\s", ln) for ln in hit):
            errors.append(f"{r['id']}: area {want} not on its row")
    for f in world["floors"]:
        total = sum(polygon_area(r["polygon"]) for r in world["rooms"] if r["floor"] == f["id"])
        env = polygon_area(f["envelope"])
        sub = [ln for ln in lines if f"Subtotal {f['id']}" in ln]
        if not sub:
            errors.append(f"{f['id']}: no subtotal row")
            continue
        if f"{total:.2f}".replace(".", ",") not in sub[0]:
            errors.append(f"{f['id']}: subtotal {total:.2f} not printed")
        if abs(total - env) > 0.01:
            errors.append(f"{f['id']}: rooms {total:.2f} != envelope {env:.2f}")
    return errors


def check_ids_in(text, ids):
    return sorted(i for i in ids if not re.search(rf"(?<![\w-]){re.escape(i)}(?![\w-])", text))


def check_port_schedule(text, portmap):
    errors = []
    lengths = []
    for c in portmap["cables"]:
        m = re.search(rf"{re.escape(c['cable'])}\s.*?\s(\d+,\d)\s", text)
        if not m:
            errors.append(f"{c['cable']}: missing")
            continue
        lengths.append(float(m.group(1).replace(",", ".")))
        if abs(lengths[-1] - c["length_m"]) > 0.05:
            errors.append(f"{c['cable']}: length {lengths[-1]} != {c['length_m']}")
    if abs(sum(lengths) - portmap["totals"]["cable_m"]) > 0.05:
        errors.append(f"sum of rows {sum(lengths):.1f} != portmap total {portmap['totals']['cable_m']}")
    return errors


def routes_per_floor(dxf_path):
    doc = ezdxf.readfile(dxf_path)
    per = {}
    for e in doc.modelspace().query('LWPOLYLINE[layer=="ICT-ROUT"]'):
        tags = [t.value for t in e.get_xdata(APPID)]
        floor = next(t.split("=", 1)[1] for t in tags[2:] if t.startswith("floor="))
        per.setdefault(floor, set()).add(tags[1])
    return {k: len(v) for k, v in per.items()}


# ---------------------------------------------------------------- every sheet

@pytest.mark.parametrize("sheet", SHEETS, ids=[s["id"] for s in SHEETS])
def test_sheet_dxf_reopens_with_title_block(built, sheet, world_master):
    r = built["results"][sheet["id"]]
    doc = ezdxf.readfile(r["dxf"])
    aud = doc.audit()
    assert not aud.has_errors, [str(e) for e in aud.errors]
    assert doc.header["$INSUNITS"] == 4
    assert dict(doc.header.custom_vars)["KR_SHEET_ID"] == sheet["id"]
    layouts = [lay for lay in doc.layouts if not lay.is_modelspace]
    assert len(layouts) == r["pages"]
    for lay in layouts:
        refs = [i for i in lay.query("INSERT") if i.has_attrib("KR_SHEET_ID")]
        assert refs, f"{lay.name}: no title block"
        assert refs[0].get_attrib_text("KR_SHEET_ID") == sheet["id"]
        assert refs[0].get_attrib_text("KR_REVISION") == world_master["revision"]["id"]
        assert refs[0].get_attrib_text("KR_SCALE") == f"{sheet['scale']} @ {sheet['size']}"
    assert not list(Path(r["dxf"]).parent.glob("*.dwg"))


@pytest.mark.parametrize("sheet", SHEETS, ids=[s["id"] for s in SHEETS])
def test_sheet_pdf_size_and_text(built, sheet, world_master):
    r = built["results"][sheet["id"]]
    reader = PdfReader(str(r["pdf"]))
    w_mm, h_mm = PAPER[sheet["size"]]
    for page in reader.pages:
        assert float(page.mediabox.width) == pytest.approx(w_mm * PT_PER_MM, abs=1.0)
        assert float(page.mediabox.height) == pytest.approx(h_mm * PT_PER_MM, abs=1.0)
        assert len(page.images) == 0
    text = pdf_text(r["pdf"])
    for tok in (sheet["id"], world_master["revision"]["id"], sheet["scale"], "KONSEP"):
        assert tok in text, tok
    assert chr(0x2014) not in text
    # Every page carries the sheet ID and the concept status.
    for i in range(1, len(reader.pages) + 1):
        pt = subprocess.run(["pdftotext", "-f", str(i), "-l", str(i), str(r["pdf"]), "-"], capture_output=True,
                            text=True, check=True).stdout
        assert sheet["id"] in pt and "KONSEP" in pt


# ---------------------------------------------------------------- data consistency

def test_room_schedule_matches_world(built, world_master):
    text = pdf_text(built["results"]["A-103"]["pdf"])
    assert check_room_schedule(text, world_master) == []
    assert text.count("COCOK") >= 2 and "TIDAK COCOK" not in text
    checks = built["results"]["A-103"]["summary"]["checks"]
    assert all(c["ok"] and c["total_m2"] == 768.0 for c in checks.values())


def test_room_schedule_helper_detects_wrong_area(built, world):
    text = pdf_text(built["results"]["A-103"]["pdf"])
    room = next(r for r in world["rooms"] if r["id"] == "L1-NOVA")
    room["polygon"] = [[20, 10.5], [26.5, 10.5], [26.5, 16.5], [20, 16.5]]
    errors = check_room_schedule(text, world)
    assert any(e.startswith("L1-NOVA: area") for e in errors), errors
    assert any(e.startswith("L1:") for e in errors), errors


@pytest.mark.parametrize("sid,floor", [("A-201", "L1"), ("A-202", "L2")])
def test_furniture_sheet_has_every_fixture(built, world_master, sid, floor):
    r = built["results"][sid]
    want = {f["id"] for f in world_master["fixtures"] if f["floor"] == floor}
    assert check_ids_in(pdf_text(r["pdf"]), want) == []
    doc = ezdxf.readfile(r["dxf"])
    assert want <= set(xdata_ids(doc, "fixture"))
    other = {f["id"] for f in world_master["fixtures"] if f["floor"] != floor}
    assert not other & set(xdata_ids(doc, "fixture"))
    assert r["summary"]["fixtures"] == len(want)


def test_furniture_check_detects_missing_fixture(world, world_master, tmp_path):
    world["fixtures"] = [f for f in world["fixtures"] if f["id"] != "FX-L1-045"]
    sheet = next(s for s in SHEETS if s["id"] == "A-201")
    r = gen.build_sheet(sheet, world, tmp_path, tmp_path, tmp_path, "2026-10-01T00:00:00Z", "0" * 64, previews=False)
    want = {f["id"] for f in world_master["fixtures"] if f["floor"] == "L1"}
    assert check_ids_in(pdf_text(r["pdf"]), want) == ["FX-L1-045"]


@pytest.mark.parametrize("sid,floor", [("ICT-101", "L1"), ("ICT-102", "L2")])
def test_ict_plan_ids_and_no_wet_cameras(built, world_master, sid, floor):
    r = built["results"][sid]
    ict = world_master["ict"]
    outlets = {o["id"] for o in ict["outlets"] if o["floor"] == floor}
    devices = {d["id"] for d in ict["devices"] if d["floor"] == floor}
    text = pdf_text(r["pdf"])
    assert check_ids_in(text, outlets | devices) == []
    doc = ezdxf.readfile(r["dxf"])
    assert outlets <= set(xdata_ids(doc, "outlet"))
    assert devices <= set(xdata_ids(doc, "device"))
    wet = {rm["id"] for rm in world_master["rooms"] if rm["category"] == "wet"}
    cams = [d for d in ict["devices"] if d["floor"] == floor and d["type"] == "camera"]
    assert cams and not [d["id"] for d in cams if d["room"] in wet]
    assert r["summary"]["wet_room_cameras"] == []
    assert "placeholder" in text
    assert "radius" not in text.lower().replace("radius wi-fi", "")


def test_ict_plan_refuses_camera_in_wet_room(world, tmp_path):
    cam = next(d for d in world["ict"]["devices"] if d["id"] == "CAM-L1-02")
    cam["room"] = "L1-WC"
    sheet = next(s for s in SHEETS if s["id"] == "ICT-101")
    with pytest.raises(ValueError, match="camera in wet room"):
        gen.build_sheet(sheet, world, tmp_path, tmp_path, tmp_path, "2026-10-01T00:00:00Z", "0" * 64,
                        previews=False)


def test_rack_elevation_devices_and_u(built, world_master):
    r = built["results"]["ICT-201"]
    lines = pdf_text(r["pdf"]).splitlines()
    doc = ezdxf.readfile(r["dxf"])
    xd = xdata_ids(doc, "rack_device")
    for rack in world_master["ict"]["racks"]:
        for d in rack["contents"]:
            row = [ln for ln in lines if re.search(rf"{rack['id']}\s+U{d['u']}\s+{d['height']}\s+{d['device']}\s", ln)]
            assert row, f"{rack['id']} U{d['u']} {d['device']} missing from contents table"
            us = [t for e, extra in xd[d["device"]] for t in extra if t.startswith("u=")]
            assert f"u={d['u']}" in us
    assert r["summary"]["devices"] == sum(len(rk["contents"]) for rk in world_master["ict"]["racks"])


def test_port_schedule_matches_portmap(built):
    r = built["results"]["ICT-401"]
    text = pdf_text(r["pdf"])
    assert check_port_schedule(text, PORTMAP) == []
    assert r["summary"]["check"]["total_ok"]
    assert "belum divalidasi" in text and r["pages"] >= 2


def test_port_schedule_helper_detects_changed_total(built):
    text = pdf_text(built["results"]["ICT-401"]["pdf"])
    pm = copy.deepcopy(PORTMAP)
    pm["totals"]["cable_m"] += 5.0
    errors = check_port_schedule(text, pm)
    assert any(e.startswith("sum of rows") for e in errors), errors


def test_port_schedule_flags_inconsistent_portmap(world, tmp_path):
    pm = copy.deepcopy(PORTMAP)
    pm["totals"]["cable_m"] += 5.0
    ctx = gen.make_ctx(world, "0" * 64, "2026-10-01T00:00:00Z", tmp_path, portmap=pm)
    sheet = next(s for s in SHEETS if s["id"] == "ICT-401")
    r = gen.build_sheet(sheet, world, tmp_path, tmp_path, tmp_path, "2026-10-01T00:00:00Z", "0" * 64,
                        previews=False, ctx=ctx)
    assert r["summary"]["check"]["total_ok"] is False
    assert "TIDAK COCOK" in pdf_text(r["pdf"])


def test_pathways_route_count_per_floor(built):
    want = {}
    for c in PORTMAP["cables"]:
        want[c["floor"]] = want.get(c["floor"], 0) + 1
    assert routes_per_floor(built["results"]["ICT-301"]["dxf"]) == want
    assert built["results"]["ICT-301"]["summary"]["route_counts"] == want


def test_finish_plan_contrast_and_area(built, world_master):
    s = built["results"]["I-101"]["summary"]
    assert s["total_m2"] == pytest.approx(sum(polygon_area(r["polygon"]) for r in world_master["rooms"]))
    finishes = {r["finish"]["floor"] for r in world_master["rooms"]}
    assert set(s["finishes"]) == finishes
    text = pdf_text(built["results"]["I-101"]["pdf"])
    ratios = [float(x.replace(",", ".")) for x in re.findall(r"(?<![\d,])(\d+,\d):1(?!\d)", text)]
    # One ratio per finish row plus the "minimum 4,5:1" note.
    assert len(ratios) == len(finishes) + 1 and min(ratios) >= 4.5


def test_elevations_and_sections_from_world(built, world_master):
    ext = {d["id"] for d in world_master["doors"] if "EXT" in d["rooms"]}
    assert check_ids_in(pdf_text(built["results"]["A-301"]["pdf"]), ext) == []
    assert built["results"]["A-301"]["summary"]["exterior_doors_drawn"] == len(ext)
    cuts = built["results"]["A-401"]["summary"]["cuts"]
    assert "D-L1-ENT" in cuts["B"]["floors"]["L1"]["doors"]
    assert cuts["B"]["stair"]["risers"] == 24 and cuts["B"]["stair"]["landing_z"] == pytest.approx(2.0)
    assert "L1-CORE" in cuts["A"]["floors"]["L1"]["rooms"]


def test_topology_counts(built, world_master):
    s = built["results"]["ICT-001"]["summary"]
    devs = world_master["ict"]["devices"]
    assert s["aps"] == sum(1 for d in devs if d["type"] == "ap")
    assert s["cameras"] == sum(1 for d in devs if d["type"] == "camera")
    text = pdf_text(built["results"]["ICT-001"]["pdf"])
    assert "RANCANGAN VIRTUAL, BUKAN TOPOLOGI PRODUKSI" in text


def test_cover_index_lists_every_sheet(built):
    text = pdf_text(built["results"]["A-001"]["pdf"])
    assert check_ids_in(text, {s["id"] for s in SHEETS}) == []
    total = sum(r["pages"] for r in built["results"].values())
    assert f"{len(SHEETS)} lembar, {total} halaman" in text
    assert "BLOCKED" in text


# ---------------------------------------------------------------- consolidated sets and register

def expected_labels(results, sheets):
    out = []
    for s in sheets:
        n = results[s["id"]]["pages"]
        out += [s["id"]] if n == 1 else [f"{s['id']}-{i + 1}" for i in range(n)]
    return out


@pytest.mark.parametrize("fname,disc", gen.SETS)
def test_consolidated_pdf_pages_bookmarks_labels(built, fname, disc):
    sheets = [s for s in SHEETS if disc is None or s["discipline"] == disc]
    reader = PdfReader(str(built["dirs"]["pdf"] / fname))
    results = built["results"]
    assert len(reader.pages) == sum(results[s["id"]]["pages"] for s in sheets)
    assert len(reader.outline) == len(sheets)
    assert [o.title.split()[0] for o in reader.outline] == [s["id"] for s in sheets]
    assert list(reader.page_labels) == expected_labels(results, sheets)
    if disc is None:
        assert len(reader.outline) == 15


def test_register_written_for_all_sheets(built, tmp_path):
    reg_path = tmp_path / "register.json"
    reg = gen.write_register(list(built["results"].values()), {"project": "kantor-rpg", "sheets": SHEETS}, reg_path,
                             "pytest", "2026-10-01T00:00:00Z", None)
    assert [e["id"] for e in reg["sheets"]] == [s["id"] for s in SHEETS]
    for e in reg["sheets"]:
        assert e["status"] == "produced (konsep)"
        assert e["pdf_pages"] == built["results"][e["id"]]["pages"]
        assert e["native_dwg"].startswith("BLOCKED")


def test_committed_register_matches_files():
    reg = json.loads((ROOT / "drawings" / "register.json").read_text(encoding="utf-8"))
    import hashlib
    assert len(reg["sheets"]) == len(SHEETS)
    for e in reg["sheets"]:
        assert e["status"] == "produced (konsep)", e["id"]
        for f in e["files"].values():
            assert hashlib.sha256((ROOT / f["path"]).read_bytes()).hexdigest() == f["sha256"], f["path"]
    names = {Path(s["file"]).name for s in reg["sets"]}
    assert names == {f for f, _ in gen.SETS}
    for s in reg["sets"]:
        r = PdfReader(str(ROOT / s["file"]))
        assert len(r.pages) == s["pages"] and list(r.page_labels) == s["page_labels"]
    dwgs = list((ROOT / 'cad').rglob('*.dwg'))
    if dwgs:
        evidence = ROOT / 'docs/evidence/MAX/native-dwg/report.json'
        rows = {r['sheet']: r for r in json.loads(evidence.read_text())}
        assert len(dwgs) == len(SHEETS) == len(rows)
        for dwg in dwgs:
            row = rows[dwg.stem]
            assert dwg.read_bytes()[:6] == b'AC1032'
            assert hashlib.sha256(dwg.read_bytes()).hexdigest() == row['dwg_sha256']
            assert hashlib.sha256(dwg.with_suffix('.dxf').read_bytes()).hexdigest() == row['dxf_sha256']
            assert row['reopen'] and row['audit_errors'] == 0 and row['units'] == 4
            assert row['model_counts_match'] and row['paper_layouts']
