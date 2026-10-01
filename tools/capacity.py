"""Capacity, sizing and budget arithmetic derived from design/world.json.

Every number printed here is either read from the dataset or computed from a
labelled assumption in PRD v0.2 section 13. Nothing is observed usage.

Usage: python3 tools/capacity.py [--json design/derived/capacity.json] [--md docs/capacity.md]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.kantor.geometry import load_world, polygon_area  # noqa: E402
from tools.kantor.nav import NavGrid  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]

# PRD v0.2 section 13 inputs (targets/assumptions, not measurements).
INPUTS = {
    "pixel_baseline": {"cols": 77, "rows": 44, "areas": 47, "furniture": 297, "source": "baseline kantor pixel lokal (PRD 3)"},
    "private_planning": {"actors": 12, "bytes_per_actor": 1024, "interval_s": 5, "viewers": [40, 200],
                         "status": "asumsi perencanaan private, M4 disabled"},
    "transfer": {"initial_mb_mobile_target": 25, "initial_mb_desktop_target": 60, "link_mbps": 10, "cold_start_target_s": 8,
                 "mb_definition": "1 MB = 10^6 byte (desimal)"},
    "maintenance_hours_monthly": {"dependency_security_review": 2, "asset_perf_regression": 2,
                                  "layout_ict_consistency": 1, "backup_restore_design_source": 1},
    "triangles": {"scene_mobile_max": 250_000, "player_max": 25_000, "npc_lod0_max": 15_000, "npc_lod1_max": 5_000,
                  "prop_small_max": 2_000, "draw_calls_mobile_max": 150},
}


def seats_by_room(world):
    out = {}
    for s in world["activitySlots"]:
        if s["pose"] == "sit":
            out[s["room"]] = out.get(s["room"], 0) + s["capacity"]
    return out


def compute(world):
    floors = {}
    rooms_out = []
    seats = seats_by_room(world)
    factors = world["occupantLoadFactors"]
    desks = {}
    for fx in world["fixtures"]:
        if fx["type"] in ("desk", "desk_exec"):
            desks[fx["room"]] = desks.get(fx["room"], 0) + 1
    for room in world["rooms"]:
        area = polygon_area(room["polygon"])
        key = room["occupantLoadKey"]
        load = math.ceil(area / factors[key]["m2"]) if key else 0
        rooms_out.append({"id": room["id"], "floor": room["floor"], "name": room["name"], "category": room["category"],
                          "area_m2": round(area, 2), "seats_from_fixtures": seats.get(room["id"], 0),
                          "workstations": desks.get(room["id"], 0),
                          "occupant_load_comparison": load, "load_factor": key})
    for floor in world["floors"]:
        fr = [r for r in rooms_out if r["floor"] == floor["id"]]
        cat = {}
        for r in fr:
            cat[r["category"]] = round(cat.get(r["category"], 0) + r["area_m2"], 2)
        gross = polygon_area(floor["envelope"])
        grid = NavGrid(world, floor["id"])
        walk = grid.walkable_count() * grid.cell ** 2
        floors[floor["id"]] = {
            "gross_m2": gross, "rooms": len(fr), "area_by_category_m2": cat,
            "circulation_ratio": round(cat.get("circulation", 0) / gross, 3),
            "seats_from_fixtures": sum(r["seats_from_fixtures"] for r in fr),
            "workstations": sum(r["workstations"] for r in fr),
            "occupant_load_comparison": sum(r["occupant_load_comparison"] for r in fr),
            "walkable_m2_navgrid": round(walk, 1),
            "exits_on_floor": sum(1 for d in world["doors"] if d["floor"] == floor["id"] and d["exit"]),
        }
    gross_total = sum(f["gross_m2"] for f in floors.values())
    pb = INPUTS["pixel_baseline"]
    explore = {
        "tile_baseline_cells": pb["cols"] * pb["rows"],
        "pixel_areas": pb["areas"], "pixel_furniture": pb["furniture"],
        "world_rooms_non_shaft": sum(1 for r in world["rooms"] if r["category"] != "shaft"),
        "world_fixtures": len(world["fixtures"]),
        "world_activity_slots": len(world["activitySlots"]),
        "world_walkable_m2": round(sum(f["walkable_m2_navgrid"] for f in floors.values()), 1),
        "note": "Tile tidak dikonversi ke meter; perbandingan hanya untuk kompleksitas eksplorasi (D-02).",
    }
    explore["rooms_vs_pixel_areas_ratio"] = round(explore["world_rooms_non_shaft"] / pb["areas"], 2)
    explore["fixtures_vs_pixel_furniture_ratio"] = round(explore["world_fixtures"] / pb["furniture"], 2)
    pp = INPUTS["private_planning"]
    egress = {}
    for v in pp["viewers"]:
        bps = pp["actors"] * pp["bytes_per_actor"] * v / pp["interval_s"]
        egress[str(v)] = {"bytes_per_second": bps, "GB_per_hour": round(bps * 3600 / 1e9, 3),
                          "GB_per_30d_if_continuous": round(bps * 86400 * 30 / 1e9, 1)}
    source_reads_per_hour = 3600 / pp["interval_s"]
    tr = INPUTS["transfer"]
    t_mobile = tr["initial_mb_mobile_target"] * 8 / tr["link_mbps"]
    t_desktop = tr["initial_mb_desktop_target"] * 8 / tr["link_mbps"]
    max_mb_for_cold_start = tr["cold_start_target_s"] * tr["link_mbps"] / 8
    tri = INPUTS["triangles"]
    npcs = sum(1 for a in world["actors"] if a["kind"] == "npc")
    char_budget = tri["player_max"] + npcs * tri["npc_lod0_max"]
    maint = INPUTS["maintenance_hours_monthly"]
    return {
        "status": "asumsi/target dihitung dari dataset, bukan observed usage",
        "world_revision": world["revision"]["id"],
        "gross_m2": gross_total,
        "floors": floors,
        "rooms": rooms_out,
        "exploration_vs_pixel_baseline": explore,
        "private_snapshot_egress": {"formula": "actors * bytes_per_actor * viewers / interval_s", "inputs": pp,
                                    "by_viewers": egress, "shared_source_reads_per_hour": source_reads_per_hour},
        "transfer": {"inputs": tr, "mobile_initial_seconds": t_mobile, "desktop_initial_seconds": t_desktop,
                     "max_initial_MB_for_cold_start_target": max_mb_for_cold_start,
                     "finding": "25 MB pada 10 Mbps butuh 20 s > target 8 s; first playable harus <= 10 MB, sisanya lazy load."},
        "triangles": {"inputs": tri, "npc_count": npcs, "characters_lod0_budget": char_budget,
                      "environment_remaining_mobile": tri["scene_mobile_max"] - char_budget},
        "maintenance_hours_monthly": {"items": maint, "total": sum(maint.values()), "status": "proposal, bukan jam teramati"},
    }


def to_markdown(c):
    lines = ["# Kapasitas dan sizing (dihitung)", "",
             f"Sumber: `design/world.json` revisi {c['world_revision']}; script `tools/capacity.py`. Status: {c['status']}.", "",
             "## Luas per lantai", "", "| Lantai | Gross m2 | Ruang | Sirkulasi | Kursi fixture | Workstation | Beban hunian pembanding | Walkable navgrid m2 | Exit |",
             "|---|---|---|---|---|---|---|---|---|"]
    for fid, f in c["floors"].items():
        lines.append(f"| {fid} | {f['gross_m2']} | {f['rooms']} | {f['circulation_ratio']:.1%} | {f['seats_from_fixtures']} | "
                     f"{f['workstations']} | {f['occupant_load_comparison']} | {f['walkable_m2_navgrid']} | {f['exits_on_floor']} |")
    lines += ["", f"Total gross: {c['gross_m2']} m2 (proposal AS-DIM-01).", "",
              "Beban hunian pembanding memakai faktor IBC 2021 Table 1004.5 (AS-OCC-01); bukan regulasi Indonesia dan bukan target okupansi.", "",
              "## Per ruang", "", "| ID | Nama | Kategori | Luas m2 | Kursi | Workstation | Beban pembanding |", "|---|---|---|---|---|---|---|"]
    for r in c["rooms"]:
        lines.append(f"| {r['id']} | {r['name']} | {r['category']} | {r['area_m2']} | {r['seats_from_fixtures']} | {r['workstations']} | {r['occupant_load_comparison']} |")
    e = c["exploration_vs_pixel_baseline"]
    lines += ["", "## Kompleksitas eksplorasi vs baseline pixel", "",
              f"- Baseline: {e['tile_baseline_cells']} sel tile, {e['pixel_areas']} area, {e['pixel_furniture']} furniture.",
              f"- Dunia ini: {e['world_rooms_non_shaft']} ruang (tanpa shaft), {e['world_fixtures']} fixture, {e['world_activity_slots']} slot aktivitas, walkable {e['world_walkable_m2']} m2.",
              f"- Rasio ruang/area {e['rooms_vs_pixel_areas_ratio']}, fixture/furniture {e['fixtures_vs_pixel_furniture_ratio']}. {e['note']}", "",
              "## Egress snapshot private (perencanaan, M4 disabled)", "", f"Rumus: `{c['private_snapshot_egress']['formula']}`.", ""]
    for v, x in c["private_snapshot_egress"]["by_viewers"].items():
        lines.append(f"- {v} viewer: {x['bytes_per_second']:.0f} B/s, {x['GB_per_hour']} GB/jam, {x['GB_per_30d_if_continuous']} GB/30 hari jika terus-menerus.")
    lines.append(f"- Server membaca sumber bersama {c['private_snapshot_egress']['shared_source_reads_per_hour']:.0f} kali/jam, bukan per viewer.")
    t = c["transfer"]
    lines += ["", "## Transfer awal", "", f"- 25 MB pada 10 Mbps: {t['mobile_initial_seconds']:.1f} s; 60 MB: {t['desktop_initial_seconds']:.1f} s.",
              f"- Target cold start 8 s pada 10 Mbps mengizinkan maksimal {t['max_initial_MB_for_cold_start_target']:.1f} MB awal (tanpa latency).",
              f"- Temuan: {t['finding']}", "", "## Anggaran triangle", ""]
    tri = c["triangles"]
    lines += [f"- Karakter LOD0: 1 pemain x 25k + {tri['npc_count']} NPC x 15k = {tri['characters_lod0_budget']}.",
              f"- Sisa untuk lingkungan pada scene mobile 250k: {tri['environment_remaining_mobile']}.", "",
              "## Pemeliharaan (proposal)", ""]
    m = c["maintenance_hours_monthly"]
    for k, v in m["items"].items():
        lines.append(f"- {k}: {v} jam/bulan")
    lines.append(f"- Total: {m['total']} jam/bulan ({m['status']}).")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=str(ROOT / "design" / "derived" / "capacity.json"))
    ap.add_argument("--md", default=str(ROOT / "docs" / "capacity.md"))
    args = ap.parse_args()
    c = compute(load_world())
    Path(args.json).write_text(json.dumps(c, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    Path(args.md).write_text(to_markdown(c), encoding="utf-8")
    print(json.dumps({k: c[k] for k in ("gross_m2", "world_revision")} | {
        "floors": {k: {kk: v[kk] for kk in ("rooms", "seats_from_fixtures", "workstations", "walkable_m2_navgrid")} for k, v in c["floors"].items()},
        "explore": c["exploration_vs_pixel_baseline"], "transfer_s": c["transfer"]["mobile_initial_seconds"],
        "maint": c["maintenance_hours_monthly"]["total"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
