"""PRD v0.2 quotes computed numbers; fail when the dataset moves and the PRD does not."""
import json
from pathlib import Path

from tools.capacity import compute
from tools.ict_derive import derive

ROOT = Path(__file__).resolve().parents[2]
PRD = (ROOT / "PRD" / "PRD-v0.2.md").read_text(encoding="utf-8")


def idn(x, nd=1):
    return f"{x:.{nd}f}".replace(".", ",")


def test_capacity_numbers_quoted(world):
    c = compute(world)
    f1, f2 = c["floors"]["L1"], c["floors"]["L2"]
    e = c["exploration_vs_pixel_baseline"]
    expected = [
        f"{int(c['gross_m2'])} m2 gross",
        f"{f1['rooms']} ruang di L1", f"{f2['rooms']} ruang di L2",
        f"L1 {f1['seats_from_fixtures']} kursi dan {f1['workstations']} workstation",
        f"L2 {f2['seats_from_fixtures']} kursi",
        f"L1 {f1['occupant_load_comparison']} orang", f"L2 {f2['occupant_load_comparison']} orang",
        f"{e['world_rooms_non_shaft']} ruang non-shaft", f"{e['world_fixtures']} fixture", f"{e['world_activity_slots']} slot aktivitas",
        f"{idn(f1['circulation_ratio'] * 100)} persen",
        f"{int(c['private_snapshot_egress']['by_viewers']['40']['bytes_per_second'])} B/s",
        f"{int(c['private_snapshot_egress']['by_viewers']['200']['bytes_per_second'])} B/s",
        f"{idn(c['private_snapshot_egress']['by_viewers']['40']['GB_per_hour'], 3)} GB/jam",
        f"anggaran karakter LOD0 = {c['triangles']['characters_lod0_budget'] // 1000}k",
    ]
    missing = [s for s in expected if s not in PRD]
    assert not missing, missing


def test_ict_numbers_quoted(world):
    r = derive(world)
    t = r["totals"]
    expected = [f"{t['outlets']} outlet", f"{t['ports']} port", f"total {idn(t['cable_m'])} m",
                f"terpanjang {idn(t['max_length_m'])} m", f"PoE worst-case {int(r['poeTotalWorstCaseW'])} W",
                f"{len(r['switches'])} access switch"]
    missing = [s for s in expected if s not in PRD]
    assert not missing, missing


def test_validator_check_count_quoted(world):
    from tools.validate_world import run
    rep, _ = run(world)
    assert f"menjalankan {len(rep.checks)} pemeriksaan" in PRD


def test_no_em_dash_in_docs():
    for p in list((ROOT / "docs").rglob("*.md")) + list((ROOT / "PRD").glob("*.md")) + [ROOT / "README.md"]:
        assert "\u2014" not in p.read_text(encoding="utf-8"), p
