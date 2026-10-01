"""Runtime consumes derived files; they must match a fresh derivation from world.json."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_derived_runtime_files_are_current(tmp_path):
    before = {p: (ROOT / "design" / "derived" / p).read_text() for p in ("walls.json", "nav-counts.json")}
    subprocess.run([sys.executable, "tools/export_runtime.py"], cwd=ROOT, check=True, capture_output=True)
    after = {p: (ROOT / "design" / "derived" / p).read_text() for p in before}
    assert before == after, "design/derived runtime files are stale: run tools/export_runtime.py"


def test_walls_revision_matches_world():
    world = json.loads((ROOT / "design" / "world.json").read_text())
    walls = json.loads((ROOT / "design" / "derived" / "walls.json").read_text())
    assert walls["worldRevision"] == world["revision"]["id"]


def test_app_reads_world_from_design_not_a_copy():
    main = (ROOT / "app" / "src" / "main.ts").read_text()
    assert "@design/world.json" in main
    copies = [p for p in (ROOT / "app").rglob("world.json") if "node_modules" not in p.parts]
    assert copies == [], f"app must not keep its own world.json copy: {copies}"
