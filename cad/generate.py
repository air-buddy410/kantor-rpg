"""Concept drawing generator: design/world.json -> DXF (mm) + vector PDF + previews.

Usage:
  python3 cad/generate.py --sheets A-101 A-102
  python3 cad/generate.py --all-available

Both the DXF and the PDF are drawn from one in-memory plan model built from the
world dataset (walls via tools/kantor/geometry.derive_walls), so a dimension,
door or fixture cannot differ between the two outputs. The PDF is drawn
directly with ReportLab; it is not a raster or a conversion of the DXF.

Native DWG is not produced here: AutoCAD is not available in the container
(see cad/AUTOCAD-RUNBOOK.md). Never rename the DXF to .dwg.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "cad"))

from tools.kantor.fonts import font_source_note, register  # noqa: E402
from tools.kantor.geometry import load_world  # noqa: E402

from krcad.common import *  # noqa: E402,F401,F403
from krcad.planmodel import build_plan  # noqa: E402,F401
from krcad.plansheet import sheet_layout, write_dxf, write_pdf  # noqa: E402,F401
from krcad.draw import write_dxf_doc, write_pdf_doc  # noqa: E402
from krcad.sheets_a import (build_cover, build_elevations, build_furniture, build_room_schedule,  # noqa: E402
                            build_sections)
from krcad.sheets_i import build_finish  # noqa: E402
from krcad.sheets_ict import (build_ict_plan, build_pathways, build_port_schedule, build_racks,  # noqa: E402
                              build_topology)

PORTMAP_PATH = ROOT / "design" / "derived" / "ict-portmap.json"
BUILDERS = {"index": build_cover, "room_schedule": build_room_schedule, "furniture": build_furniture,
            "elevations": build_elevations, "sections": build_sections, "finishes": build_finish,
            "topology": build_topology, "ict_plan": build_ict_plan, "rack_elevation": build_racks,
            "pathways": build_pathways, "port_schedule": build_port_schedule}
IMPLEMENTED_CONTENT = {"plan"} | set(BUILDERS)
SETS = [("kantor-rpg-sheets-all.pdf", None), ("kantor-rpg-sheets-A.pdf", "A"), ("kantor-rpg-sheets-I.pdf", "I"),
        ("kantor-rpg-sheets-ICT.pdf", "ICT")]

def dxf_counts(path: Path) -> dict:
    import ezdxf
    doc = ezdxf.readfile(path)
    out = {"file": path.name, "modelspace": {}, "paperspace": {}, "totals": {}}
    for name, space in (("modelspace", doc.modelspace()),):
        for e in space:
            out[name].setdefault(e.dxf.layer, {}).setdefault(e.dxftype(), 0)
            out[name][e.dxf.layer][e.dxftype()] += 1
    for layout in doc.layouts:
        if layout.is_modelspace:
            continue
        key = f"paperspace:{layout.name}"
        out["paperspace"][key] = {}
        for e in layout:
            out["paperspace"][key].setdefault(e.dxf.layer, {}).setdefault(e.dxftype(), 0)
            out["paperspace"][key][e.dxf.layer][e.dxftype()] += 1
    out["totals"]["modelspace"] = sum(sum(v.values()) for v in out["modelspace"].values())
    out["totals"]["paperspace"] = sum(sum(sum(v.values()) for v in lay.values()) for lay in out["paperspace"].values())
    out["layers"] = sorted(layer.dxf.name for layer in doc.layers)
    out["insunits"] = doc.header.get("$INSUNITS")
    out["dxfversion"] = doc.dxfversion
    return out


def opening_counts(path: Path) -> dict:
    """Window symbols and door leaves/arcs as found in the written DXF (model
    space and every layout), read back through the KANTOR_RPG xdata rather than
    taken from the in-memory model, so the counts describe the file."""
    import ezdxf
    doc = ezdxf.readfile(path)
    windows, leaves, arcs, hinge_marks = set(), 0, 0, 0
    per_floor = {}
    spaces = [doc.modelspace()] + [lay for lay in doc.layouts if not lay.is_modelspace]
    for space in spaces:
        for e in space:
            if not e.has_xdata(APPID):
                continue
            tags = [t.value for t in e.get_xdata(APPID)]
            extra = dict(t.split("=", 1) for t in tags[2:] if "=" in t)
            if tags[0] == "window" and e.dxf.layer in ("A-GLAZ", "A-ELEV-GLAZ", "A-SECT-GLAZ"):
                windows.add(tags[1])
            elif tags[0] == "door" and e.dxf.layer == "A-DOOR" and extra.get("type") in ("single", "double"):
                if e.dxftype() == "ARC":
                    arcs += 1
                elif e.dxftype() == "LINE" or (e.dxftype() == "LWPOLYLINE" and len(e) == 2):
                    leaves += 1
            elif tags[0] == "door" and e.dxf.layer == "A-ELEV-DOOR" and "hinge_u" in extra:
                hinge_marks += 1
    for wid in windows:
        fl = wid.split("-")[1]
        per_floor[fl] = per_floor.get(fl, 0) + 1
    return {"window_symbols": len(windows), "windows_per_floor": dict(sorted(per_floor.items())),
            "door_leaves": leaves, "door_arcs": arcs, "elevation_hinge_marks": hinge_marks}


def write_counts_index(out_dxf: Path) -> Path:
    """cad/out/counts.json: one index over every <ID>.counts.json on disk, so a
    partial --sheets run never leaves the index describing files it did not see."""
    sheets = {}
    for f in sorted(Path(out_dxf).glob("*.counts.json")):
        c = json.loads(f.read_text(encoding="utf-8"))
        sheets[c["sheet"]] = {"file": f.name, "world_revision": c["world_revision"],
                              "modelspace_total": c["totals"]["modelspace"],
                              "paperspace_total": c["totals"]["paperspace"], "openings": c.get("openings")}
    path = Path(out_dxf) / "counts.json"
    path.write_text(json.dumps({"note": "Indeks dari cad/out/<ID>.counts.json, ditulis oleh cad/generate.py",
                                "sheets": sheets}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def render_pdf_preview(pdf: Path, png: Path, dpi=50) -> list:
    """Page 1 -> <ID>.png, page n -> <ID>-p<n>.png."""
    png.parent.mkdir(parents=True, exist_ok=True)
    out = []
    for i in range(1, _pdf_pages(pdf) + 1):
        stem = png.with_suffix("") if i == 1 else png.with_name(f"{png.stem}-p{i}")
        subprocess.run(["pdftoppm", "-r", str(dpi), "-f", str(i), "-l", str(i), "-png", "-singlefile", str(pdf),
                        str(stem)], check=True)
        out.append(stem.with_suffix(".png"))
    return out


def render_dxf_preview(dxf: Path, png: Path) -> None:
    """Draw model space (or the first layout when model space is empty, as on
    table sheets) with ezdxf's renderer: proves the DXF reopens and draws."""
    import ezdxf
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from ezdxf.addons.drawing import Frontend, RenderContext
    from ezdxf.addons.drawing.config import BackgroundPolicy, Configuration
    from ezdxf.addons.drawing.matplotlib import MatplotlibBackend

    doc = ezdxf.readfile(dxf)
    msp = doc.modelspace()
    layout = msp if len(msp) else next(lay for lay in doc.layouts if not lay.is_modelspace)
    fig = plt.figure(figsize=(16, 12.9) if layout is msp else (16, 11.3))
    ax = fig.add_axes([0, 0, 1, 1])
    cfg = Configuration(background_policy=BackgroundPolicy.WHITE)
    # adjust_figure=False keeps the requested pixel size; the default shrinks
    # the figure to the drawing's paper extents (about 600 px wide here).
    Frontend(RenderContext(doc), MatplotlibBackend(ax, adjust_figure=False), config=cfg).draw_layout(
        layout, finalize=True)
    png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(png, dpi=110, facecolor="white")
    plt.close(fig)


