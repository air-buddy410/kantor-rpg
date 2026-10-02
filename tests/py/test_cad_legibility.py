"""Printed legibility of window tags and of the A-103 door/window schedule.

Target (concept drafting target, not a code or contract requirement): lettering
on a printed drawing is at least 2,5 mm high. 2,5 mm is the smallest nominal
height in the ISO 3098-1 lettering series and the usual minimum in drawing
practice for text that must be read on the printed sheet.

Print assumption: Budi prints the set on A3. Each sheet is scaled to fit A3
landscape (420 x 297 mm) and never enlarged:
    s = min(420 / page_w_mm, 297 / page_h_mm, 1.0)
so an A2 sheet prints at 0,707 and an A3 sheet at 1,0.

Height convention: the measured height is the font size (em) in pt, as set by
Tf and scaled by the text and current transformation matrices, converted to mm
(1 pt = 25,4 / 72 mm) and multiplied by s. ISO 3098 h is the capital height,
which for the sheet font is about 0,7 em, so this is the lenient reading of the
target; it is stated here so the numbers are not mistaken for cap heights.

Extraction tools (checked in this container): pdfplumber, pdfminer.six and
PyMuPDF are not installed. pypdf 6.19 (pinned in requirements-dev.txt) reports
the Tf size and both matrices per text run through extract_text(visitor_text=),
which gives the height measure. poppler `pdftotext -bbox` gives word boxes in
page points for the overlap check. Neither reuses generator code or the
generator's own overlap numbers, so the check reads the PDF a printer receives.

A window tag on a drawing is either the full window ID (W-L1-016) or the short
form W + window number without leading zeros (W16); window numbers are unique
over both floors in world.json, and A-103 must map each short form to its ID.
"""
import html
import json
import re
import subprocess
from pathlib import Path

import pytest
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "drawings" / "pdf"
PT_MM = 25.4 / 72
A3_LANDSCAPE_MM = (420.0, 297.0)
MIN_PRINTED_MM = 2.5  # concept drafting target, see module docstring
OVERLAP_TOL_PT2 = 0.05  # boxes that only touch are not an overlap
TAG_SHEETS = {"A-101": "L1", "A-102": "L2", "A-201": "L1", "A-202": "L2", "A-301": None, "A-401": None}


def world():
    return json.loads((ROOT / "design" / "world.json").read_text(encoding="utf-8"))


def short_tag(win_id):
    return "W" + str(int(win_id.rsplit("-", 1)[1]))


def tag_forms(windows):
    """{tag text -> window id} for both accepted forms."""
    out = {}
    for w in windows:
        out[w["id"]] = w["id"]
        out[short_tag(w["id"])] = w["id"]
    return out


def print_scale(page):
    w_mm = float(page.mediabox.width) * PT_MM
    h_mm = float(page.mediabox.height) * PT_MM
    assert w_mm >= h_mm, "sheets are landscape"
    return min(A3_LANDSCAPE_MM[0] / w_mm, A3_LANDSCAPE_MM[1] / h_mm, 1.0)


def text_runs(pdf, page_index):
    """[(text, size_pt, x_pt, y_pt, baseline_dir)] per text run; size = Tf size
    x length of the text-space y axis after both matrices."""
    page = PdfReader(str(pdf)).pages[page_index]
    runs = []

    def visit(text, cm, tm, font_dict, font_size):
        t = text.strip()
        if not t:
            return
        # Row-vector PDF convention: text space -> device = tm x cm.
        a, b, c, d, e, f = tm
        A, B, C, D, E, F = cm
        m = (a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F)
        scale = (m[2] ** 2 + m[3] ** 2) ** 0.5  # length of the text-space y axis
        runs.append((t, font_size * scale, m[4], m[5], (m[0], m[1])))

    page.extract_text(visitor_text=visit)
    return runs, print_scale(page)


_WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>')


def word_boxes(pdf, page_no):
    out = subprocess.run(["pdftotext", "-bbox", "-f", str(page_no), "-l", str(page_no), str(pdf), "-"],
                         capture_output=True, text=True, check=True).stdout
    return [(html.unescape(m.group(5)), tuple(float(m.group(i)) for i in range(1, 5))) for m in _WORD.finditer(out)]


