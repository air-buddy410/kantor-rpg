"""Derive cable routes, port map, PoE totals and BOM counts from world.json.

Lengths follow the pathway graph (tray polylines + riser + vertical drops +
labelled slack), never straight lines through walls. Prices are deliberately
absent: no dated quote exists (AS-ICT-05). Everything is a virtual design; no
production device, IP or ISP topology is referenced.

Usage: python3 tools/ict_derive.py [--out design/derived]
       python3 tools/ict_derive.py --layout studio-export.json [--out build/ict-layout]
"""
from __future__ import annotations

import argparse
import csv
import heapq
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.kantor.geometry import load_world, room_at  # noqa: E402
from tools.kantor.ict_follow import apply_layout  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
BOX_M = 305  # common bulk box length for copper cable (1000 ft); count only, no price
SPARE_TARGET = 0.2


def _key(p):
    return (round(p[0], 4), round(p[1], 4))


class TrayGraph:
    """Vertices are (floor, x, y); edges follow tray polylines and pathway edges."""

    def __init__(self, world):
        pw = world["ict"]["pathways"]
        self.pw = pw
        self.adj = {}
        self.node_pos = {n["id"]: (n["floor"], _key(n["pos"])) for n in pw["nodes"]}
        self.trays = pw["trays"]
        self.extra_points = {t["id"]: [] for t in self.trays}
        # tray intersections
        for a in self.trays:
            for b in self.trays:
                if a["floor"] == b["floor"] and a["id"] < b["id"]:
                    p = self._intersect(a, b)
                    if p:
                        self.extra_points[a["id"]].append(p)
                        self.extra_points[b["id"]].append(p)
        for t in self.trays:
            for node_id, at in t["joins"]:
                self.extra_points[t["id"]].append(_key(at))
                self._edge(self.node_pos[node_id], (t["floor"], _key(at)), "join")
        for a, b in pw["edges"]:
            fa, pa = self.node_pos[a]
            fb, pb = self.node_pos[b]
            kind = "riser" if fa != fb else "path"
            self._edge((fa, pa), (fb, pb), kind)

    @staticmethod
    def _intersect(a, b):
        (ax0, ay0), (ax1, ay1) = a["from"], a["to"]
        (bx0, by0), (bx1, by1) = b["from"], b["to"]
        if ay0 == ay1 and bx0 == bx1:
            x, y = bx0, ay0
            if min(ax0, ax1) <= x <= max(ax0, ax1) and min(by0, by1) <= y <= max(by0, by1):
                return _key((x, y))
        if ax0 == ax1 and by0 == by1:
            return TrayGraph._intersect(b, a)
        return None

    def _edge(self, u, v, kind):
        if u[0] != v[0]:
            length = self.pw["riserVertical"]
        else:
            length = math.dist(u[1], v[1])
        self.adj.setdefault(u, []).append((v, length, kind))
        self.adj.setdefault(v, []).append((u, length, kind))

    def build(self, branch_points):
        """Connect consecutive points along each tray, including branch points."""
        for t in self.trays:
            pts = {_key(t["from"]), _key(t["to"])} | set(self.extra_points[t["id"]])
            pts |= {p for (tid, p) in branch_points if tid == t["id"]}
            horizontal = t["from"][1] == t["to"][1]
            ordered = sorted(pts, key=lambda p: p[0] if horizontal else p[1])
            for a, b in zip(ordered, ordered[1:]):
                self._edge((t["floor"], a), (t["floor"], b), "tray")

    def shortest(self, src, dst):
        dist = {src: 0.0}
        prev = {}
        pq = [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == dst:
                break
            if d > dist[u]:
                continue
            for v, w, _ in self.adj.get(u, []):
                nd = d + w
                if nd < dist.get(v, 1e18) - 1e-12:
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(pq, (nd, v))
        if dst not in dist:
            return None, None
        path = [dst]
        while path[-1] != src:
            path.append(prev[path[-1]])
        return dist[dst], path[::-1]


def branch_candidates(world, outlet, trays):
    """Perpendicular drop points from trays whose drop stays inside corridor + outlet room."""
    out = []
    ox, oy = outlet["pos"]
    for t in trays:
        if t["floor"] != outlet["floor"]:
            continue
        (x0, y0), (x1, y1) = t["from"], t["to"]
        if y0 == y1:
            bx, by = min(max(ox, min(x0, x1)), max(x0, x1)), y0
        else:
            bx, by = x0, min(max(oy, min(y0, y1)), max(y0, y1))
        tray_room = room_at(world, t["floor"], (bx, by))
        ok = True
        # Manhattan drop: along tray-perpendicular first, then parallel.
        corner = (bx, oy) if y0 == y1 else (ox, by)
        for a, b in (((bx, by), corner), (corner, (ox, oy))):
            for k in range(1, 40):
                p = (a[0] + (b[0] - a[0]) * k / 40, a[1] + (b[1] - a[1]) * k / 40)
                r = room_at(world, t["floor"], p)
                if r not in (tray_room, outlet["room"]):
                    ok = False
                    break
            if not ok:
                break
        if ok:
            drop = abs(ox - bx) + abs(oy - by)
            out.append((t["id"], _key((bx, by)), drop, corner))
    return out


def derive(world):
    ict = world["ict"]
    pw = ict["pathways"]
    g = TrayGraph(world)
    plans = {}
    branch_points = set()
    for o in ict["outlets"]:
        cands = branch_candidates(world, o, pw["trays"])
        plans[o["id"]] = cands
        for tid, p, _, _ in cands:
            branch_points.add((tid, p))
    g.build(branch_points)
    src = g.node_pos["PN-L1-RK"]
    cables, errors = [], []
    pp_ports = []
    for rk in ict["racks"]:
        for c in sorted(rk["contents"], key=lambda c: -c["u"]):
            if c["type"].startswith("patch_panel"):
                n = ict["rackDeviceTypes"][c["type"]]["ports"]
                pp_ports += [(rk["id"], c["device"], i) for i in range(1, n + 1)]
    switches = []
    for rk in ict["racks"]:
        for c in sorted(rk["contents"], key=lambda c: -c["u"]):
            if c["type"].startswith("switch_access"):
                spec = ict["rackDeviceTypes"][c["type"]]
                switches.append({"id": c["device"], "rack": rk["id"], "ports": spec["ports"], "uplinks": spec["uplinks"], "used": 0})
    # PoE endpoints first so they land on PoE-capable access ports deterministically.
    devices = {d["id"]: d for d in ict["devices"]}
    order = sorted(ict["outlets"], key=lambda o: (0 if o["serves"] in devices else 1, o["id"]))
    pp_i = 0
    total_ports = sum(o["ports"] for o in ict["outlets"])
    poe = {}
    for o in order:
        best = None
        for tid, bp, drop, corner in plans[o["id"]]:
            d, path = g.shortest(src, (o["floor"], bp))
            if d is None:
                continue
            if best is None or d + drop < best[0]:
                best = (d + drop, d, drop, path, tid, corner)
        if best is None:
            errors.append(f"{o['id']}: no route")
            continue
        total_h, tray_len, drop, path, tid, corner = best
        risers = sum(1 for a, b in zip(path, path[1:]) if a[0] != b[0])
        horiz = tray_len - risers * pw["riserVertical"] + drop
        vertical = pw["rackRise"] + risers * pw["riserVertical"] + (pw["trayHeight"] - o["z"] if o["z"] < pw["trayHeight"] else 0)
        slack = pw["slack"]["rack"] + pw["slack"]["outlet"]
        length = math.ceil((horiz + vertical + slack) * 10) / 10
        polyline = [[p[1][0], p[1][1], p[0]] for p in path] + [[corner[0], corner[1], o["floor"]], [o["pos"][0], o["pos"][1], o["floor"]]]
        for k in range(o["ports"]):
            port_id = f"{o['id']}-{chr(65 + k)}"
            if pp_i >= len(pp_ports):
                errors.append(f"{port_id}: patch panel ports exhausted")
                continue
            rack, pp, ppn = pp_ports[pp_i]
            pp_i += 1
            # Spread ports evenly so every switch keeps spare capacity.
            sw = switches[(pp_i - 1) * len(switches) // total_ports]
            if sw["used"] >= sw["ports"] - sw["uplinks"]:
                errors.append(f"{port_id}: switch ports exhausted on {sw['id']}")
                continue
            sw["used"] += 1
            serves = o["serves"]
            endpoint = o["endpointTypes"][k] if k < len(o["endpointTypes"]) else "spare"
            poe_cls = devices[serves]["poeClass"] if serves in devices and k == 0 else None
            if poe_cls:
                poe[sw["id"]] = poe.get(sw["id"], 0) + ict["poeClasses"][str(poe_cls)]["pseW"]
            cables.append({
                "cable": f"C-{port_id}", "outletPort": port_id, "outlet": o["id"], "floor": o["floor"], "room": o["room"],
                "serves": serves, "endpoint": endpoint, "domain": o["domain"], "rack": rack, "patchPanel": pp, "ppPort": ppn,
                "switch": sw["id"], "switchPort": sw["used"], "poeClass": poe_cls,
                "length_m": length, "horizontal_m": round(horiz, 2), "vertical_m": round(vertical, 2), "slack_m": slack,
                "tray": tid, "route": polyline,
                "labelRackEnd": f"{pp}-{ppn:02d} > {port_id}", "labelOutletEnd": f"{port_id} > {pp}-{ppn:02d}",
            })
    over = [c["cable"] for c in cables if c["length_m"] > pw["maxLinkM"]]
    if over:
        errors.append(f"over {pw['maxLinkM']} m: {over}")
    used_pp = {(c["patchPanel"], c["ppPort"]) for c in cables}
    used_sw = {(c["switch"], c["switchPort"]) for c in cables}
    if len(used_pp) != len(cables) or len(used_sw) != len(cables):
        errors.append("duplicate patch/switch port assignment")
    usable = sum(s["ports"] - s["uplinks"] for s in switches)
    if (usable - len(cables)) / usable < SPARE_TARGET:
        errors.append(f"switch spare below {SPARE_TARGET:.0%}: {usable - len(cables)}/{usable}")
    total_m = round(sum(c["length_m"] for c in cables), 1)
    sw_summary = [{"switch": s["id"], "ports": s["ports"], "uplinksReserved": s["uplinks"], "used": s["used"],
                   "spare": s["ports"] - s["uplinks"] - s["used"],
                   "spareRatio": round((s["ports"] - s["uplinks"] - s["used"]) / (s["ports"] - s["uplinks"]), 3),
                   "poeWorstCaseW": round(poe.get(s["id"], 0), 1), "poeBudgetW": None,
                   "poeStatus": "belum divalidasi: datasheet switch belum dipilih"} for s in switches]
    pp_count = sum(1 for rk in ict["racks"] for c in rk["contents"] if c["type"].startswith("patch_panel"))
    faceplates = {}
    for o in ict["outlets"]:
        faceplates[o["ports"]] = faceplates.get(o["ports"], 0) + 1
    bom = {
        "status": "jumlah turunan dari port map; tanpa harga (AS-ICT-05)",
        "items": [
            {"item": "Kabel tembaga horizontal (kategori TBD)", "unit": "m", "qty": total_m},
            {"item": f"Box kabel {BOX_M} m (pembulatan, belum termasuk waste)", "unit": "box", "qty": math.ceil(total_m / BOX_M)},
            {"item": "Keystone jack sisi outlet", "unit": "pcs", "qty": len(cables)},
            *[{"item": f"Faceplate {k} port", "unit": "pcs", "qty": v} for k, v in sorted(faceplates.items())],
            {"item": "Patch panel 24 port", "unit": "pcs", "qty": pp_count},
            {"item": "Patch cord sisi rack (1 per port terpakai, asumsi)", "unit": "pcs", "qty": len(cables)},
            {"item": "Patch cord sisi perangkat (1 per port terpakai, asumsi)", "unit": "pcs", "qty": len(cables)},
            {"item": "Access switch 48 port PoE (kelas, model TBD)", "unit": "pcs", "qty": len(switches)},
            {"item": "Access point (placeholder AS-ICT-01)", "unit": "pcs", "qty": sum(1 for d in ict["devices"] if d["type"] == "ap")},
            {"item": "Kamera konsep (opsional)", "unit": "pcs", "qty": sum(1 for d in ict["devices"] if d["type"] == "camera")},
            {"item": "Rack 42U (target)", "unit": "pcs", "qty": len(ict["racks"])},
            {"item": "UPS (rating TBD)", "unit": "pcs", "qty": 1},
        ],
        "price": None, "priceSource": "tidak ada quote bertanggal; tidak diestimasi",
    }
    return {
        "status": "rancangan virtual; panjang dari route tray + vertikal + slack berlabel",
        "worldRevision": world["revision"]["id"],
        "assumptions": pw["assumptions"],
        "cables": cables,
        "switches": sw_summary,
        "poeTotalWorstCaseW": round(sum(poe.values()), 1),
        "totals": {"outlets": len(ict["outlets"]), "ports": len(cables), "cable_m": total_m,
                   "max_length_m": max(c["length_m"] for c in cables), "min_length_m": min(c["length_m"] for c in cables),
                   "patchPanelPorts": len(pp_ports), "patchPanelPortsUsed": len(cables)},
        "bom": bom,
        "errors": errors,
    }


def load_layout(path: Path, world: dict) -> list[dict]:
    """Minimal guarded reader for a Studio export; sizes come from the catalog,
    never from the file (same rule as app/src/studio/layout.ts)."""
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("format") != "kantor-rpg-layout" or doc.get("version") not in (1, 2):
        raise SystemExit(f"{path}: not a kantor-rpg layout v1/v2")
    if doc.get("worldRevision") != world["revision"]["id"]:
        raise SystemExit(f"{path}: layout for {doc.get('worldRevision')}, dataset is {world['revision']['id']}")
    rooms = {r["id"]: r["floor"] for r in world["rooms"]}
    fixtures = []
    for f in doc["fixtures"]:
        cat = world["catalog"].get(f["type"])
        if cat is None or rooms.get(f["room"]) != f["floor"]:
            raise SystemExit(f"{path}: bad fixture {f.get('id')}")
        rec = {"id": f["id"], "floor": f["floor"], "room": f["room"], "type": f["type"],
               "asset": "AST-" + f["type"].upper().replace("_", "-"), "pos": [float(f["pos"][0]), float(f["pos"][1])],
               "rot": int(f["rot"]), "size": list(cat["size"]), "collider": cat["collider"]}
        for k in ("pairedWith", "artwork", "verticalLink", "ictRack"):
            if k in f:
                rec[k] = f[k]
        fixtures.append(rec)
    return fixtures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="default design/derived, or build/ict-layout with --layout")
    ap.add_argument("--layout", help="Office Studio export (kantor-rpg-layout); outlets follow its furniture")
    args = ap.parse_args()
    world = load_world()
    follow = None
    if args.layout:
        world, follow = apply_layout(world, load_layout(Path(args.layout), world))
    out = Path(args.out or (ROOT / "build" / "ict-layout" if args.layout else ROOT / "design" / "derived"))
    out.mkdir(parents=True, exist_ok=True)
    res = derive(world)
    if follow:
        res["layout"] = {"source": Path(args.layout).name, "moved": follow["moved"], "removed": follow["removed"], "added": follow["added"]}
    (out / "ict-portmap.json").write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    with (out / "ict-portmap.csv").open("w", newline="", encoding="utf-8") as fh:
        cols = ["cable", "outletPort", "floor", "room", "serves", "endpoint", "domain", "rack", "patchPanel", "ppPort",
                "switch", "switchPort", "poeClass", "length_m", "labelRackEnd", "labelOutletEnd"]
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for c in res["cables"]:
            w.writerow(c)
    print(json.dumps({"totals": res["totals"], "poeTotalWorstCaseW": res["poeTotalWorstCaseW"],
                      "switches": [(s["switch"], s["used"], s["spareRatio"]) for s in res["switches"]],
                      "errors": res["errors"]}, ensure_ascii=False))
    return 1 if res["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
