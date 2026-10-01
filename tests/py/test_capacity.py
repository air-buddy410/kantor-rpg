import json
from pathlib import Path

from tools.capacity import compute

ROOT = Path(__file__).resolve().parents[2]


def test_matches_v01_estimates(world):
    """The v0.1 hand estimates must agree with the script on shared keys."""
    est = json.loads((ROOT / "docs" / "capacity-estimates.json").read_text())
    c = compute(world)
    assert c["gross_m2"] == est["gross_m2"]
    assert c["exploration_vs_pixel_baseline"]["tile_baseline_cells"] == est["tile_baseline_cells"]
    eg = c["private_snapshot_egress"]["by_viewers"]
    assert eg["40"]["bytes_per_second"] == est["snapshot_bytes_per_second_40_viewers"]
    assert eg["200"]["bytes_per_second"] == est["snapshot_bytes_per_second_200_viewers"]
    assert c["transfer"]["mobile_initial_seconds"] == est["first_25_MB_transfer_seconds_at_10_Mbps"]
    assert c["maintenance_hours_monthly"]["total"] == est["maintenance_hours_proposal_monthly"]


def test_areas_cover_floors(world):
    c = compute(world)
    for f in c["floors"].values():
        assert abs(sum(f["area_by_category_m2"].values()) - f["gross_m2"]) < 1e-6


def test_cold_start_finding_is_computed(world):
    c = compute(world)
    assert c["transfer"]["max_initial_MB_for_cold_start_target"] == 10.0
