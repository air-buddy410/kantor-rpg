"""Doors (swing, P03) and concept windows in the drawing set.

The generator reads doors[].swing and windows[] from world.json; these checks
reopen the written DXF/PDF and compare them with the dataset using helpers
written here, not the generator's own model. Negative cases mutate a copy of
the world and prove each helper or guard actually fails."""
import copy
import importlib.util
import json
import math
import re
import subprocess
import sys
from pathlib import Path

import ezdxf
import pytest

from tools.kantor.geometry import point_in_polygon

ROOT = Path(__file__).resolve().parents[2]
APPID = "KANTOR_RPG"
SHEETS = {s["id"]: s for s in json.loads((ROOT / "design" / "sheets.json").read_text(encoding="utf-8"))["sheets"]}
PLAN_SHEETS = {"A-101": "L1", "A-102": "L2", "A-201": "L1", "A-202": "L2", "ICT-101": "L1", "ICT-102": "L2"}
TOL_MM = 1.0


def _load_generator():
    spec = importlib.util.spec_from_file_location("cad_generate_openings", ROOT / "cad" / "generate.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


gen = _load_generator()
sys.path.insert(0, str(ROOT / "cad"))
from krcad.planmodel import OpeningDataError, build_plan  # noqa: E402


def build(world, ids, out):
    out.mkdir(parents=True, exist_ok=True)
    return {sid: gen.build_sheet(SHEETS[sid], world, out, out, out, "2026-10-01T00:00:00Z", "0" * 64,
                                 previews=False) for sid in ids}


@pytest.fixture(scope="module")
def built(tmp_path_factory, world_master):
    ids = list(PLAN_SHEETS) + ["A-103", "A-301", "A-401"]
    return build(copy.deepcopy(world_master), ids, tmp_path_factory.mktemp("openings"))


# ---------------------------------------------------------------- independent helpers

def xd(e):
    if not e.has_xdata(APPID):
        return None, None, {}
    tags = [t.value for t in e.get_xdata(APPID)]
    return tags[0], tags[1], dict(t.split("=", 1) for t in tags[2:] if "=" in t)


def span(item):
    """(axis, at, lo, hi) from world.json fields of a door or window."""
    axis = item["wallAxis"]
    c = item["center"][0] if axis == "x" else item["center"][1]
    at = item["center"][1] if axis == "x" else item["center"][0]
    return axis, at, c - item["width"] / 2, c + item["width"] / 2


def envelope_box(world, floor):
    env = next(f for f in world["floors"] if f["id"] == floor)["envelope"]
    return min(p[0] for p in env), min(p[1] for p in env), max(p[0] for p in env), max(p[1] for p in env)


def facade(world, w):
    x0, y0, x1, y1 = envelope_box(world, w["floor"])
    if w["wallAxis"] == "x":
        return {y0: "S", y1: "N"}.get(w["at"])
    return {x0: "W", x1: "E"}.get(w["at"])


def plan_window_errors(dxf_path, world, floor):
    """Window ids on A-GLAZ per floor, and each symbol's wall-face extent equal
    to centre +/- width/2 along the wall and at +/- t/2 across it."""
    errors = []
    lines = {}
    # A-101/A-102 write LINE; the generic sheet backend writes 2-point
    # LWPOLYLINEs. The 4-point sill board is left out: it projects past the jambs.
    for e in ezdxf.readfile(dxf_path).modelspace().query('LINE LWPOLYLINE[layer=="A-GLAZ"]'):
        kind, ident, _ = xd(e)
        if kind != "window":
            continue
        if e.dxftype() == "LINE":
            lines.setdefault(ident, []).extend([e.dxf.start, e.dxf.end])
        elif len(e) == 2:
            lines.setdefault(ident, []).extend(e.get_points("xy"))
    want = {w["id"]: w for w in world["windows"] if w["floor"] == floor}
    for wid in sorted(set(lines) - set(want)):
        errors.append(f"{wid}: drawn but not in dataset for {floor}")
    t = world["building"]["wall"]["exterior"]
    for wid, w in sorted(want.items()):
        pts = lines.get(wid)
        if not pts:
            errors.append(f"{wid}: missing")
            continue
        axis, at, lo, hi = span(w)
        us = [p[0] if axis == "x" else p[1] for p in pts]
        vs = [p[1] if axis == "x" else p[0] for p in pts]
        if abs(min(us) - lo * 1000) > TOL_MM or abs(max(us) - hi * 1000) > TOL_MM:
            errors.append(f"{wid}: along-wall extent {min(us):.0f}-{max(us):.0f} != {lo * 1000:.0f}-{hi * 1000:.0f}")
        if abs(min(vs) - (at - t / 2) * 1000) > TOL_MM or abs(max(vs) - (at + t / 2) * 1000) > TOL_MM:
            errors.append(f"{wid}: not in the wall at {at}")
    return errors


def plan_door_arc_errors(dxf_path, world, floor):
    """Every swing door: one arc per leaf, arc centre on the dataset hinge
    jamb (within 1 mm, on the wall face) and the arc on the swing.into side."""
    errors = []
    arcs = {}
    for e in ezdxf.readfile(dxf_path).modelspace().query('ARC[layer=="A-DOOR"]'):
        kind, ident, _ = xd(e)
        if kind == "door":
            arcs.setdefault(ident, []).append(e)
    rooms = {r["id"]: r["polygon"] for r in world["rooms"] if r["floor"] == floor}
    x0, y0, x1, y1 = envelope_box(world, floor)
    for d in (d for d in world["doors"] if d["floor"] == floor):
        got = arcs.get(d["id"], [])
        sw = d.get("swing")
        if not sw:
            if got:
                errors.append(f"{d['id']}: {d['type']} drawn with an arc")
            continue
        axis, at, lo, hi = span(d)
        jambs = {"low": [lo], "high": [hi], "both": [lo, hi]}[sw["hinge"]]
        if len(got) != len(jambs):
            errors.append(f"{d['id']}: {len(got)} arcs, want {len(jambs)}")
            continue
        exterior = at in ((y0, y1) if axis == "x" else (x0, x1))
        t = world["building"]["wall"]["exterior" if exterior else "interior"]
        centres = []
        for a in got:
            cx, cy = a.dxf.center.x / 1000, a.dxf.center.y / 1000
            u, v = (cx, cy) if axis == "x" else (cy, cx)
            centres.append(u)
            if abs(abs(v - at) - t / 2) * 1000 > TOL_MM:
                errors.append(f"{d['id']}: arc centre {v:.3f} is not on the wall face at {at} +/- {t / 2}")
            r = a.dxf.radius / 1000
            mid = math.radians(a.dxf.start_angle + ((a.dxf.end_angle - a.dxf.start_angle) % 360) / 2)
            pm = (cx + r * math.cos(mid), cy + r * math.sin(mid))
            if sw["into"] == "EXT":
                inside = x0 < pm[0] < x1 and y0 < pm[1] < y1
                if inside:
                    errors.append(f"{d['id']}: arc lies inside the envelope, swing.into is EXT")
            elif not point_in_polygon(pm, rooms[sw["into"]]):
                errors.append(f"{d['id']}: arc midpoint {pm[0]:.2f},{pm[1]:.2f} is not in {sw['into']}")
        for j in jambs:
            if not any(abs(u - j) * 1000 <= TOL_MM for u in centres):
                errors.append(f"{d['id']}: no arc centred on hinge jamb {j:.3f} ({sw['hinge']})")
    return errors


def elevation_errors(dxf_path, world):
    """Per facade: window set equal to the dataset; each window rectangle at
    u -/+ width/2 and floor elevation + sill/head; exterior swing doors carry a
    hinge mark whose apex sits on the dataset hinge jamb."""
    errors = []
    msp = ezdxf.readfile(dxf_path).modelspace()
    origin, wins, hinges = {}, {}, {}
    for e in msp.query("LWPOLYLINE"):
        kind, ident, extra = xd(e)
        pts = list(e.get_points("xy"))
        if kind == "facade":
            origin[ident] = (min(p[0] for p in pts), min(p[1] for p in pts))
        elif kind == "window" and e.dxf.layer == "A-ELEV-GLAZ":
            wins.setdefault(extra["facade"], {})[ident] = pts
        elif kind == "door" and "hinge_u" in extra:
            hinges.setdefault(ident, []).append(pts[1])
    x0, y0, x1, y1 = envelope_box(world, world["floors"][0]["id"])
    umap = {"S": lambda x, y: x - x0, "N": lambda x, y: x1 - x, "E": lambda x, y: y - y0, "W": lambda x, y: y1 - y}
    elev = {f["id"]: f["elevation"] for f in world["floors"]}
    for key in "SENW":
        want = {w["id"]: w for w in world["windows"] if facade(world, w) == key}
        got = wins.get(key, {})
        if set(got) != set(want):
            errors.append(f"{key}: windows {sorted(got)} != dataset {sorted(want)}")
        ox, oy = origin[key]
        for wid, w in want.items():
            if wid not in got:
                continue
            u = umap[key](*w["center"])
            xs, ys = [p[0] for p in got[wid]], [p[1] for p in got[wid]]
            exp = (ox + (u - w["width"] / 2) * 1000, oy + (elev[w["floor"]] + w["sill"]) * 1000,
                   ox + (u + w["width"] / 2) * 1000, oy + (elev[w["floor"]] + w["head"]) * 1000)
            if any(abs(a - b) > TOL_MM for a, b in zip((min(xs), min(ys), max(xs), max(ys)), exp)):
                errors.append(f"{wid}: rectangle {min(xs):.0f},{min(ys):.0f}-{max(xs):.0f},{max(ys):.0f} != {exp}")
    for d in world["doors"]:
        if "EXT" not in d["rooms"] or not d.get("swing"):
            continue
        key = facade(world, {"wallAxis": d["wallAxis"], "at": span(d)[1], "floor": d["floor"]})
        if key is None:
            continue
        axis, at, lo, hi = span(d)
        jambs = {"low": [lo], "high": [hi], "both": [lo, hi]}[d["swing"]["hinge"]]
        want_x = sorted(origin[key][0] + umap[key](*((j, at) if axis == "x" else (at, j))) * 1000 for j in jambs)
        got_x = sorted(p[0] for p in hinges.get(d["id"], []))
        if len(got_x) != len(want_x) or any(abs(a - b) > TOL_MM for a, b in zip(got_x, want_x)):
            errors.append(f"{d['id']}: hinge marks at {got_x} != {want_x}")
    return errors


def section_window_ids(dxf_path):
    ids = set()
    for e in ezdxf.readfile(dxf_path).modelspace():
        kind, ident, _ = xd(e)
        if kind == "window" and e.dxf.layer == "A-SECT-GLAZ":
            ids.add(ident)
    return ids


def windows_cut(world, cuts):
    out = set()
    for c in cuts.values():
        want_axis = "y" if c["axis"] == "X" else "x"
        for w in world["windows"]:
            axis, at, lo, hi = span(w)
            if axis == want_axis and lo < c["at"] < hi:
                out.add(w["id"])
    return out


def pdf_page_text(path, page):
    return subprocess.run(["pdftotext", "-raw", "-f", str(page), "-l", str(page), str(path), "-"],
                          capture_output=True, text=True, check=True).stdout


def m(v):
    return f"{v:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def schedule_errors(text, world):
    errors = []
    lines = text.splitlines()
    for d in world["doors"]:
        row = [ln for ln in lines if ln.startswith(d["id"] + " ")]
        if len(row) != 1:
            errors.append(f"{d['id']}: {len(row)} rows")
            continue
        sw = d.get("swing")
        for tok in [d["floor"], d["type"], m(d["width"])] + ([sw["hinge"]] if sw else []):
            if not re.search(rf"(^|\s){re.escape(tok)}(\s|$)", row[0]):
                errors.append(f"{d['id']}: '{tok}' not on its row")
        if sw and sw["into"] not in row[0]:
            errors.append(f"{d['id']}: swing.into {sw['into']} not on its row")
    for w in world["windows"]:
        row = [ln for ln in lines if ln.startswith(w["id"] + " ")]
        if len(row) != 1:
            errors.append(f"{w['id']}: {len(row)} rows")
            continue
        if not re.search(rf"\s{re.escape(m(w['width']))}\s+{re.escape(m(w['sill']))}\s+{re.escape(m(w['head']))}\s",
                         row[0]):
            errors.append(f"{w['id']}: width/sill/head {m(w['width'])} {m(w['sill'])} {m(w['head'])} not on its row")
        if w["room"] not in row[0] or ("buram" if w["glazing"] == "obscured" else "bening") not in row[0]:
            errors.append(f"{w['id']}: room or glazing missing")
    n_rows = sum(1 for ln in lines if re.match(r"^[DW]-L\d-\w+ ", ln))
    if n_rows != len(world["doors"]) + len(world["windows"]):
        errors.append(f"{n_rows} schedule rows != {len(world['doors'])} doors + {len(world['windows'])} windows")
    return errors


def leaves_per_floor(world, floor):
    return sum({"single": 1, "double": 2}.get(d["type"], 0) for d in world["doors"] if d["floor"] == floor)


# ---------------------------------------------------------------- positive checks

@pytest.mark.parametrize("sid", list(PLAN_SHEETS))
def test_plan_windows_match_dataset(built, world_master, sid):
    floor = PLAN_SHEETS[sid]
    assert plan_window_errors(built[sid]["dxf"], world_master, floor) == []
    counts = json.loads(Path(built[sid]["counts"]).read_text(encoding="utf-8"))["openings"]
    want = sum(1 for w in world_master["windows"] if w["floor"] == floor)
    assert counts["window_symbols"] == want and counts["windows_per_floor"] == {floor: want}


@pytest.mark.parametrize("sid", list(PLAN_SHEETS))
def test_plan_door_arcs_on_hinge_and_into_side(built, world_master, sid):
    floor = PLAN_SHEETS[sid]
    assert plan_door_arc_errors(built[sid]["dxf"], world_master, floor) == []
    counts = json.loads(Path(built[sid]["counts"]).read_text(encoding="utf-8"))["openings"]
    assert counts["door_arcs"] == counts["door_leaves"] == leaves_per_floor(world_master, floor)


def short_tag(win_id):
    """Drawing tag written independently of the generator: W + window number."""
    return "W" + str(int(win_id.rsplit("-", 1)[1]))


def dxf_tag_map(dxf_path, layer):
    """{window id: [TEXT strings]} and {window id: closed hexagons} on a tag layer."""
    texts, shapes = {}, {}
    for e in ezdxf.readfile(dxf_path).modelspace().query(f'TEXT LWPOLYLINE[layer=="{layer}"]'):
        kind, ident, _ = xd(e)
        if kind != "window":
            continue
        if e.dxftype() == "TEXT":
            texts.setdefault(ident, []).append(e.dxf.text)
        elif e.closed and len(e) == 6:
            shapes[ident] = shapes.get(ident, 0) + 1
    return texts, shapes


def test_plan_window_tags_legible_and_clear(built, world_master):
    """Short tag per window on the plans: placed clear of swings, door tags and
    extension lines; >= 2,5 mm when the A2 sheet is printed on A3; one TEXT and
    one hexagon per window in the DXF carrying the full window ID in xdata."""
    a3_scale = min(1.0, 420 / 594, 297 / 420)
    for sid in ("A-101", "A-102"):
        plan = built[sid]["plan"]
        ids = {w["id"] for w in world_master["windows"] if w["floor"] == PLAN_SHEETS[sid]}
        assert {w["id"] for w in plan["windows"]} == ids
        assert all(w["tag_overlap_m2"] == 0 for w in plan["windows"]), sid
        assert all(w["tag_text"] == short_tag(w["id"]) for w in plan["windows"]), sid
        assert all(w["tag_size"] * 25.4 / 72 * a3_scale >= 2.5 for w in plan["windows"]), sid
        texts, shapes = dxf_tag_map(built[sid]["dxf"], "A-GLAZ-IDEN")
        assert texts == {i: [short_tag(i)] for i in ids}, sid
        assert shapes == {i: 1 for i in ids}, sid
        words = subprocess.run(["pdftotext", str(built[sid]["pdf"]), "-"], capture_output=True, text=True,
                               check=True).stdout.split()
        assert {i: words.count(short_tag(i)) for i in ids} == {i: 1 for i in ids}, sid


def test_elevation_and_section_window_tags(built, world_master):
    texts, shapes = dxf_tag_map(built["A-301"]["dxf"], "A-ELEV-GLAZ-IDEN")
    assert texts == {w["id"]: [short_tag(w["id"])] for w in world_master["windows"]}
    assert shapes == {w["id"]: 1 for w in world_master["windows"]}
    assert built["A-301"]["summary"]["window_tag_pt"] * 25.4 / 72 >= 2.5  # A3 prints at 1:1 on A3
    texts, _ = dxf_tag_map(built["A-401"]["dxf"], "A-SECT-IDEN")
    assert texts == {"W-L1-016": ["W16"]}


def test_plan_layers_present(built):
    doc = ezdxf.readfile(built["A-101"]["dxf"])
    used = {e.dxf.layer for e in doc.modelspace()}
    assert {"A-GLAZ", "A-GLAZ-IDEN"} <= used


def test_elevations_windows_per_facade(built, world_master):
    assert elevation_errors(built["A-301"]["dxf"], world_master) == []
    per = built["A-301"]["summary"]["windows_per_facade"]
    for key in "SENW":
        assert per[key] == sum(1 for w in world_master["windows"] if facade(world_master, w) == key)
    assert sum(per.values()) == len(world_master["windows"])
    counts = json.loads(Path(built["A-301"]["counts"]).read_text(encoding="utf-8"))["openings"]
    assert counts["window_symbols"] == len(world_master["windows"])
    ext_swing = [d for d in world_master["doors"] if "EXT" in d["rooms"] and d.get("swing")]
    assert counts["elevation_hinge_marks"] == sum(2 if d["swing"]["hinge"] == "both" else 1 for d in ext_swing)


def test_section_shows_every_cut_window(built, world_master):
    cuts = built["A-401"]["summary"]["cuts"]
    want = windows_cut(world_master, cuts)
    assert want == {"W-L1-016"}  # documents the current cut lines; the helper below is generic
    assert section_window_ids(built["A-401"]["dxf"]) == want
    assert {w for c in cuts.values() for fl in c["floors"].values() for w in fl["windows"]} == want


def test_schedule_rows_equal_dataset(built, world_master):
    r = built["A-103"]
    summ = r["summary"]["opening_schedule"]
    assert summ["door_rows"] == len(world_master["doors"]) and summ["window_rows"] == len(world_master["windows"])
    assert r["pages"] == summ["page"]
    assert schedule_errors(pdf_page_text(r["pdf"], summ["page"]), world_master) == []
    doc = ezdxf.readfile(r["dxf"])
    lay = doc.layouts.get(f"A-103-{summ['page']}")
    ids = {xd(e)[1] for e in lay if xd(e)[0] in ("door", "window")}
    assert ids == {d["id"] for d in world_master["doors"]} | {w["id"] for w in world_master["windows"]}


def test_titleblock_revision_is_world_revision(built, world_master):
    rev = world_master["revision"]["id"]
    assert rev == "P03"
    for r in built.values():
        doc = ezdxf.readfile(r["dxf"])
        assert dict(doc.header.custom_vars)["KR_REVISION"] == rev
        for lay in (x for x in doc.layouts if not x.is_modelspace):
            for ref in lay.query("INSERT"):
                if ref.has_attrib("KR_REVISION"):
                    assert ref.get_attrib_text("KR_REVISION") == rev


def test_committed_outputs_match_dataset(world_master):
    """The files in cad/out and drawings/ were regenerated from this world."""
    rev = world_master["revision"]["id"]
    index = json.loads((ROOT / "cad" / "out" / "counts.json").read_text(encoding="utf-8"))["sheets"]
    assert set(index) == set(SHEETS)
    for sid in SHEETS:
        assert index[sid]["world_revision"] == rev, sid
        dxf = ROOT / "cad" / "out" / f"{sid}.dxf"
        assert dict(ezdxf.readfile(dxf).header.custom_vars)["KR_REVISION"] == rev, sid
    for sid, floor in PLAN_SHEETS.items():
        assert plan_window_errors(ROOT / "cad" / "out" / f"{sid}.dxf", world_master, floor) == [], sid
        assert plan_door_arc_errors(ROOT / "cad" / "out" / f"{sid}.dxf", world_master, floor) == [], sid
        assert index[sid]["openings"]["door_arcs"] == leaves_per_floor(world_master, floor)
    assert elevation_errors(ROOT / "cad" / "out" / "A-301.dxf", world_master) == []
    reg = json.loads((ROOT / "drawings" / "register.json").read_text(encoding="utf-8"))
    assert {e["revision"] for e in reg["sheets"]} == {rev}


# ---------------------------------------------------------------- negative cases

def test_missing_swing_raises(world):
    d = next(x for x in world["doors"] if x["id"] == "D-L1-15")
    del d["swing"]
    with pytest.raises(OpeningDataError, match="D-L1-15"):
        build_plan(world, "L1", 100, with_tags=False)


def test_swing_into_foreign_room_raises(world):
    d = next(x for x in world["doors"] if x["id"] == "D-L1-02")
    d["swing"]["into"] = "L1-CEO"
    with pytest.raises(OpeningDataError, match="D-L1-02"):
        build_plan(world, "L1", 100, with_tags=False)


def test_window_over_door_raises(world):
    w = next(x for x in world["windows"] if x["id"] == "W-L1-003")
    w["center"] = [0, 9.25]  # on D-L1-EXW
    with pytest.raises(OpeningDataError, match="W-L1-003"):
        build_plan(world, "L1", 100, with_tags=False)


def test_moved_window_is_caught(world, world_master, tmp_path):
    w = next(x for x in world["windows"] if x["id"] == "W-L1-001")
    w["center"] = [w["center"][0] + 0.6, w["center"][1]]
    r = build(world, ["A-101", "A-301"], tmp_path)
    plan_err = plan_window_errors(r["A-101"]["dxf"], world_master, "L1")
    assert plan_err and all(e.startswith("W-L1-001") for e in plan_err), plan_err
    elev_err = elevation_errors(r["A-301"]["dxf"], world_master)
    assert elev_err and all(e.startswith("W-L1-001") for e in elev_err), elev_err


def test_removed_window_is_caught(world, world_master, tmp_path):
    world["windows"] = [w for w in world["windows"] if w["id"] != "W-L2-032"]
    r = build(world, ["A-102", "A-301", "A-103"], tmp_path)
    assert plan_window_errors(r["A-102"]["dxf"], world_master, "L2") == ["W-L2-032: missing"]
    assert any(e.startswith("E: windows") for e in elevation_errors(r["A-301"]["dxf"], world_master))
    text = pdf_page_text(r["A-103"]["pdf"], r["A-103"]["summary"]["opening_schedule"]["page"])
    errs = schedule_errors(text, world_master)
    assert "W-L2-032: 0 rows" in errs and any("schedule rows" in e for e in errs)


def test_flipped_hinge_is_caught(world, world_master, tmp_path):
    d = next(x for x in world["doors"] if x["id"] == "D-L1-15")
    d["swing"]["hinge"] = "high"
    r = build(world, ["A-101"], tmp_path)
    errs = plan_door_arc_errors(r["A-101"]["dxf"], world_master, "L1")
    assert errs and all(e.startswith("D-L1-15") for e in errs), errs


def test_swing_into_other_side_is_caught(world, world_master, tmp_path):
    d = next(x for x in world["doors"] if x["id"] == "D-L1-16")
    d["swing"]["into"] = "L1-NCORR"
    r = build(world, ["A-101"], tmp_path)
    errs = plan_door_arc_errors(r["A-101"]["dxf"], world_master, "L1")
    assert any(e.startswith("D-L1-16") and "not in L1-HUGO" in e for e in errs), errs