def load_portmap(path: Path = PORTMAP_PATH) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def make_ctx(world, world_sha, generated_utc, out_pdf: Path, portmap=None, sheets_doc=None):
    sheets_doc = sheets_doc or load_sheets()
    pages = {}
    for s in sheets_doc["sheets"]:
        p = Path(out_pdf) / f"{s['id']}.pdf"
        if p.exists():
            pages[s["id"]] = _pdf_pages(p)
    return {"world": world, "sha": world_sha, "utc": generated_utc, "portmap": portmap or load_portmap(),
            "sheets_doc": sheets_doc, "page_counts": pages}


def build_sheet(sheet: dict, world: dict, out_dxf: Path, out_pdf: Path, out_prev: Path, generated_utc: str,
                world_sha: str, previews: bool = True, ctx: dict | None = None) -> dict:
    content = sheet.get("content")
    if content not in IMPLEMENTED_CONTENT:
        raise ValueError(f"{sheet['id']}: content '{content}' not implemented")
    dxf_path = Path(out_dxf) / f"{sheet['id']}.dxf"
    pdf_path = Path(out_pdf) / f"{sheet['id']}.pdf"
    counts_path = Path(out_dxf) / f"{sheet['id']}.counts.json"
    if content == "plan":
        den = int(sheet["scale"].split(":")[1])
        plan = build_plan(world, sheet["floor"], den, paper=sheet["size"])
        layout = sheet_layout(sheet, plan)
        meta = write_dxf(sheet, world, plan, layout, dxf_path, generated_utc, world_sha)
        pdf_info = write_pdf(sheet, world, plan, layout, pdf_path, generated_utc, world_sha)
        expected = {"walls": len(plan["walls"]), "doors": len(plan["doors"]), "rooms": len(plan["rooms"]),
                    "windows": len(plan["windows"]), "fixtures": len(plan["fixtures"]) + len(plan["vlinks"]),
                    "dimension_segments": sum(len(ch["segments"]) for ch in plan["chains"])}
        leader_tags = [rid for rid, t in plan["tags"].items() if t.get("leader")]
        result = {"plan": plan, "layout": layout, "scale_bar": layout["scale_bar"], "leader_tags": leader_tags,
                  "tag_overlaps": {rid: round(t["overlap_m2"], 3) for rid, t in plan["tags"].items()
                                   if t.get("overlap_m2")},
                  "summary": {"leader_tags": leader_tags}}
    else:
        ctx = ctx or make_ctx(world, world_sha, generated_utc, out_pdf)
        sd = BUILDERS[content](sheet, ctx)
        write_dxf_doc(sd, dxf_path)
        pdf_info = write_pdf_doc(sd, pdf_path)
        meta = sd.meta
        expected = {"pages": len(sd.pages), "views": sum(len(p.views) for p in sd.pages)}
        result = {"sheetdoc": sd, "summary": sd.summary}
    counts = dxf_counts(dxf_path)
    counts.update({"sheet": sheet["id"], "world_revision": world["revision"]["id"], "expected": expected,
                   "openings": opening_counts(dxf_path)})
    counts_path.write_text(json.dumps(counts, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    result.update({"sheet": sheet, "dxf": dxf_path, "pdf": pdf_path, "counts": counts_path, "meta": meta,
                   "page_pt": pdf_info["page_pt"], "pages": _pdf_pages(pdf_path)})
    if previews:
        result["preview_pdf"] = Path(out_prev) / f"{sheet['id']}.png"
        result["preview_pages"] = render_pdf_preview(pdf_path, result["preview_pdf"])
        result["preview_dxf"] = Path(out_prev) / f"{sheet['id']}-dxf.png"
        render_dxf_preview(dxf_path, result["preview_dxf"])
    return result


def build_set(sheets: list, world: dict, out_dxf: Path, out_pdf: Path, out_prev: Path, generated_utc: str,
              world_sha: str, previews: bool = True, portmap: dict | None = None, sheets_doc: dict | None = None,
              on_result=None) -> dict:
    """Build sheets in dependency order (the cover last, since it lists page counts)."""
    sheets_doc = sheets_doc or load_sheets()
    portmap = portmap or load_portmap()
    ordered = [s for s in sheets if s["content"] != "index"] + [s for s in sheets if s["content"] == "index"]
    results = {}
    for sh in ordered:
        ctx = make_ctx(world, world_sha, generated_utc, out_pdf, portmap, sheets_doc)
        r = build_sheet(sh, world, out_dxf, out_pdf, out_prev, generated_utc, world_sha, previews=previews, ctx=ctx)
        results[sh["id"]] = r
        if on_result:
            on_result(r)
    return results


def _pdf_pages(pdf: Path) -> int:
    from pypdf import PdfReader
    return len(PdfReader(str(pdf)).pages)


def consolidate(sheets_doc: dict, pdf_dir: Path) -> list:
    """Merge per-sheet PDFs into the full set and per-discipline sets with one
    bookmark per sheet and page labels equal to the sheet ID (multi-page
    sheets get '<ID>-1', '<ID>-2', ...)."""
    from pypdf import PdfReader, PdfWriter
    from pypdf.constants import PageLabelStyle
    out = []
    for fname, disc in SETS:
        sheets = [s for s in sheets_doc["sheets"] if disc is None or s["discipline"] == disc]
        missing = [s["id"] for s in sheets if not (Path(pdf_dir) / f"{s['id']}.pdf").exists()]
        if missing:
            out.append({"file": fname, "skipped": f"missing sheets {missing}"})
            continue
        w = PdfWriter()
        labels = []
        for s in sheets:
            start = len(w.pages)
            r = PdfReader(str(Path(pdf_dir) / f"{s['id']}.pdf"))
            for pg in r.pages:
                w.add_page(pg)
            n = len(r.pages)
            w.add_outline_item(f"{s['id']} {s['title']}", start)
            if n == 1:
                w.set_page_label(start, start, prefix=s["id"])
                labels.append(s["id"])
            else:
                w.set_page_label(start, start + n - 1, style=PageLabelStyle.DECIMAL, prefix=f"{s['id']}-", start=1)
                labels += [f"{s['id']}-{i + 1}" for i in range(n)]
        w.add_metadata({"/Title": f"kantor-rpg paket gambar konsep ({disc or 'semua disiplin'})",
                        "/Author": DRAWN_BY, "/Subject": "KONSEP, bukan untuk konstruksi",
                        "/Creator": f"{GENERATOR} v{GENERATOR_VERSION} (pypdf merge)"})
        path = Path(pdf_dir) / fname
        with open(path, "wb") as fh:
            w.write(fh)
        out.append({"file": fname, "discipline": disc or "all", "sheets": [s["id"] for s in sheets],
                    "pages": len(w.pages), "labels": labels, "path": path})
    return out


def _rel(p) -> str:
    p = Path(p).resolve()
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def write_register(results: list, sheets_doc: dict, register_path: Path, command: str, generated_utc: str,
                   sets: list | None = None) -> dict:
    old = {}
    if register_path.exists():
        try:
            old = {e["id"]: e for e in json.loads(register_path.read_text(encoding="utf-8")).get("sheets", [])}
        except (ValueError, KeyError):
            old = {}
    produced = {r["sheet"]["id"]: r for r in results}
    entries = []
    for sh in sheets_doc["sheets"]:
        base = {"id": sh["id"], "title": sh["title"], "discipline": sh["discipline"], "size": sh["size"],
                "scale": sh["scale"], "content": sh["content"], "milestone": sh["milestone"]}
        if sh["id"] in produced:
            r = produced[sh["id"]]
            files = {"dxf": r["dxf"], "pdf": r["pdf"], "counts": r["counts"],
                     "preview_pdf": r.get("preview_pdf"), "preview_dxf": r.get("preview_dxf")}
            for i, pp in enumerate(r.get("preview_pages", [])[1:], start=2):
                files[f"preview_pdf_p{i}"] = pp
            w, h = PAPER_MM[sh["size"]]
            from tools.kantor.native_dwg import verified_native_dwg
            dwg = Path(r['dxf']).with_suffix('.dwg')
            native_ok = verified_native_dwg(dwg, ROOT)
            if native_ok:
                files['dwg'] = dwg
            entry = {**base, "status": "produced (konsep)", "revision": r["meta"]["KR_REVISION"],
                     "generated_utc": generated_utc, "generator_command": command,
                     "pdf_pages": r["pages"], "page_size_mm": [w, h],
                     "page_size_pt": [round(w * PT_PER_MM, 2), round(h * PT_PER_MM, 2)],
                     "native_dwg": ('GENERATED (Autodesk reopen/AUDIT/counts; native plot pending)'
                                    if native_ok else 'BLOCKED (no matching native evidence)'),
                     "files": {k: {"path": _rel(v), "sha256": sha256(v)}
                               for k, v in files.items() if v}}
        elif sh["id"] in old and old[sh["id"]].get("files") and all(
                (ROOT / f["path"]).exists() and sha256(ROOT / f["path"]) == f["sha256"]
                for f in old[sh["id"]]["files"].values()):
            entry = old[sh["id"]]  # produced by an earlier run, files unchanged since
        else:
            entry = {**base, "status": "target"}
        entries.append(entry)
    doc = {"project": sheets_doc["project"], "source": "design/sheets.json", "generated_utc": generated_utc,
           "note": "Dibuat oleh cad/generate.py. Status 'produced (konsep)' = DXF/PDF dihasilkan dan dibaca ulang; "
                   "Native DWG availability is attested separately; native plot/font review is pending.",
           "sheets": entries, "sets": []}
    for st in sets or []:
        if "path" in st:
            doc["sets"].append({"file": _rel(st["path"]), "discipline": st["discipline"],
                                "sheets": st["sheets"], "pages": st["pages"], "page_labels": st["labels"],
                                "bookmarks": len(st["sheets"]), "sha256": sha256(st["path"])})
        else:
            doc["sets"].append(st)
    register_path.parent.mkdir(parents=True, exist_ok=True)
    register_path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return doc


def _log_sheet(r):
    import ezdxf
    sh = r["sheet"]
    cnt = json.loads(r["counts"].read_text(encoding="utf-8"))
    doc = ezdxf.readfile(r["dxf"])
    aud = doc.audit()
    print(f"\n[{sh['id']}] {sh['title']}  content {sh['content']}  floor {sh.get('floor', '-')}  "
          f"scale {sh['scale']} @ {sh['size']}")
    print(f"  dxf {r['dxf'].relative_to(ROOT)}  {r['dxf'].stat().st_size} bytes  sha256 {sha256(r['dxf'])}")
    print(f"  reopen ezdxf.readfile OK, dxfversion {doc.dxfversion}, $INSUNITS {doc.header.get('$INSUNITS')}, "
          f"audit errors {len(aud.errors)} fixes {len(aud.fixes)}")
    ms_total = cnt["totals"]["modelspace"]
    print(f"  modelspace {ms_total} entities: " + "; ".join(
        f"{layer} " + ", ".join(f"{k} {v}" for k, v in sorted(types.items()))
        for layer, types in sorted(cnt["modelspace"].items())))
    for lay, layers in cnt["paperspace"].items():
        print(f"  {lay} {sum(sum(t.values()) for t in layers.values())} entities")
    print(f"  expected {cnt['expected']}")
    print(f"  openings {json.dumps(cnt['openings'], ensure_ascii=False)}")
    print(f"  pdf {r['pdf'].relative_to(ROOT)}  {r['pdf'].stat().st_size} bytes  pages {r['pages']}  page "
          f"{r['page_pt'][0]:.2f} x {r['page_pt'][1]:.2f} pt  sha256 {sha256(r['pdf'])}")
    if "scale_bar" in r:
        sb = r["scale_bar"]
        print(f"  scale bar {sb['marks_m']} m -> {sb['length_mm']:.2f} mm = {sb['length_pt']:.2f} pt")
    summ = r.get("summary") or {}
    if summ:
        print(f"  summary {json.dumps(summ, ensure_ascii=False, default=str)}")
    if r.get("preview_pdf"):
        extra = [str(p.relative_to(ROOT)) for p in r.get("preview_pages", [])[1:]]
        print(f"  previews {r['preview_pdf'].relative_to(ROOT)}, {r['preview_dxf'].relative_to(ROOT)}"
              + (f", {', '.join(extra)}" if extra else ""))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--sheets", nargs="+", metavar="ID")
    g.add_argument("--all-available", action="store_true")
    ap.add_argument("--world", default=str(WORLD_PATH))
    ap.add_argument("--no-previews", action="store_true")
    args = ap.parse_args(argv)

    world = load_world(args.world)
    world_sha = sha256(Path(args.world))
    sheets_doc = load_sheets()
    by_id = {s["id"]: s for s in sheets_doc["sheets"]}
    if args.all_available:
        wanted = [s for s in sheets_doc["sheets"] if s.get("content") in IMPLEMENTED_CONTENT]
    else:
        unknown = [i for i in args.sheets if i not in by_id]
        if unknown:
            print(f"ERROR unknown sheet id(s): {', '.join(unknown)}", file=sys.stderr)
            return 2
        wanted = [by_id[i] for i in args.sheets]
        bad = [s["id"] for s in wanted if s.get("content") not in IMPLEMENTED_CONTENT]
        if bad:
            print(f"ERROR content not implemented yet for: {', '.join(bad)} (status tetap target)", file=sys.stderr)
            return 2
    generated_utc = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    command = "python3 cad/generate.py " + " ".join(argv if argv is not None else sys.argv[1:])
    print(f"generator {GENERATOR} v{GENERATOR_VERSION}  utc {generated_utc}")
    print(f"world {Path(args.world).relative_to(ROOT) if Path(args.world).is_absolute() else args.world} "
          f"revision {world['revision']['id']} sha256 {world_sha}")
    portmap = load_portmap()
    print(f"portmap {PORTMAP_PATH.relative_to(ROOT)} worldRevision {portmap.get('worldRevision')} "
          f"sha256 {sha256(PORTMAP_PATH)}")
    fonts = register()
    print(font_source_note(fonts))
    for name, colr in (("INK", INK), ("GREEN", GREEN), ("GREY_TEXT", GREY_TEXT), ("TERRA", TERRA), ("DIM", DIM)):
        print(f"contrast {name} {colr} on white = {contrast_ratio(colr):.2f}:1")
    print(f"contrast white on GREEN status band = {contrast_ratio(PAPER, GREEN):.2f}:1")
    out_dxf, out_pdf, out_prev = ROOT / "cad" / "out", ROOT / "drawings" / "pdf", ROOT / "drawings" / "previews"
    built = build_set(wanted, world, out_dxf, out_pdf, out_prev, generated_utc, world_sha,
                      previews=not args.no_previews, portmap=portmap, sheets_doc=sheets_doc, on_result=_log_sheet)
    results = list(built.values())
    idx = write_counts_index(out_dxf)
    print(f"\ncounts index {idx.relative_to(ROOT)} sha256 {sha256(idx)}")
    sets = consolidate(sheets_doc, out_pdf)
    print()
    for st in sets:
        if "path" in st:
            print(f"set {st['file']}: {len(st['sheets'])} sheets, {st['pages']} pages, labels "
                  f"{' '.join(st['labels'])}  sha256 {sha256(st['path'])}")
        else:
            print(f"set {st['file']}: {st['skipped']}")
    reg = write_register(results, sheets_doc, ROOT / "drawings" / "register.json", command, generated_utc, sets)
    n_prod = sum(1 for e in reg["sheets"] if e["status"].startswith("produced"))
    print(f"\nregister drawings/register.json: {n_prod} produced, {len(reg['sheets']) - n_prod} target")
    print("native DWG: BLOCKED (AutoCAD tidak tersedia di container); tidak ada file .dwg dibuat")
    return 0


if __name__ == "__main__":
    sys.exit(main())
