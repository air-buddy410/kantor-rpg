"""Validate design/world.json: schema, geometry, navigation, adjacency, ICT keys.

Exit code 0 only when every check passes. Prints a JSON report so evidence
files capture what was actually checked, not just "ok".

Usage: python3 tools/validate_world.py [--world path] [--report out.json]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.kantor.geometry import (WORLD_PATH, derive_walls, fixture_corners, is_orthogonal,  # noqa: E402
                                   point_in_polygon, polygon_area, room_at, room_by_id)
from tools.kantor.nav import NavGrid  # noqa: E402

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "design" / "world.schema.json"
TOL = 0.011


class Report:
    def __init__(self):
        self.checks = []

    def check(self, name, ok, detail=None):
        self.checks.append({"check": name, "ok": bool(ok), "detail": detail})
        return ok

    @property
    def failures(self):
        return [c for c in self.checks if not c["ok"]]


def _rect_poly(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _sat_overlap(a, b, eps=1e-6):
    """Separating-axis test for convex quads; touching edges do not overlap."""
    for poly in (a, b):
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
            nx, ny = y1 - y0, x0 - x1
            pa = [nx * x + ny * y for x, y in a]
            pb = [nx * x + ny * y for x, y in b]
            n = math.hypot(nx, ny)
            if max(pa) <= min(pb) + eps * n or max(pb) <= min(pa) + eps * n:
                return False
    return True


def check_schema(world, rep):
    try:
        import jsonschema
    except ImportError:
        return rep.check("schema", False, "jsonschema not installed")
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    errors = sorted(jsonschema.Draft202012Validator(schema).iter_errors(world), key=lambda e: list(e.path))
    return rep.check("schema", not errors, [f"{list(e.path)}: {e.message}" for e in errors[:20]])


def check_ids(world, rep):
    ids = []
    for key in ("floors", "rooms", "doors", "verticalLinks", "fixtures", "activitySlots", "waypoints", "actors", "assumptions"):
        ids += [x["id"] for x in world[key]]
    ict = world["ict"]
    ids += [x["id"] for x in ict["outlets"]] + [x["id"] for x in ict["devices"]] + [x["id"] for x in ict["racks"]]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    return rep.check("unique_ids", not dup, dup)


def check_rooms(world, rep):
    ok = True
    for floor in world["floors"]:
        env = floor["envelope"]
        rooms = [r for r in world["rooms"] if r["floor"] == floor["id"]]
        bad_ortho = [r["id"] for r in rooms if not is_orthogonal(r["polygon"])]
        ok &= rep.check(f"rooms_orthogonal_{floor['id']}", not bad_ortho, bad_ortho)
        outside = [r["id"] for r in rooms if not all(point_in_polygon(p, env) for p in r["polygon"])]
        ok &= rep.check(f"rooms_in_envelope_{floor['id']}", not outside, outside)
        total = sum(polygon_area(r["polygon"]) for r in rooms)
        env_area = polygon_area(env)
        ok &= rep.check(f"rooms_cover_envelope_{floor['id']}", abs(total - env_area) < 1e-6,
                        {"rooms_m2": round(total, 3), "envelope_m2": env_area})
        # Overlap via sampling on a 0.25 m lattice of cell centres: with full
        # coverage and equal areas, any overlap would leave a gap elsewhere.
        xs = [p[0] for p in env]
        ys = [p[1] for p in env]
        gaps, overlaps = [], []
        step = 0.25
        y = min(ys) + step / 2
        while y < max(ys):
            x = min(xs) + step / 2
            while x < max(xs):
                hits = [r["id"] for r in rooms if _strict_inside((x, y), r["polygon"])]
                if len(hits) == 0:
                    gaps.append((x, y))
                elif len(hits) > 1:
                    overlaps.append((x, y, hits))
                x += step
            y += step
        ok &= rep.check(f"rooms_no_overlap_{floor['id']}", not overlaps, overlaps[:5])
        ok &= rep.check(f"rooms_no_gap_{floor['id']}", not gaps, gaps[:5])
    return ok


def _strict_inside(pt, poly):
    x, y = pt
    inside = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
            if x < xi:
                inside = not inside
    return inside


def check_doors(world, rep):
    rooms = room_by_id(world)
    problems = []
    for d in world["doors"]:
        cx, cy = d["center"]
        half = d["width"] / 2
        if d["wallAxis"] == "x":
            a, b = (cx - half, cy), (cx + half, cy)
        else:
            a, b = (cx, cy - half), (cx, cy + half)
        for rid in d["rooms"]:
            if rid == "EXT":
                env = next(f for f in world["floors"] if f["id"] == d["floor"])["envelope"]
                if not (_on_boundary(a, env) and _on_boundary(b, env)):
                    problems.append(f"{d['id']}: not on envelope")
                continue
            r = rooms.get(rid)
            if not r or r["floor"] != d["floor"]:
                problems.append(f"{d['id']}: bad room {rid}")
                continue
            if not (_on_boundary(a, r["polygon"]) and _on_boundary(b, r["polygon"])):
                problems.append(f"{d['id']}: opening not on boundary of {rid}")
    return rep.check("doors_on_shared_walls", not problems, problems)


def _on_boundary(pt, poly):
    from tools.kantor.geometry import point_on_segment
    return any(point_on_segment(pt, a, b) for a, b in zip(poly, poly[1:] + poly[:1]))


def check_fixtures(world, rep):
    rooms = room_by_id(world)
    inner = world["building"]["wall"]["interior"] / 2
    outer = world["building"]["wall"]["exterior"] / 2
    misplaced, overlaps = [], []
    for fx in world["fixtures"]:
        poly = rooms[fx["room"]]["polygon"]
        corners = fixture_corners(fx)
        # Shrink by wall half-thickness: test corners pulled toward the centre.
        cx, cy = fx["pos"]
        for x, y in corners:
            if not point_in_polygon((x, y), poly):
                misplaced.append(f"{fx['id']} corner {round(x, 3), round(y, 3)} outside {fx['room']}")
                break
            # distance to the room edges must leave room for the wall body
            for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
                env_edge = (y0 == y1 and y0 in (0, 24)) or (x0 == x1 and x0 in (0, 32))
                need = (outer if env_edge else inner) - TOL
                if y0 == y1 and min(x0, x1) < x < max(x0, x1) and abs(y - y0) < need:
                    misplaced.append(f"{fx['id']} intrudes wall y={y0}")
                if x0 == x1 and min(y0, y1) < y < max(y0, y1) and abs(x - x0) < need:
                    misplaced.append(f"{fx['id']} intrudes wall x={x0}")
    rep.check("fixtures_inside_rooms", not misplaced, misplaced[:20])
    cols = [f for f in world["fixtures"] if f["collider"]]
    for i, a in enumerate(cols):
        ca = fixture_corners(a)
        for b in cols[i + 1:]:
            if a["floor"] != b["floor"]:
                continue
            if _sat_overlap(ca, fixture_corners(b)):
                overlaps.append(f"{a['id']}x{b['id']}")
    rep.check("fixtures_no_overlap", not overlaps, overlaps[:20])
    # Door swing/approach zones: 0.9 m both sides of the opening must stay clear.
    blocked_doors = []
    for d in world["doors"]:
        if d["type"] == "hatch":
            continue
        cx, cy = d["center"]
        half = d["width"] / 2
        zone = _rect_poly(cx - half, cy - 0.9, cx + half, cy + 0.9) if d["wallAxis"] == "x" else \
            _rect_poly(cx - 0.9, cy - half, cx + 0.9, cy + half)
        for fx in cols:
            if fx["floor"] == d["floor"] and _sat_overlap(zone, fixture_corners(fx)):
                blocked_doors.append(f"{d['id']} blocked by {fx['id']}")
    rep.check("door_zones_clear", not blocked_doors, blocked_doors)
    # Functional clearances (rack service space, billiard cue zone).
    clr = []
    for fx in world["fixtures"]:
        c = world["catalog"][fx["type"]].get("clearance")
        if not c:
            continue
        zones = []
        if "cue" in c:
            pw, pd = c["playing"]
            zones.append(dict(fx, size=[pw + 2 * c["cue"], pd + 2 * c["cue"]]))
        if "front" in c:
            w, d = fx["size"][:2]
            r = math.radians(fx["rot"])
            off_f = d / 2 + c["front"] / 2
            off_r = d / 2 + c["rear"] / 2
            zones.append(dict(fx, size=[w, c["front"]], pos=[fx["pos"][0] + off_f * math.sin(r), fx["pos"][1] - off_f * math.cos(r)]))
            zones.append(dict(fx, size=[w, c["rear"]], pos=[fx["pos"][0] - off_r * math.sin(r), fx["pos"][1] + off_r * math.cos(r)]))
        room_poly = rooms[fx["room"]]["polygon"]
        for z in zones:
            zc = fixture_corners(z)
            for x, y in zc:
                if not point_in_polygon((x, y), room_poly):
                    clr.append(f"{fx['id']} clearance leaves room at {round(x, 2), round(y, 2)}")
                    break
            for other in cols:
                if other["id"] == fx["id"] or other["floor"] != fx["floor"]:
                    continue
                if other.get("ictRack") and fx.get("ictRack"):
                    continue  # racks bayed side by side share the aisle
                if _sat_overlap(zc, fixture_corners(other)):
                    clr.append(f"{fx['id']} clearance hit {other['id']}")
    rep.check("functional_clearances", not clr, clr)


def check_navigation(world, rep, grids=None):
    grids = grids or {}
    results = {}
    for mode in ("staff", "visitor"):
        floods = {}
        for floor in world["floors"]:
            g = grids.get((floor["id"], mode)) or NavGrid(world, floor["id"], mode=mode)
            grids[(floor["id"], mode)] = g
        spawn = next(w for w in world["waypoints"] if w["id"] == world["floors"][0]["spawn"])
        g1 = grids[("L1", mode)]
        floods["L1"] = g1.flood([g1.cell_of(spawn["pos"])])
        # Cross-floor: a link connects when its L1 end is reached; then seed L2.
        seeds = []
        for vl in world["verticalLinks"]:
            if vl.get("playable") is False:
                continue
            ends = {e["floor"]: e for e in vl["ends"]}
            e1 = ends["L1"]
            hit = g1.nearest_walkable(e1["point"], 1.0, floods["L1"])
            if hit:
                seeds.append(grids[("L2", mode)].cell_of(ends["L2"]["arrive"]))
        floods["L2"] = grids[("L2", mode)].flood(seeds)
        results[mode] = floods
    staff, visitor = results["staff"], results["visitor"]
    unreached = []
    for r in world["rooms"]:
        if r["category"] == "shaft":
            continue
        g = grids[(r["floor"], "staff")]
        if not _room_reached(g, staff[r["floor"]], r):
            unreached.append(r["id"])
    rep.check("nav_all_rooms_reachable_staff", not unreached, unreached)
    leaked = [r["id"] for r in world["rooms"] if r["access"] == "restricted"
              and _room_reached(grids[(r["floor"], "visitor")], visitor[r["floor"]], r)]
    rep.check("nav_restricted_locked_for_visitor", not leaked, leaked)
    public_unreached = [r["id"] for r in world["rooms"] if r["access"] == "public" and r["category"] != "shaft"
                        and not _room_reached(grids[(r["floor"], "visitor")], visitor[r["floor"]], r)]
    rep.check("nav_public_rooms_reachable_visitor", not public_unreached, public_unreached)
    slots_bad = []
    for s in world["activitySlots"]:
        g = grids[(s["floor"], "staff")]
        if not g.nearest_walkable(s["pos"], 0.9, staff[s["floor"]]):
            slots_bad.append(s["id"])
    rep.check("nav_activity_slots_approachable", not slots_bad, slots_bad)
    vl_bad = []
    for vl in world["verticalLinks"]:
        if vl.get("playable") is False:
            continue
        for e in vl["ends"]:
            g = grids[(e["floor"], "staff")]
            if not g.nearest_walkable(e["point"], 0.6, staff[e["floor"]]):
                vl_bad.append(f"{vl['id']}@{e['floor']}")
    rep.check("nav_vertical_links_usable", not vl_bad, vl_bad)
    wp_bad = [w["id"] for w in world["waypoints"]
              if not grids[(w["floor"], "staff")].nearest_walkable(w["pos"], 0.3, staff[w["floor"]])]
    rep.check("nav_waypoints_walkable", not wp_bad, wp_bad)
    door_bad = []
    for d in world["doors"]:
        if d["type"] == "hatch":
            continue
        g = grids[(d["floor"], "staff")]
        # Exterior doors sit on the envelope edge; probe just inside instead.
        reach = 0.7 if "EXT" in d["rooms"] else 0.2
        if not g.nearest_walkable(d["center"], reach, staff[d["floor"]]):
            door_bad.append(d["id"])
    rep.check("nav_doors_passable", not door_bad, door_bad)
    counts = {f"{k[0]}_{k[1]}": g.walkable_count() for k, g in sorted(grids.items())}
    rep.check("nav_walkable_counts", True, counts)
    return grids, results


def _room_reached(grid, flood, room):
    xs = [p[0] for p in room["polygon"]]
    ys = [p[1] for p in room["polygon"]]
    ia, ja = grid.cell_of((min(xs), min(ys)))
    ib, jb = grid.cell_of((max(xs), max(ys)))
    for j in range(ja, jb + 1):
        for i in range(ia, ib + 1):
            if flood[j * grid.w + i] and _strict_inside(grid.center(i, j), room["polygon"]):
                return True
    return False


def check_adjacency(world, rep, grids):
    rooms = room_by_id(world)
    out = []
    for rule in world["adjacency"]:
        ok, detail = True, None
        kind = rule["rule"]
        if kind == "near":
            d = next(x for x in world["doors"] if x["exit"] and rule["a"] in x["rooms"] and "EXT" in x["rooms"])
            ok, detail = True, d["id"]
        elif kind == "visitor_path_avoids":
            g = NavGrid(world, rooms[rule["a"]]["floor"], mode="visitor")
            ok = _path_exists_avoiding(world, g, rule["a"], rule["b"], rule["avoid"])
            detail = f"path {rule['a']}->{rule['b']} avoiding {rule['avoid']}"
        elif kind == "max_path":
            g = grids[(rooms[rule["a"]]["floor"], "staff")]
            lengths = [g.path_length(da["center"], db["center"])
                       for da in world["doors"] if rule["a"] in da["rooms"]
                       for db in world["doors"] if rule["b"] in db["rooms"]]
            lengths = [x for x in lengths if x is not None]
            length = min(lengths) if lengths else None
            ok = length is not None and length <= rule["max_m"]
            detail = {"path_m": None if length is None else round(length, 2), "max_m": rule["max_m"]}
        elif kind == "min_distance":
            a = rooms[rule["a"]]
            dmin = min(_poly_distance(a["polygon"], r["polygon"]) for r in world["rooms"]
                       if r["category"] == rule["b_category"] and r["floor"] == a["floor"])
            ok, detail = dmin >= rule["min_m"], {"min_m": round(dmin, 2), "required": rule["min_m"]}
        elif kind == "not_shared_wall":
            bad = []
            for x in world["rooms"]:
                for y in world["rooms"]:
                    if x["floor"] == y["floor"] and x["noise"] == rule["a_noise"] and y["noise"] == rule["b_noise"] \
                            and y["category"] not in rule.get("b_exclude_categories", []) \
                            and _share_edge(x["polygon"], y["polygon"]):
                        bad.append(f"{x['id']}|{y['id']}")
            ok, detail = not bad, bad
        elif kind == "stacked":
            pa, pb = rooms[rule["a"]]["polygon"], rooms[rule["b"]]["polygon"]
            ok = _overlap_area(pa, pb) > 0.5 * min(polygon_area(pa), polygon_area(pb))
            detail = {"overlap_m2": round(_overlap_area(pa, pb), 2)}
        elif kind == "restricted_door_only_from":
            bad = [d["id"] for d in world["doors"] if rule["a"] in d["rooms"]
                   and not set(d["rooms"]) - {rule["a"]} <= set(rule["allowed"])]
            ok, detail = not bad, bad
        elif kind == "exits":
            n = sum(1 for d in world["doors"] if d["floor"] == rule["floor"] and d["exit"])
            ok, detail = n >= rule["min_count"], {"exits": n}
        out.append({"id": rule["id"], "ok": ok, "detail": detail, "text": rule["text"]})
        rep.check(f"adjacency_{rule['id']}", ok, detail)
    return out


def _centroid(poly):
    return sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)


def _bbox(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def _poly_distance(a, b):
    ax0, ay0, ax1, ay1 = _bbox(a)
    bx0, by0, bx1, by1 = _bbox(b)
    dx = max(0, bx0 - ax1, ax0 - bx1)
    dy = max(0, by0 - ay1, ay0 - by1)
    return math.hypot(dx, dy)


def _share_edge(a, b):
    for (x0, y0), (x1, y1) in zip(a, a[1:] + a[:1]):
        for (u0, v0), (u1, v1) in zip(b, b[1:] + b[:1]):
            if y0 == y1 == v0 == v1:
                lo, hi = max(min(x0, x1), min(u0, u1)), min(max(x0, x1), max(u0, u1))
                if hi - lo > 1e-6:
                    return True
            if x0 == x1 == u0 == u1:
                lo, hi = max(min(y0, y1), min(v0, v1)), min(max(y0, y1), max(v0, v1))
                if hi - lo > 1e-6:
                    return True
    return False


def _overlap_area(a, b):
    ax0, ay0, ax1, ay1 = _bbox(a)
    bx0, by0, bx1, by1 = _bbox(b)
    return max(0, min(ax1, bx1) - max(ax0, bx0)) * max(0, min(ay1, by1) - max(ay0, by0))


def _path_exists_avoiding(world, grid, a, b, avoid):
    """BFS that also refuses to step into cells of the avoided rooms."""
    rooms = room_by_id(world)
    blocked = bytearray(grid.blocked)
    for rid in avoid:
        poly = rooms[rid]["polygon"]
        for j in range(grid.h):
            for i in range(grid.w):
                if _strict_inside(grid.center(i, j), poly):
                    blocked[j * grid.w + i] = 1
    saved = grid.blocked
    grid.blocked = blocked
    try:
        start = grid.nearest_walkable(_centroid(rooms[a]["polygon"]), 3.0)
        flood = grid.flood([start[1]])
        return _room_reached(grid, flood, rooms[b])
    finally:
        grid.blocked = saved


def check_ict(world, rep):
    ict = world["ict"]
    fixtures = {f["id"]: f for f in world["fixtures"]}
    devices = {d["id"]: d for d in ict["devices"]}
    outlets = {o["id"]: o for o in ict["outlets"]}
    rooms = room_by_id(world)
    bad = []
    for o in ict["outlets"]:
        if o["serves"] not in fixtures and o["serves"] not in devices:
            bad.append(f"{o['id']} serves unknown {o['serves']}")
        if o["room"] not in rooms or not point_in_polygon(o["pos"], rooms[o["room"]]["polygon"]):
            bad.append(f"{o['id']} not inside {o['room']}")
        if o["domain"] not in {d["id"] for d in ict["domains"]}:
            bad.append(f"{o['id']} unknown domain")
    for d in ict["devices"]:
        if d.get("outlet") not in outlets:
            bad.append(f"{d['id']} outlet missing")
        if room_at(world, d["floor"], d["pos"]) != d["room"]:
            bad.append(f"{d['id']} position not in {d['room']}")
    for rk in ict["racks"]:
        if rk["fixture"] not in fixtures:
            bad.append(f"{rk['id']} fixture missing")
        used = set()
        for c in rk["contents"]:
            for u in range(c["u"], c["u"] + c["height"]):
                if u in used or u < 1 or u > rk["units"]:
                    bad.append(f"{rk['id']} U{u} collision/out of range ({c['device']})")
                used.add(u)
    rep.check("ict_foreign_keys", not bad, bad)
    wet = {r["id"] for r in world["rooms"] if r["category"] == "wet"}
    cams = [d["id"] for d in ict["devices"] if d["type"] == "camera" and d["room"] in wet]
    rep.check("ict_no_camera_in_wet_rooms", not cams, cams)
    homes = [a["id"] for a in world["actors"] if a["kind"] == "npc" and a.get("homeSeat") not in fixtures]
    rep.check("actors_home_seats_exist", not homes, homes)


def check_derivations(world, rep):
    """world.json must equal the authoring script output (no silent drift)."""
    import importlib.util
    path = Path(__file__).resolve().parents[1] / "design" / "authoring" / "seed_world.py"
    spec = importlib.util.spec_from_file_location("seed_world", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    fresh = json.loads(mod.dumps(mod.build()))
    rep.check("world_matches_authoring_seed", fresh == world, None if fresh == world else "regenerate with design/authoring/seed_world.py")


def run(world, skip_seed=False):
    rep = Report()
    check_schema(world, rep)
    check_ids(world, rep)
    check_rooms(world, rep)
    check_doors(world, rep)
    check_fixtures(world, rep)
    grids, _ = check_navigation(world, rep)
    adjacency = check_adjacency(world, rep, grids)
    check_ict(world, rep)
    if not skip_seed:
        check_derivations(world, rep)
    walls = {f["id"]: len(derive_walls(world, f["id"])[0]) for f in world["floors"]}
    rep.check("walls_derived", all(walls.values()), walls)
    return rep, adjacency


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--world", default=str(WORLD_PATH))
    ap.add_argument("--report")
    ap.add_argument("--skip-seed", action="store_true")
    args = ap.parse_args()
    world = json.loads(Path(args.world).read_text(encoding="utf-8"))
    rep, adjacency = run(world, args.skip_seed)
    out = {"world": args.world, "revision": world["revision"], "checks": rep.checks,
           "passed": sum(c["ok"] for c in rep.checks), "failed": len(rep.failures), "adjacency": adjacency}
    text = json.dumps(out, indent=1, ensure_ascii=False)
    if args.report:
        Path(args.report).write_text(text + "\n", encoding="utf-8")
    for c in rep.checks:
        print(("PASS " if c["ok"] else "FAIL ") + c["check"] + ("" if c["ok"] else f"  {c['detail']}"))
    print(f"passed={out['passed']} failed={out['failed']}")
    return 1 if rep.failures else 0


if __name__ == "__main__":
    sys.exit(main())
