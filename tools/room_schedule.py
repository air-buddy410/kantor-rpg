"""Room schedule + adjacency derived from design/world.json.

Outputs design/derived/room-schedule.json, .csv and docs/room-schedule.md.
Adjacency lists two relations: shared wall (geometry) and door-connected
(navigation), plus the result of each adjacency rule from the validator.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.kantor.geometry import load_world, polygon_area  # noqa: E402
from tools.validate_world import _share_edge, check_adjacency, Report, check_navigation  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def build(world):
    seats = {}
    for s in world["activitySlots"]:
        if s["pose"] == "sit":
            seats[s["room"]] = seats.get(s["room"], 0) + 1
    rows = []
    for r in world["rooms"]:
        furn = {}
        for fx in world["fixtures"]:
            if fx["room"] == r["id"]:
                furn[fx["type"]] = furn.get(fx["type"], 0) + 1
        doors = [d["id"] for d in world["doors"] if r["id"] in d["rooms"]]
        via_door = sorted({x for d in world["doors"] if r["id"] in d["rooms"] for x in d["rooms"] if x != r["id"]})
        walls = sorted(o["id"] for o in world["rooms"] if o["id"] != r["id"] and o["floor"] == r["floor"]
                       and _share_edge(r["polygon"], o["polygon"]))
        outlets = [o for o in world["ict"]["outlets"] if o["room"] == r["id"]]
        rows.append({
            "id": r["id"], "name": r["name"], "floor": r["floor"], "category": r["category"], "access": r["access"],
            "noise": r["noise"], "function": r["function"], "polygon": r["polygon"],
            "area_m2": round(polygon_area(r["polygon"]), 2), "seats": seats.get(r["id"], 0),
            "doors": doors, "doorConnected": via_door, "sharedWall": walls, "furnishing": furn,
            "ictOutlets": len(outlets), "ictPorts": sum(o["ports"] for o in outlets), "ictProfile": r["ict"],
            "finish": r["finish"], "status": r["status"], "assumptions": r["assumptions"],
        })
    rep = Report()
    grids, _ = check_navigation(world, rep)
    rules = check_adjacency(world, rep, grids)
    return {"worldRevision": world["revision"]["id"], "status": "proposal konsep, bukan program ruang yang disahkan",
            "rooms": rows, "adjacencyRules": rules}


def to_md(s):
    out = ["# Room schedule dan adjacency", "",
           f"Turunan `design/world.json` revisi {s['worldRevision']} oleh `tools/room_schedule.py`. Status: {s['status']}.",
           "Luas diukur pada garis as dinding (AS-DIM-02). Kursi = slot duduk dari fixture (AS-OCC-02).", ""]
    for floor in ("L1", "L2"):
        out += [f"## {'Lantai 1 (kerja & kunjungan)' if floor == 'L1' else 'Lantai 2 (rekreasi)'}", "",
                "| ID | Nama | Kategori | Akses | Bising | Luas m2 | Kursi | Pintu | Terhubung pintu | Outlet/port ICT | Lantai finish |",
                "|---|---|---|---|---|---|---|---|---|---|---|"]
        for r in s["rooms"]:
            if r["floor"] != floor:
                continue
            out.append(f"| {r['id']} | {r['name']} | {r['category']} | {r['access']} | {r['noise']} | {r['area_m2']} | {r['seats']} | "
                       f"{', '.join(r['doors'])} | {', '.join(r['doorConnected'])} | {r['ictOutlets']}/{r['ictPorts']} | {r['finish']['floor']} |")
        out.append("")
    out += ["## Furnishing per ruang", ""]
    for r in s["rooms"]:
        if r["furnishing"]:
            items = ", ".join(f"{k} x{v}" for k, v in sorted(r["furnishing"].items()))
            out.append(f"- {r['id']}: {items}")
    out += ["", "## Aturan adjacency (hasil validator)", "", "| ID | Aturan | Hasil | Detail |", "|---|---|---|---|"]
    for a in s["adjacencyRules"]:
        out.append(f"| {a['id']} | {a['text']} | {'lolos' if a['ok'] else 'GAGAL'} | {json.dumps(a['detail'], ensure_ascii=False)} |")
    out += ["", "Aturan jalur keluar hanya menghitung pintu exit konsep; kepatuhan peraturan tidak diklaim (AS-EXIT-01)."]
    return "\n".join(out) + "\n"


def main():
    s = build(load_world())
    d = ROOT / "design" / "derived"
    d.mkdir(parents=True, exist_ok=True)
    (d / "room-schedule.json").write_text(json.dumps(s, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    with (d / "room-schedule.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "name", "floor", "category", "access", "noise", "area_m2", "seats", "doors", "doorConnected", "sharedWall", "ictOutlets", "ictPorts"])
        for r in s["rooms"]:
            w.writerow([r["id"], r["name"], r["floor"], r["category"], r["access"], r["noise"], r["area_m2"], r["seats"],
                        " ".join(r["doors"]), " ".join(r["doorConnected"]), " ".join(r["sharedWall"]), r["ictOutlets"], r["ictPorts"]])
    (ROOT / "docs" / "room-schedule.md").write_text(to_md(s), encoding="utf-8")
    print(f"rooms={len(s['rooms'])} rules_ok={sum(a['ok'] for a in s['adjacencyRules'])}/{len(s['adjacencyRules'])}")


if __name__ == "__main__":
    main()
