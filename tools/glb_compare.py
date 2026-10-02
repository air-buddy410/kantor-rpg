#!/usr/bin/env python3
"""Compare every shipped GLB with the Blender export it was optimised from.

  python3 tools/glb_compare.py [--out docs/evidence/current/glb-compare.json]

Pairs blender/out/raw-glb/<kind>/<name>.glb (Blender export) with
app/public/assets/<kind>/<name>.glb (tools/glb_optimize.mjs output) for kind in
characters, furniture. The reader is blender/lib/glb_read.py (stdlib, shared with
the validators), not glTF-Transform, so the optimiser is not checking itself.

Structure that must be identical: node names, parents, extras and non-mesh TRS;
scene extras; mesh names/extras, primitive count, material per primitive,
attribute sets, morph target count, index lists (same topology and vertex order);
material names, factors, extras and extensions; texture samplers; image bytes;
skin joint names; animation names and clip durations.

Measured (worst case per file), with the limits that make the file fail:
  position (rest pose, metres)            <= 1 mm
  morph target delta (metres)             <= 1 mm, and no vertex moves that did not move
  UV atlas cell per vertex                identical (characters)
  joint rotation over every raw key time  <= 0.05 degree
  joint translation / scale               <= 1 mm / 1e-4
  skinned vertex position in every key pose of every clip   <= 1 mm
  normal direction and skin weight error are reported (int8 / uint8 by design).
Exit 1 when any file fails or a raw/shipped pair is missing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "blender" / "lib"))
import glb_read as G  # noqa: E402

RAW = ROOT / "blender" / "out" / "raw-glb"
SHIP = ROOT / "app" / "public" / "assets"
KINDS = ("characters", "furniture")
LIMITS = {"positionM": 0.001, "morphM": 0.001, "rotationDeg": 0.05, "translationM": 0.001, "scale": 1e-4,
          "posedM": 0.001}
TRS_DEFAULT = {"translation": (0.0, 0.0, 0.0), "rotation": (0.0, 0.0, 0.0, 1.0), "scale": (1.0, 1.0, 1.0)}


def rel(p: Path) -> str:
    p = Path(p).resolve()
    return p.relative_to(ROOT).as_posix() if p.is_relative_to(ROOT) else p.as_posix()


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def arr(g, idx):
    a = np.array(g.accessor(idx), dtype=np.float64)
    return a.reshape(len(a), -1)


def m4(m16):
    return np.array(m16, dtype=np.float64).reshape(4, 4).T  # glTF is column-major


def apply(m, pts):
    return pts @ m[:3, :3].T + m[:3, 3]


def close(a, b, tol=1e-6):
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(close(a[k], b[k], tol) for k in a)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(close(x, y, tol) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= tol
    return a == b


class Checks:
    def __init__(self):
        self.items = []

    def __call__(self, name, ok, detail=None):
        self.items.append({"check": name, "ok": bool(ok), "detail": detail})
        return ok

    @property
    def ok(self):
        return all(c["ok"] for c in self.items)


# --- animation evaluation (glTF 2.0 STEP / LINEAR; slerp for rotations) ----------

def slerp(q0, q1, u):
    d = float(np.dot(q0, q1))
    if d < 0:
        q1, d = -q1, -d
    if d > 0.9995:
        q = q0 + (q1 - q0) * u
        return q / np.linalg.norm(q)
    th = math.acos(min(1.0, d))
    s = math.sin(th)
    return (math.sin((1 - u) * th) * q0 + math.sin(u * th) * q1) / s


def sample(track, t):
    times, values, interp, path = track
    if t <= times[0]:
        return values[0]
    if t >= times[-1]:
        return values[-1]
    i = int(np.searchsorted(times, t, side="right")) - 1
    if interp == "STEP":
        return values[i]
    u = (t - times[i]) / (times[i + 1] - times[i])
    if path == "rotation":
        return slerp(values[i], values[i + 1], u)
    return values[i] * (1 - u) + values[i + 1] * u


def tracks(g, anim):
    out = {}
    names = [n.get("name") for n in g.doc["nodes"]]
    for ch in anim["channels"]:
        s = anim["samplers"][ch["sampler"]]
        interp = s.get("interpolation", "LINEAR")
        if interp not in ("STEP", "LINEAR"):
            raise ValueError(f"unsupported interpolation {interp}")
        path = ch["target"]["path"]
        out[(names[ch["target"]["node"]], path)] = (arr(g, s["input"])[:, 0], arr(g, s["output"]), interp, path)
    return out


def rest_trs(node):
    return {p: np.array(node.get(p, TRS_DEFAULT[p]), dtype=np.float64) for p in TRS_DEFAULT}


def pose_world(g, trk, t):
    """World matrix per node index for clip tracks `trk` at time t (missing tracks hold rest)."""
    nodes = g.doc["nodes"]
    par = g.parents()
    local = []
    for n in nodes:
        trs = rest_trs(n)
        for p in trs:
            key = (n.get("name"), p)
            if key in trk:
                trs[p] = np.asarray(sample(trk[key], t), dtype=np.float64)
        local.append(m4(G.trs_matrix(trs["translation"], trs["rotation"], trs["scale"])) if "matrix" not in n
                     else m4(n["matrix"]))
    world = [None] * len(nodes)

    def w(i):
        if world[i] is None:
            world[i] = local[i] if i not in par else w(par[i]) @ local[i]
        return world[i]
    return [w(i) for i in range(len(nodes))]


def quat_angle_deg(a, b):
    d = min(1.0, abs(float(np.dot(a / np.linalg.norm(a), b / np.linalg.norm(b)))))
    return math.degrees(2 * math.acos(d))


# --- comparison -----------------------------------------------------------------

def compare(kind, raw_path, ship_path):
    C = Checks()
    r, s = G.Glb(raw_path), G.Glb(ship_path)
    rd, sd = r.doc, s.doc
    m = {"maxPositionErrorM": 0.0, "maxNormalErrorDeg": 0.0}
    rnames = [n.get("name") for n in rd["nodes"]]
    snames = [n.get("name") for n in sd["nodes"]]
    C("node names identical", sorted(rnames, key=str) == sorted(snames, key=str), {"raw": len(rnames), "shipped": len(snames)})
    rby, sby = r.nodes_by_name(), s.nodes_by_name()
    rpar, spar = r.parents(), s.parents()

    def parent_name(names, par, i):
        return names[par[i]] if i in par else None
    C("node parents identical", {rnames[i]: parent_name(rnames, rpar, i) for i in range(len(rnames))}
      == {snames[i]: parent_name(snames, spar, i) for i in range(len(snames))})
    C("node extras identical", all(rby[n].get("extras") == sby.get(n, {}).get("extras") for n in rby),
      [n for n in rby if rby[n].get("extras") != sby.get(n, {}).get("extras")])
    # glTF-Transform omits a TRS component within 1e-5 of its default when writing (Blender
    # leaves float noise such as scale 0.9999957 on some bones), so equality is to 1e-5;
    # the largest deviation is reported and the posed-skinning check covers its effect.
    trs_dev, trs_diff = 0.0, []
    for n, v in rby.items():
        if "mesh" in v:
            continue
        for k in ("translation", "rotation", "scale"):
            a = v.get(k, TRS_DEFAULT[k])
            b = sby.get(n, {}).get(k, TRS_DEFAULT[k])
            d = max(abs(x - y) for x, y in zip(a, b))
            trs_dev = max(trs_dev, d)
            if d > 1e-5:
                trs_diff.append(f"{n}.{k}")
    m["maxRestTrsDeviation"] = trs_dev
    C("non-mesh node TRS identical within 1e-5", not trs_diff, trs_diff)
    C("scene extras identical", rd["scenes"][0].get("extras") == sd["scenes"][0].get("extras"))
    # materials, samplers, images
    rm, sm = rd.get("materials", []), sd.get("materials", [])
    C("material names identical (same order)", [x.get("name") for x in rm] == [x.get("name") for x in sm],
      [x.get("name") for x in sm])
    keys = ("pbrMetallicRoughness", "extras", "extensions", "doubleSided", "alphaMode", "alphaCutoff", "emissiveFactor")
    mat_diff = [a.get("name") for a, b in zip(rm, sm)
                if not close({k: a.get(k) for k in keys if k != "pbrMetallicRoughness"},
                             {k: b.get(k) for k in keys if k != "pbrMetallicRoughness"})
                or not close({k: v for k, v in a.get("pbrMetallicRoughness", {}).items() if k != "baseColorTexture"},
                             {k: v for k, v in b.get("pbrMetallicRoughness", {}).items() if k != "baseColorTexture"})]
    C("material factors, extras and extensions identical", not mat_diff, mat_diff)
    C("texture samplers identical", rd.get("samplers") == sd.get("samplers"), sd.get("samplers"))
    C("embedded images byte-identical", [r.image_bytes(i) for i in range(len(rd.get("images", [])))]
      == [s.image_bytes(i) for i in range(len(sd.get("images", [])))])
    # skins
    if rd.get("skins"):
        C("one skin, same joint names in order", len(sd.get("skins", [])) == len(rd["skins"]) == 1
          and [rnames[j] for j in rd["skins"][0]["joints"]] == [snames[j] for j in sd["skins"][0]["joints"]],
          len(sd.get("skins", [])))
    atlas = (rd["scenes"][0].get("extras") or {}).get("kantor_atlas")
    uv_cells_bad, uv_err, morph_err, weight_err, morph_new = 0, 0.0, 0.0, 0.0, 0
    morph_moved = {}
    for name, rn in rby.items():
        if "mesh" not in rn:
            continue
        sn = sby.get(name)
        if not C(f"{name}: mesh node present", sn is not None and "mesh" in sn):
            continue
        rmesh, smesh = rd["meshes"][rn["mesh"]], sd["meshes"][sn["mesh"]]
        C(f"{name}: mesh name and extras identical", rmesh.get("name") == smesh.get("name")
          and rmesh.get("extras") == smesh.get("extras"))
        if not C(f"{name}: primitive count identical", len(rmesh["primitives"]) == len(smesh["primitives"])):
            continue
        mr, ms = m4(r.mesh_matrix(name)), m4(s.mesh_matrix(name))
        lin_r, lin_s = mr[:3, :3], ms[:3, :3]
        for k, (rp, sp) in enumerate(zip(rmesh["primitives"], smesh["primitives"])):
            tag = f"{name}[{k}]"
            ok = C(f"{tag}: material, mode, attribute set, morph count identical",
                   r.material_name(rp) == s.material_name(sp) and rp.get("mode", 4) == sp.get("mode", 4)
                   and set(rp["attributes"]) == set(sp["attributes"])
                   and len(rp.get("targets", [])) == len(sp.get("targets", [])))
            C(f"{tag}: index list identical", r.accessor(rp["indices"]) == s.accessor(sp["indices"]))
            if not ok:
                continue
            pr = apply(mr, arr(r, rp["attributes"]["POSITION"]))
            ps = apply(ms, arr(s, sp["attributes"]["POSITION"]))
            if not C(f"{tag}: vertex count identical", pr.shape == ps.shape, [pr.shape[0], ps.shape[0]]):
                continue
            m["maxPositionErrorM"] = max(m["maxPositionErrorM"], float(np.abs(pr - ps).max(initial=0)))
            if "NORMAL" in rp["attributes"]:
                nr, ns = arr(r, rp["attributes"]["NORMAL"]), arr(s, sp["attributes"]["NORMAL"])
                nr /= np.linalg.norm(nr, axis=1, keepdims=True)
                ns /= np.linalg.norm(ns, axis=1, keepdims=True)
                dots = np.clip(np.sum(nr * ns, axis=1), -1, 1)
                m["maxNormalErrorDeg"] = max(m["maxNormalErrorDeg"], float(np.degrees(np.arccos(dots)).max(initial=0)))
            if "TEXCOORD_0" in rp["attributes"]:
                ur, us = arr(r, rp["attributes"]["TEXCOORD_0"]), arr(s, sp["attributes"]["TEXCOORD_0"])
                uv_err = max(uv_err, float(np.abs(ur - us).max(initial=0)))
                if atlas:
                    k8 = atlas["size"] / atlas["cell"]
                    uv_cells_bad += int(np.any(np.floor(ur * k8) != np.floor(us * k8), axis=1).sum())
            if "WEIGHTS_0" in rp["attributes"]:
                nj = len(rd["skins"][0]["joints"])
                dense = []
                for g, p in ((r, rp), (s, sp)):
                    jw = np.zeros((pr.shape[0], nj))
                    j = arr(g, p["attributes"]["JOINTS_0"]).astype(int)
                    w = arr(g, p["attributes"]["WEIGHTS_0"])
                    for c in range(4):
                        np.add.at(jw, (np.arange(len(j)), j[:, c]), w[:, c])
                    dense.append(jw)
                weight_err = max(weight_err, float(np.abs(dense[0] - dense[1]).max(initial=0)))
                C(f"{tag}: shipped weights sum to 1", float(np.abs(dense[1].sum(axis=1) - 1).max(initial=0)) <= 1e-6)
            for ti, (rt, st) in enumerate(zip(rp.get("targets", []), sp.get("targets", []))):
                dr = arr(r, rt["POSITION"]) @ lin_r.T
                ds = arr(s, st["POSITION"]) @ lin_s.T
                morph_err = max(morph_err, float(np.abs(dr - ds).max(initial=0)))
                moved_r = set(np.nonzero(np.abs(dr).max(axis=1) > 0)[0].tolist())
                moved_s = set(np.nonzero(np.abs(ds).max(axis=1) > 0)[0].tolist())
                morph_new += len(moved_s - moved_r)
                tname = ((rmesh.get("extras") or {}).get("targetNames") or [str(ti)])[ti]
                morph_moved[f"{name}:{tname}"] = [len(moved_r), len(moved_s)]
                C(f"{tag}: morph {tname} stays sparse", "sparse" in sd["accessors"][st["POSITION"]])
    if any(p.get("targets") for x in rd["meshes"] for p in x["primitives"]):
        m["maxMorphErrorM"] = morph_err
        m["morphNewlyMovedVertices"] = morph_new
        m["morphMovedVerticesRawShipped"] = morph_moved
        C("morph deltas within limit and no new moving vertices", morph_err <= LIMITS["morphM"] and morph_new == 0,
          {"maxMorphErrorM": morph_err, "newlyMoved": morph_new})
    if atlas:
        m["uvCellMismatches"] = uv_cells_bad
        m["maxUvError"] = uv_err
        m["maxUvErrorTexels"] = uv_err * atlas["size"]
        C("every vertex keeps its atlas cell", uv_cells_bad == 0, uv_cells_bad)
    if rd.get("skins"):
        m["maxWeightError"] = weight_err
    C(f"rest positions within {LIMITS['positionM'] * 1000:.0f} mm", m["maxPositionErrorM"] <= LIMITS["positionM"],
      m["maxPositionErrorM"])
    if rd.get("animations"):
        compare_animations(C, r, s, m)
    return C, m


def compare_animations(C, r, s, m):
    rd, sd = r.doc, s.doc
    ra = {a["name"]: a for a in rd["animations"]}
    sa = {a["name"]: a for a in sd.get("animations", [])}
    C("clip names identical", sorted(ra) == sorted(sa), sorted(sa))
    rot, tr, sc, posed = 0.0, 0.0, 0.0, 0.0
    m["channelsRaw"] = sum(len(a["channels"]) for a in rd["animations"])
    m["channelsShipped"] = sum(len(a["channels"]) for a in sd.get("animations", []))
    rnodes, snodes = r.nodes_by_name(), s.nodes_by_name()
    skin_r, skin_s = rd["skins"][0], sd["skins"][0]
    ibm_r = [m4(x) for x in r.accessor(skin_r["inverseBindMatrices"])]
    ibm_s = [m4(x) for x in s.accessor(skin_s["inverseBindMatrices"])]
    meshes = []
    for name, rn in rnodes.items():
        if "mesh" not in rn:
            continue
        sn = snodes[name]
        rp, sp = rd["meshes"][rn["mesh"]]["primitives"][0], sd["meshes"][sn["mesh"]]["primitives"][0]
        meshes.append(tuple(
            (arr(g, p["attributes"]["POSITION"]), arr(g, p["attributes"]["JOINTS_0"]).astype(int),
             arr(g, p["attributes"]["WEIGHTS_0"])) for g, p in ((r, rp), (s, sp))))
    for name in sorted(set(ra) & set(sa)):
        tr_r, tr_s = tracks(r, ra[name]), tracks(s, sa[name])
        end_r = max(t[0][-1] for t in tr_r.values())
        end_s = max(t[0][-1] for t in tr_s.values())
        C(f"clip {name}: duration identical", abs(end_r - end_s) <= 1e-6, [float(end_r), float(end_s)])
        C(f"clip {name}: no channel added", set(tr_s) <= set(tr_r), sorted(map(str, set(tr_s) - set(tr_r))))
        times = sorted({float(t) for trk in tr_r.values() for t in trk[0]})
        mids = [(a + b) / 2 for a, b in zip(times, times[1:])]
        for (node, path), trk in tr_r.items():
            rest = rest_trs(snodes[node])[path]
            for t in times + mids:
                a = np.asarray(sample(trk, t))
                b = np.asarray(sample(tr_s[(node, path)], t)) if (node, path) in tr_s else rest
                if path == "rotation":
                    rot = max(rot, quat_angle_deg(a, b))
                elif path == "translation":
                    tr = max(tr, float(np.abs(a - b).max()))
                else:
                    sc = max(sc, float(np.abs(a - b).max()))
        # end-to-end: skin every mesh in every key pose of the clip with each file's own data
        for t in times:
            wr, ws = pose_world(r, tr_r, t), pose_world(s, tr_s, t)
            jr = np.stack([wr[j] @ ib for j, ib in zip(skin_r["joints"], ibm_r)])
            js = np.stack([ws[j] @ ib for j, ib in zip(skin_s["joints"], ibm_s)])
            for (pr, jir, wtr), (ps, jis, wts) in meshes:
                vr = skin(pr, jir, wtr, jr)
                vs = skin(ps, jis, wts, js)
                posed = max(posed, float(np.abs(vr - vs).max(initial=0)))
    m.update({"maxRotationErrorDeg": rot, "maxTranslationErrorM": tr, "maxScaleError": sc, "maxPosedErrorM": posed})
    C(f"joint rotations within {LIMITS['rotationDeg']} degree", rot <= LIMITS["rotationDeg"], rot)
    C(f"joint translations within {LIMITS['translationM'] * 1000:.0f} mm", tr <= LIMITS["translationM"], tr)
    C(f"joint scales within {LIMITS['scale']}", sc <= LIMITS["scale"], sc)
    C(f"skinned vertices in every key pose within {LIMITS['posedM'] * 1000:.0f} mm", posed <= LIMITS["posedM"], posed)


def skin(pos, joints, weights, mats):
    h = np.concatenate([pos, np.ones((len(pos), 1))], axis=1)
    out = np.zeros((len(pos), 3))
    for c in range(4):
        mm = mats[joints[:, c]]
        out += weights[:, c:c + 1] * np.einsum("nij,nj->ni", mm, h)[:, :3]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "docs" / "evidence" / "current" / "glb-compare.json"))
    ap.add_argument("--raw", default=str(RAW), help="Blender exports (default blender/out/raw-glb)")
    ap.add_argument("--shipped", default=str(SHIP), help="optimised files (default app/public/assets)")
    args = ap.parse_args()
    raw_dir, ship_dir = Path(args.raw).resolve(), Path(args.shipped).resolve()
    files, lines, totals = [], [], {}
    for kind in KINDS:
        raws = sorted((raw_dir / kind).glob("*.glb"))
        ships = sorted((ship_dir / kind).glob("*.glb"))
        totals[kind] = {"files": len(ships), "rawBytes": sum(p.stat().st_size for p in raws),
                        "shippedBytes": sum(p.stat().st_size for p in ships)}
        names = sorted({p.name for p in raws} | {p.name for p in ships})
        for n in names:
            rp, sp = raw_dir / kind / n, ship_dir / kind / n
            if not (rp.exists() and sp.exists()):
                files.append({"kind": kind, "raw": rel(rp), "shipped": rel(sp), "ok": False, "measured": {},
                              "checks": [{"check": "raw and shipped both exist", "ok": False,
                                          "detail": {"raw": rp.exists(), "shipped": sp.exists()}}]})
                lines.append(f"FAIL {kind}/{n}: raw={rp.exists()} shipped={sp.exists()}")
                continue
            try:
                C, m = compare(kind, rp, sp)
            except Exception as exc:  # report and keep going; the run still fails
                C, m = Checks(), {}
                C("comparison ran", False, repr(exc))
            files.append({"kind": kind, "raw": rel(rp), "shipped": rel(sp), "rawBytes": rp.stat().st_size,
                          "shippedBytes": sp.stat().st_size, "rawSha256": sha256(rp), "shippedSha256": sha256(sp),
                          "ok": C.ok, "measured": m, "checks": C.items})
            short = " ".join(f"{k}={v:.3g}" if isinstance(v, float) else f"{k}={v}"
                             for k, v in m.items() if not isinstance(v, dict))
            lines.append(f"{'PASS' if C.ok else 'FAIL'} {kind}/{n}: {rp.stat().st_size} -> {sp.stat().st_size} bytes {short}")
            for c in C.items:
                if not c["ok"]:
                    lines.append(f"  FAIL {c['check']}: {c['detail']}")
    ok = all(f["ok"] for f in files) and bool(files)
    worst = {}
    for f in files:
        for k, v in f["measured"].items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                worst[k] = max(worst.get(k, v), v)
    report = {"tool": "tools/glb_compare.py", "passed": ok, "limits": LIMITS, "totals": totals, "worst": worst,
              "files": files}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    print("\n".join(lines))
    for kind, t in totals.items():
        print(f"COMPARE_TOTAL {kind}: files={t['files']} raw={t['rawBytes']} shipped={t['shippedBytes']}")
    print("COMPARE_WORST " + " ".join(f"{k}={v:.4g}" for k, v in sorted(worst.items())))
    print(f"COMPARE_DONE passed={ok} files={len(files)} failed={sum(1 for f in files if not f['ok'])} out={rel(out)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