def diagonal_words(pdf, page_index, words):
    """Words that are glyphs of a diagonal run (the 5 % KONSEP watermark).

    poppler only knows 0/90/180/270 degree text, so it cuts a diagonal run
    into one 'word' per glyph with a box as tall as the font. Those boxes are
    the background watermark, not text a tag can collide with; they are
    recognised geometrically (centre within one font size of the run's
    baseline, glyph part of the run's text), not by position on a sheet."""
    page = PdfReader(str(pdf)).pages[page_index]
    H = float(page.mediabox.height)
    runs, _ = text_runs(pdf, page_index)
    out = set()
    for text, size, x, y, (ux, uy) in runs:
        n = (ux ** 2 + uy ** 2) ** 0.5
        ux, uy = ux / n, uy / n
        if min(abs(ux), abs(uy)) < 0.02:
            continue  # axis aligned
        ox, oy = x, H - y  # pdftotext boxes have y down
        dx, dy = ux, -uy
        for i, (t, b) in enumerate(words):
            cx, cy = (b[0] + b[2]) / 2 - ox, (b[1] + b[3]) / 2 - oy
            along = cx * dx + cy * dy
            across = abs(cx * dy - cy * dx)
            if t in text and across <= size and -size <= along <= size * len(text):
                out.add(i)
    return out


