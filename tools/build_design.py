"""One command rebuild of every design-side artefact from design/world.json.

Order matters: seed -> validate -> derivations -> docs -> PDF. Stops on the
first failing step so a broken dataset never produces fresh-looking docs.

Usage: python3 tools/build_design.py [--skip-pdf]
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write_assumptions():
    world = json.loads((ROOT / "design" / "world.json").read_text(encoding="utf-8"))
    lines = ["# Asumsi dan batas", "", "Dibuat dari `design/world.json` (`assumptions`). Setiap angka ukuran/okupansi/ICT yang dipakai generator merujuk ID di bawah.", "",
             "| ID | Topik | Asumsi |", "|---|---|---|"]
    for a in world["assumptions"]:
        lines.append(f"| {a['id']} | {a['topic']} | {a['text']} |")
    (ROOT / "docs" / "assumptions.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def run(cmd):
    print("+", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode:
        sys.exit(r.returncode)


def main():
    py = sys.executable
    run([py, "design/authoring/seed_world.py"])
    run([py, "tools/validate_world.py", "--report", "docs/evidence/M0/validate-world.json"])
    run([py, "tools/export_runtime.py"])
    run([py, "tools/capacity.py"])
    run([py, "tools/room_schedule.py"])
    run([py, "tools/ict_derive.py"])
    run([py, "tools/req_matrix.py"])
    write_assumptions()
    if "--skip-pdf" not in sys.argv:
        run([py, "tools/render_prd.py", "--source", "PRD/PRD-v0.2.md", "--output", "PRD/PRD-v0.2.pdf"])


if __name__ == "__main__":
    main()
