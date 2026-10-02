"""Control coverage audit (R2, CLAUDE.md "semua kontrol bekerja").

Every interactive control and keyboard shortcut of the app is listed below
with the string an E2E spec uses to drive it. The audit fails when:
- index.html has a button/input/select that is not in the inventory;
- a listed control's source string no longer exists in index.html / app/src;
- no spec in app/tests/e2e references the control (untested control).

Usage: python3 tools/control_audit.py [--out docs/evidence/R2/control-audit.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"

# (control, where it is defined: 'html:<id or name=value>' or 'src:<literal>', test references (any one suffices))
INVENTORY = [
    ("Lewati ke direktori (skip link)", "html:href=#directory-panel", ["Lewati ke direktori"]),
    ("Direktori button", "html:btn-directory", ["#btn-directory"]),
    ("Studio button", "html:btn-studio", ["#btn-studio"]),
    ("Avatar button", "html:btn-avatar", ["#btn-avatar"]),
    ("Pengaturan button", "html:btn-settings", ["#btn-settings"]),
    ("Kontrol/help button", "html:btn-help", ["#btn-help"]),
    ("Selesai aktivitas", "html:activity-end", ["#activity-end"]),
    ("Touch Lari", "html:touch-run", ["#touch-run"]),
    ("Touch Aksi", "html:touch-interact", ["#touch-interact"]),
    ("Tutup direktori", "html:directory-close", ["#directory-close"]),
    ("Tema sistem", "html:theme=system", ["theme-system", "Ikuti sistem"]),
    ("Tema terang", "html:theme=light", ["theme-light", "Terang"]),
    ("Tema gelap", "html:theme=dark", ["theme-dark", "Gelap"]),
    ("Kualitas auto", "html:quality=auto", ["quality-auto", "Otomatis"]),
    ("Kualitas rendah", "html:quality=low", ["quality-low", "Ringan (tanpa bayangan)"]),
    ("Kualitas tinggi", "html:quality=high", ["quality-high", "Tinggi"]),
    ("Kurangi gerak", "html:reducedMotion", ["reducedMotion", "Kurangi gerak"]),
    ("Mode visitor", "html:visitor", ["Mode visitor"]),
    ("Avatar reset", "html:avatar-reset", ["#avatar-reset", "Reset ke default"]),
    ("Avatar batal", "html:avatar-cancel", ["#avatar-cancel", "name: 'Batal'"]),
    ("Avatar simpan", "html:avatar-save", ["#avatar-save", "name: 'Simpan' }"]),
    ("Dialog close (Selesai/Tutup)", "html:value=close", ["'Selesai'", "Tutup"]),
    ("Directory Pergi", "src:'Pergi'", ["Pergi"]),
    ("Directory Profil", "src:Profil ${a.displayName}", ["Profil "]),
    ("Directory Temui", "src:Temui ${a.displayName}", ["Temui "]),
    ("Persona Topik lain", "src:'Topik lain'", ["Topik lain"]),
    ("Studio lantai L1/L2", "src:'aria-pressed': String(f.id === this.floor)", ["name: 'L2', exact: true"]),
    ("Studio pilih fixture", "src:studio-pick", ["#studio-pick"]),
    ("Studio geser barat", "src:Geser ke barat 0,25 m", ["Geser ke barat"]),
    ("Studio geser utara", "src:Geser ke utara 0,25 m", ["Geser ke utara"]),
    ("Studio geser selatan", "src:Geser ke selatan 0,25 m", ["Geser ke selatan"]),
    ("Studio geser timur", "src:Geser ke timur 0,25 m", ["Geser ke timur"]),
    ("Studio putar", "src:Putar 90 derajat", ["Putar 90 derajat"]),
    ("Studio hapus", "src:Hapus fixture terpilih", ["Hapus fixture terpilih"]),
    ("Studio undo", "src:'Undo'", ["name: 'Undo'"]),
    ("Studio redo", "src:'Redo'", ["name: 'Redo'"]),
    ("Studio tipe baru + Tambah", "src:'Tambah'", ["'Tambah'"]),
    ("Studio Validasi", "src:fbtn('Validasi'", ["'Validasi'"]),
    ("Studio Simpan draft", "src:fbtn('Simpan draft'", ["Simpan draft"]),
    ("Studio Export JSON", "src:fbtn('Export JSON'", ["Export JSON"]),
    ("Studio Import JSON", "src:studio-import", ["#studio-import"]),
    ("Studio Publish lokal", "src:'Publish lokal'", ["Publish lokal"]),
    ("Studio Rollback", "src:`Rollback (", ["Rollback"]),
    ("Studio Keluar", "src:studio-exit", ["#studio-exit"]),
    ("Key W/A/S/D walk", "src:'w', 'a', 's', 'd'", ["keyboard.down('w')"]),
    ("Key Shift run", "src:shift", ["down('Shift')"]),
    ("Key E interact", "src:k === 'e'", ["press('e')"]),
    ("Key M directory", "src:k === 'm'", ["press('m')", "press('M')"]),
    ("Key H help", "src:k === 'h'", ["press('h')", "press('H')"]),
    ("Key R recenter camera", "src:k === 'r') this.rig.recenter", ["(await cam(page)).pitch"]),
    ("Key Q/Z rotate camera", "src:k === 'q') this.rig.rotate", ["press('q')"]),
    ("Key +/- zoom", "src:k === '+'", ["press('+')", "press('=')"]),
    ("Key Escape (dialogs, activity, directory, studio)", "src:k === 'escape'", ["press('Escape')"]),
    ("Studio keys arrows/R/Delete/Ctrl+Z/Ctrl+Y", "src:k === 'arrowleft'", ["press('ArrowLeft')", "press('ArrowDown')"]),
    ("Studio key Delete", "src:k === 'delete'", ["press('Delete')"]),
    ("Studio key Ctrl+Z / Ctrl+Y", "src:ctrl && k === 'z'", ["press('Control+z')", "press('Control+Z')"]),
    ("Camera drag (pointer)", "src:pointerdown", ["mouse.down()"]),
    ("Touch joystick", "html:joystick", ["joystick"]),
    ("Perf report Salin hasil", "src:perf-report-copy", ["#perf-report-copy"]),
    ("Perf report Unduh JSON", "src:perf-report-download", ["#perf-report-download"]),
    ("Perf report Tutup", "src:perf-report-close", ["#perf-report-close"]),
]


class _Controls(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("button", "select", "textarea") or (tag == "input" and a.get("type") != "hidden"):
            if a.get("id"):
                self.found.append(a["id"])
            elif a.get("name") and a.get("type") == "radio":
                self.found.append(f"{a['name']}={a.get('value')}")
            elif a.get("name"):
                self.found.append(a["name"])
            elif a.get("value"):
                self.found.append(f"value={a['value']}")
        if tag == "a" and (a.get("href") or "").startswith("#"):
            self.found.append(f"href={a['href']}")


def audit():
    html = (APP / "index.html").read_text(encoding="utf-8")
    src = "\n".join(p.read_text(encoding="utf-8") for p in (APP / "src").rglob("*.ts")) + html
    specs = "\n".join(p.read_text(encoding="utf-8") for p in (APP / "tests" / "e2e").glob("*.ts"))
    parser = _Controls()
    parser.feed(html)
    listed_html = {d.split(":", 1)[1] for _, d, _ in INVENTORY if d.startswith("html:")}
    unlisted = sorted(set(parser.found) - listed_html)
    rows, missing_src, untested = [], [], []
    for name, where, refs in INVENTORY:
        kind, key = where.split(":", 1)
        present = (key in parser.found or key in html) if kind == "html" else key in src
        tested = [r for r in refs if r in specs]
        rows.append({"control": name, "defined": where, "present": present, "testedBy": tested})
        if not present:
            missing_src.append(name)
        if not tested:
            untested.append(name)
    return {"controls": len(INVENTORY), "unlistedHtmlControls": unlisted, "missingInSource": missing_src,
            "untested": untested, "rows": rows}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    args = ap.parse_args()
    rep = audit()
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(rep, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"controls={rep['controls']} unlisted={len(rep['unlistedHtmlControls'])} missingInSource={len(rep['missingInSource'])} untested={len(rep['untested'])}")
    for k in ("unlistedHtmlControls", "missingInSource", "untested"):
        for x in rep[k]:
            print(f"  {k}: {x}")
    return 1 if (rep["unlistedHtmlControls"] or rep["missingInSource"] or rep["untested"]) else 0


if __name__ == "__main__":
    sys.exit(main())