def overlap(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0.0


def sheet_windows(sid, wd):
    floor = TAG_SHEETS[sid]
    return [w for w in wd["windows"] if floor is None or w["floor"] == floor]


# Sections tag only the windows their cut planes cross (test_cad_openings
# pins which), so there a tag must exist for at least one window, not all.
ALL_TAGGED = {sid for sid in TAG_SHEETS if sid != "A-401"}


def word_kind(text):
    if re.fullmatch(r"D-L\d-\w+", text):
        return "door tag"
    if re.fullmatch(r"\d{3,5}", text) or re.fullmatch(r"[+-]?\d+,\d{3}", text):
        return "dimension/level"
    if re.fullmatch(r"W-L\d-\d{3}|W\d{1,3}", text):
        return "window tag"
    return "other text"


# ---------------------------------------------------------------- tag height

@pytest.mark.parametrize("sid", list(TAG_SHEETS))
def test_window_tags_printed_height(sid):
    wd = world()
    wins = sheet_windows(sid, wd)
    forms = tag_forms(wins)
    runs, s = text_runs(PDF / f"{sid}.pdf", 0)
    found = {}
    for text, size, x, y, _ in runs:
        if text in forms:
            found.setdefault(forms[text], []).append((text, size))
    missing = sorted({w["id"] for w in wins} - set(found)) if sid in ALL_TAGGED else ([] if found else ["any"])
    repeated = sorted(k for k, v in found.items() if len(v) != 1)
    assert not missing and not repeated, f"{sid}: tags missing {missing}, not exactly once {repeated}"
    sizes = {wid: v[0][1] for wid, v in found.items()}
    small = {wid: sz for wid, sz in sizes.items() if sz * PT_MM * s < MIN_PRINTED_MM}
    lo = min(sizes.values())
    assert not small, (f"{sid}: {len(small)}/{len(sizes)} window tags below {MIN_PRINTED_MM} mm printed on A3 "
                       f"(scale {s:.3f}); smallest {lo:.2f} pt = {lo * PT_MM:.2f} mm on the sheet = "
                       f"{lo * PT_MM * s:.2f} mm printed; need >= {MIN_PRINTED_MM / s / PT_MM:.2f} pt")


def opening_schedule_page(pdf):
    reader = PdfReader(str(pdf))
    for i, pg in enumerate(reader.pages):
        if "SCHEDULE PINTU DAN JENDELA" in pg.extract_text():
            return i
    raise AssertionError("A-103 has no door/window schedule page")


def test_opening_schedule_printed_height():
    """Every text run inside the schedule band (header row down to the lowest
    row, both tables and the notes beside them) prints at >= 2,5 mm."""
    wd = world()
    pdf = PDF / "A-103.pdf"
    idx = opening_schedule_page(pdf)
    runs, s = text_runs(pdf, idx)
    ids = {d["id"] for d in wd["doors"]} | {w["id"] for w in wd["windows"]}
    rows = [r for r in runs if r[0] in ids]
    assert {r[0] for r in rows} == ids, f"rows missing: {sorted(ids - {r[0] for r in rows})}"
    heads = [r for r in runs if r[0] in ("ID pintu", "ID jendela")]
    assert len(heads) == 2
    y_lo = min(r[3] for r in rows) - 2.0
    y_hi = max(r[3] for r in heads) + 2.0
    band = [r for r in runs if y_lo <= r[3] <= y_hi]
    small = sorted({(round(r[1], 2), r[0]) for r in band if r[1] * PT_MM * s < MIN_PRINTED_MM})
    lo = min(r[1] for r in band)
    assert not small, (f"A-103 p{idx + 1}: {len(small)} schedule text sizes below {MIN_PRINTED_MM} mm printed "
                       f"(scale {s:.3f}); smallest {lo:.2f} pt = {lo * PT_MM * s:.2f} mm; e.g. {small[:4]}")


# ---------------------------------------------------------------- overlap

@pytest.mark.parametrize("sid", list(TAG_SHEETS))
def test_window_tags_clear_of_other_text(sid):
    """No window tag box overlaps another window tag, a door tag, a dimension
    or level value, or any other word on the sheet."""
    forms = tag_forms(sheet_windows(sid, world()))
    words = word_boxes(PDF / f"{sid}.pdf", 1)
    mark = diagonal_words(PDF / f"{sid}.pdf", 0, words)
    words = [w for i, w in enumerate(words) if i not in mark]
    tags = [(t, b) for t, b in words if t in forms]
    assert tags, f"{sid}: no window tags found by pdftotext"
    hits = []
    for t, b in tags:
        for u, c in words:
            if (u, c) == (t, b):
                continue
            a = overlap(b, c)
            if a > OVERLAP_TOL_PT2:
                hits.append(f"{t} x {u} ({word_kind(u)}) {a:.1f} pt2")
    assert hits == [], f"{sid}: {len(hits)} overlaps: {hits[:10]}"


# ---------------------------------------------------------------- short tag mapping

def door_short_tag(door_id):
    code = door_id.rsplit("-", 1)[1]
    return "D" + (str(int(code)) if code.isdigit() else code)


def test_short_door_tags_resolve_in_schedule():
    """Plans tag doors D + code (D-L1-15 -> D15); each plan's tags are exactly
    its floor's doors, and each tag sits on its door's A-103 row."""
    wd = world()
    pdf = PDF / "A-103.pdf"
    idx = opening_schedule_page(pdf)
    text = subprocess.run(["pdftotext", "-raw", "-f", str(idx + 1), "-l", str(idx + 1), str(pdf), "-"],
                          capture_output=True, text=True, check=True).stdout.splitlines()
    for sid, floor in (("A-101", "L1"), ("A-102", "L2")):
        doors = {door_short_tag(d["id"]): d["id"] for d in wd["doors"] if d["floor"] == floor}
        runs, _ = text_runs(PDF / f"{sid}.pdf", 0)
        found = [r[0] for r in runs if r[0] in doors]
        assert sorted(found) == sorted(doors), f"{sid}: door tags {sorted(set(doors) - set(found))} missing"
        for tag, did in doors.items():
            row = [ln for ln in text if ln.startswith(did + " ")]
            assert len(row) == 1 and tag in row[0].split(), f"{tag} -> {did}: {row}"


def test_short_tags_resolve_in_schedule():
    """A short tag used on any drawing appears on its window's A-103 row, so
    the drawing can be read back to the full ID."""
    wd = world()
    pdf = PDF / "A-103.pdf"
    idx = opening_schedule_page(pdf)
    text = subprocess.run(["pdftotext", "-raw", "-f", str(idx + 1), "-l", str(idx + 1), str(pdf), "-"],
                          capture_output=True, text=True, check=True).stdout.splitlines()
    used = set()
    for sid in TAG_SHEETS:
        wins = sheet_windows(sid, wd)
        runs, _ = text_runs(PDF / f"{sid}.pdf", 0)
        shorts = {short_tag(w["id"]): w["id"] for w in wins}
        used |= {(r[0], shorts[r[0]]) for r in runs if r[0] in shorts}
    bad = []
    for tag, wid in sorted(used):
        row = [ln for ln in text if ln.startswith(wid + " ")]
        if len(row) != 1 or tag not in row[0].split():
            bad.append(f"{tag} -> {wid}: {row}")
    assert bad == [], bad


# ---------------------------------------------------------------- the checks can fail

def test_helpers_catch_small_and_overlapping_tags(tmp_path):
    """Synthetic A2 page: a 5,2 pt tag, a 10,5 pt tag overlapping a dimension,
    and a diagonal watermark. The size measure must read 5,2 pt as 1,30 mm
    printed, the overlap check must see the tag/dimension clash and the
    watermark glyphs must not count as text."""
    from reportlab.pdfgen import canvas
    pdf = tmp_path / "neg.pdf"
    w_pt, h_pt = 594 / PT_MM, 420 / PT_MM
    c = canvas.Canvas(str(pdf), pagesize=(w_pt, h_pt))
    c.setFont("Helvetica", 5.2)
    c.drawString(100, 100, "W1")
    c.setFont("Helvetica", 10.5)
    c.drawString(300, 300, "W2")
    c.drawString(306, 302, "4800")
    c.saveState()
    c.translate(w_pt / 2, h_pt / 2)
    c.rotate(35)
    c.setFont("Helvetica", 44)
    c.drawCentredString(0, 0, "KONSEP W3")
    c.restoreState()
    c.showPage()
    c.save()
    runs, s = text_runs(pdf, 0)
    sizes = {r[0]: r[1] * PT_MM * s for r in runs}
    assert abs(s - 297 / 420) < 1e-3  # page size is stored rounded to 0,01 pt
    assert abs(sizes["W1"] - 5.2 * PT_MM * s) < 1e-6 and sizes["W1"] < MIN_PRINTED_MM
    assert sizes["W2"] >= MIN_PRINTED_MM
    words = word_boxes(pdf, 1)
    mark = diagonal_words(pdf, 0, words)
    assert {words[i][0] for i in mark} >= {"K", "O", "N", "S", "E", "P"} and all(len(words[i][0]) <= 2 for i in mark)
    kept = [w for i, w in enumerate(words) if i not in mark]
    w2 = next(b for t, b in kept if t == "W2")
    clash = [t for t, b in kept if t != "W2" and overlap(w2, b) > OVERLAP_TOL_PT2]
    assert clash and word_kind(clash[0]) == "dimension/level", clash


# ================================================================ every text run on every sheet
#
# Same target and convention as above, applied to all text on every A, I and
# ICT sheet: titles, notes, title block, tables, tags, dimensions, levels,
# grid bubbles, furniture keys and device labels. The only text left out is
# the 5 % diagonal KONSEP watermark, which is background, not information.
# A class of text may be exempted on a named sheet only through EXEMPTIONS,
# each with the reason it cannot reach 2,5 mm and the mitigation on the set.

SHEETS = [s for s in json.loads((ROOT / "design" / "sheets.json").read_text(encoding="utf-8"))["sheets"]
          if s["discipline"] in ("A", "I", "ICT")]
EXEMPTIONS: dict = {}  # {sheet id: {class: {"reason": str, "mitigation": str}}}


def text_class(text):
    """Coarse class of a run or word, for messages, exemptions and evidence."""
    if re.fullmatch(r"W-L\d-\d{3}|W\d{1,3}", text):
        return "window tag"
    if re.fullmatch(r"D-L\d-\w+|D\d{1,2}|D-[A-Z]{3}", text):
        return "door tag"
    if re.fullmatch(r"[+±-]\d+,\d{2,3}( .*)?", text):
        return "level"
    if re.fullmatch(r"\d+,\d{1,2}( m²| x .*)?", text):
        return "area or size"
    if re.fullmatch(r"\d{3,5}", text):
        return "dimension or key"
    if re.fullmatch(r"\d{1,2}|[A-H]", text):
        return "grid or key"
    if re.fullmatch(r"L\d-[A-Z0-9-]+", text):
        return "room id"
    return "text"


def is_diagonal(direction):
    ux, uy = direction
    return min(abs(ux), abs(uy)) > 0.02 * max(abs(ux), abs(uy))


def sheet_pages(sid):
    pdf = PDF / f"{sid}.pdf"
    return pdf, len(PdfReader(str(pdf)).pages)


@pytest.mark.parametrize("sid", [s["id"] for s in SHEETS])
def test_all_text_printed_height(sid):
    pdf, n = sheet_pages(sid)
    exempt = EXEMPTIONS.get(sid, {})
    small, lo = {}, {}
    for i in range(n):
        runs, s = text_runs(pdf, i)
        for text, size, x, y, direction in runs:
            if is_diagonal(direction):
                continue
            mm = size * PT_MM * s
            cls = text_class(text)
            if mm < MIN_PRINTED_MM and cls not in exempt:
                small[cls] = small.get(cls, 0) + 1
                if mm < lo.get(cls, (99, ""))[0]:
                    lo[cls] = (round(mm, 2), f"p{i + 1} {size:.1f} pt '{text[:30]}'")
    assert not small, f"{sid}: text below {MIN_PRINTED_MM} mm printed on A3, per class: " + "; ".join(
        f"{c}: {small[c]} runs, min {lo[c][0]} mm ({lo[c][1]})" for c in sorted(small))


@pytest.mark.parametrize("sid", [s["id"] for s in SHEETS])
def test_no_overlapping_words(sid):
    """No word box overlaps another word box (watermark glyphs excluded)."""
    pdf, n = sheet_pages(sid)
    hits = []
    for i in range(n):
        words = word_boxes(pdf, i + 1)
        mark = diagonal_words(pdf, i, words)
        words = sorted((w for k, w in enumerate(words) if k not in mark), key=lambda w: w[1][0])
        for a in range(len(words)):
            ta, ba = words[a]
            for b in range(a + 1, len(words)):
                tb, bb = words[b]
                if bb[0] >= ba[2]:
                    break
                area = overlap(ba, bb)
                if area > OVERLAP_TOL_PT2:
                    hits.append(f"p{i + 1} '{ta}' ({text_class(ta)}) x '{tb}' ({text_class(tb)}) {area:.1f} pt2")
    assert hits == [], f"{sid}: {len(hits)} overlapping words: {hits[:8]}"


def test_exemptions_are_explained():
    for sid, classes in EXEMPTIONS.items():
        assert sid in {s["id"] for s in SHEETS}
        for cls, why in classes.items():
            assert why.get("reason") and why.get("mitigation"), f"{sid} {cls}: exemption needs reason and mitigation"
