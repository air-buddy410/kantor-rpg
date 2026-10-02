"""Stdlib-only GLB reader (no bpy, no numpy) shared by validators and pytest.

Supports what the kantor-rpg exporters and tools/glb_optimize.mjs write: one
JSON chunk, one BIN chunk, float32 and (un)signed byte/short/int accessors
(VEC2..4, MAT4, SCALAR), normalized integers (KHR_mesh_quantization; accessor()
returns dequantized floats), sparse accessors with or without a base bufferView
(morph targets), and the embedded 8-bit PNG palette atlas of the character GLBs
(decode_png).

Quantized POSITION data is only meaningful together with the transform that
undoes the quantization: the node world matrix for plain meshes, the joint
world matrix times the inverse bind matrix for skinned meshes. node_positions()
and node_world_bounds() apply it, so they return metres in the glTF scene frame
for both the Blender export and the optimised file.
"""
from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path

COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
# glTF 2.0 section 3.11: normalized integer -> float (signed types clamp at -1)
NORM = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}


class Glb:
    def __init__(self, path):
        b = Path(path).read_bytes()
        magic, version, length = struct.unpack("<4sII", b[:12])
        if magic != b"glTF" or version != 2:
            raise ValueError(f"{path}: not a glTF 2 binary")
        if length != len(b):
            raise ValueError(f"{path}: header length {length} != file size {len(b)}")
        clen, ctype = struct.unpack("<I4s", b[12:20])
        if ctype != b"JSON":
            raise ValueError(f"{path}: first chunk is not JSON")
        self.doc = json.loads(b[20:20 + clen])
        rest = b[20 + clen:]
        blen, btype = struct.unpack("<I4s", rest[:8])
        if btype != b"BIN\x00":
            raise ValueError(f"{path}: second chunk is not BIN")
        self.bin = rest[8:8 + blen]
        self.size = len(b)

    def accessor(self, idx, raw=False):
        """Accessor elements as tuples (scalars as numbers); normalized integers are
        dequantized to floats unless raw=True."""
        out = self._accessor_raw(idx)
        a = self.doc["accessors"][idx]
        if raw or not a.get("normalized"):
            return out
        den = NORM[a["componentType"]]
        if NCOMP[a["type"]] == 1:
            return [max(v / den, -1.0) for v in out]
        return [tuple(max(c / den, -1.0) for c in v) for v in out]

    def _accessor_raw(self, idx):
        a = self.doc["accessors"][idx]
        fmt, size = COMP[a["componentType"]]
        n = NCOMP[a["type"]]
        if "bufferView" in a:
            bv = self.doc["bufferViews"][a["bufferView"]]
            stride = bv.get("byteStride", size * n)
            base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
            out = []
            for i in range(a["count"]):
                vals = struct.unpack_from("<" + fmt * n, self.bin, base + i * stride)
                out.append(vals if n > 1 else vals[0])
        else:
            # glTF: an accessor without bufferView is all zeros (sparse base)
            zero = tuple([0] * n) if n > 1 else 0
            out = [zero] * a["count"]
        sp = a.get("sparse")
        if sp:
            ifmt, isize = COMP[sp["indices"]["componentType"]]
            ibv = self.doc["bufferViews"][sp["indices"]["bufferView"]]
            ibase = ibv.get("byteOffset", 0) + sp["indices"].get("byteOffset", 0)
            vbv = self.doc["bufferViews"][sp["values"]["bufferView"]]
            vbase = vbv.get("byteOffset", 0) + sp["values"].get("byteOffset", 0)
            for k in range(sp["count"]):
                i = struct.unpack_from("<" + ifmt, self.bin, ibase + k * isize)[0]
                vals = struct.unpack_from("<" + fmt * n, self.bin, vbase + k * size * n)
                out[i] = vals if n > 1 else vals[0]
        return out

    def sparse_indices(self, idx):
        """Indices stored in a sparse accessor (the vertices a morph target moves)."""
        sp = self.doc["accessors"][idx].get("sparse")
        if not sp:
            return None
        ifmt, isize = COMP[sp["indices"]["componentType"]]
        ibv = self.doc["bufferViews"][sp["indices"]["bufferView"]]
        ibase = ibv.get("byteOffset", 0) + sp["indices"].get("byteOffset", 0)
        return [struct.unpack_from("<" + ifmt, self.bin, ibase + k * isize)[0] for k in range(sp["count"])]

    def image_bytes(self, idx):
        im = self.doc["images"][idx]
        bv = self.doc["bufferViews"][im["bufferView"]]
        off = bv.get("byteOffset", 0)
        return self.bin[off:off + bv["byteLength"]]

    def nodes_by_name(self):
        return {n.get("name"): n for n in self.doc["nodes"]}

    def mesh_primitives(self, node_name):
        node = self.nodes_by_name()[node_name]
        return self.doc["meshes"][node["mesh"]]["primitives"]

    def node_bounds(self, node_name):
        """(min, max) of POSITION over the node's primitives from accessor min/max, in the
        mesh's own (local) frame; normalized accessors are dequantized. For a quantized
        mesh this is not metres: use node_world_bounds()."""
        mn, mx = [1e9] * 3, [-1e9] * 3
        for p in self.mesh_primitives(node_name):
            a = self.doc["accessors"][p["attributes"]["POSITION"]]
            den = NORM.get(a["componentType"]) if a.get("normalized") else None
            amn = [max(v / den, -1.0) for v in a["min"]] if den else a["min"]
            amx = [max(v / den, -1.0) for v in a["max"]] if den else a["max"]
            mn = [min(u, v) for u, v in zip(mn, amn)]
            mx = [max(u, v) for u, v in zip(mx, amx)]
        return mn, mx

    # --- transforms (glTF matrices are column-major lists of 16) ---------------

    def parents(self):
        out = {}
        for i, n in enumerate(self.doc["nodes"]):
            for c in n.get("children", []):
                out[c] = i
        return out

    def node_index(self, node_name):
        return next(i for i, n in enumerate(self.doc["nodes"]) if n.get("name") == node_name)

    def world_matrix(self, idx):
        """Rest world matrix of node `idx` from the node TRS / matrix chain."""
        par = self.parents()
        m = node_local_matrix(self.doc["nodes"][idx])
        while idx in par:
            idx = par[idx]
            m = mat_mul(node_local_matrix(self.doc["nodes"][idx]), m)
        return m

    def bind_matrices(self, node_name):
        """Per joint: joint rest world matrix x inverse bind matrix (glTF skinning)."""
        node = self.nodes_by_name()[node_name]
        skin = self.doc["skins"][node["skin"]]
        ibms = self.accessor(skin["inverseBindMatrices"])
        return [mat_mul(self.world_matrix(j), list(ibm)) for j, ibm in zip(skin["joints"], ibms)]

    def mesh_matrix(self, node_name, tol=1e-5):
        """The matrix that maps the node's POSITION data to the rest pose in the scene frame.

        Skinned meshes: every joint's world x inverse bind matrix must agree (rest pose =
        bind pose, as the Blender exporter writes and the optimiser keeps); raises otherwise.
        """
        node = self.nodes_by_name()[node_name]
        if "skin" not in node:
            return self.world_matrix(self.node_index(node_name))
        mats = self.bind_matrices(node_name)
        ref = mats[0]
        scale = max(abs(v) for v in ref[:12]) or 1.0
        for m in mats[1:]:
            if max(abs(a - b) for a, b in zip(m, ref)) > tol * max(1.0, scale):
                raise ValueError(f"{node_name}: joints disagree on the bind pose; rest != bind")
        return ref

    def node_positions(self, node_name, prim=None):
        """Rest-pose POSITION of the node's primitive(s) in metres, glTF scene frame."""
        m = self.mesh_matrix(node_name)
        prims = [prim] if prim is not None else self.mesh_primitives(node_name)
        out = []
        for p in prims:
            out += [mat_apply(m, v) for v in self.accessor(p["attributes"]["POSITION"])]
        return out

    def morph_deltas(self, node_name, target_index, prim_index=0):
        """Morph target POSITION deltas in metres: deltas are relative, so only the linear
        part of mesh_matrix() applies (integer deltas of the optimised characters share
        the POSITION grid)."""
        m = self.mesh_matrix(node_name)
        prim = self.mesh_primitives(node_name)[prim_index]
        out = []
        for x, y, z in self.accessor(prim["targets"][target_index]["POSITION"]):
            out.append((m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z,
                        m[2] * x + m[6] * y + m[10] * z))
        return out

    def node_world_bounds(self, node_name):
        """(min, max) of the node's rest-pose geometry in metres, glTF scene frame."""
        m = self.mesh_matrix(node_name)
        lo, hi = self.node_bounds(node_name)
        corners = [mat_apply(m, (x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        return [min(c[i] for c in corners) for i in range(3)], [max(c[i] for c in corners) for i in range(3)]

    def node_triangles(self, node_name):
        return sum(self.doc["accessors"][p["indices"]]["count"] // 3 for p in self.mesh_primitives(node_name))

    def material_name(self, prim):
        m = prim.get("material")
        return self.doc["materials"][m]["name"] if m is not None else None


IDENTITY = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]


def mat_mul(a, b):
    """Column-major 4x4 product a @ b."""
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def mat_apply(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


def trs_matrix(t=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0, 1.0), s=(1.0, 1.0, 1.0)):
    x, y, z, w = r
    rot = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
           2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
           2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]
    return [rot[0] * s[0], rot[1] * s[0], rot[2] * s[0], 0.0,
            rot[3] * s[1], rot[4] * s[1], rot[5] * s[1], 0.0,
            rot[6] * s[2], rot[7] * s[2], rot[8] * s[2], 0.0,
            t[0], t[1], t[2], 1.0]


def node_local_matrix(n):
    if "matrix" in n:
        return list(n["matrix"])
    return trs_matrix(n.get("translation", (0.0, 0.0, 0.0)), n.get("rotation", (0.0, 0.0, 0.0, 1.0)),
                      n.get("scale", (1.0, 1.0, 1.0)))


def gltf_to_world(p):
    """glTF Y-up (x, y, z) -> kantor world / Blender Z-up (x, -z, y)."""
    return (p[0], -p[2], p[1])


def world_to_gltf(p):
    return (p[0], p[2], -p[1])


def world_bounds(glb_min, glb_max):
    """Axis-aligned world bounds from glTF min/max (the axis swap flips y)."""
    a, b = gltf_to_world(glb_min), gltf_to_world(glb_max)
    return tuple(min(u, v) for u, v in zip(a, b)), tuple(max(u, v) for u, v in zip(a, b))


def decode_png(data):
    """8-bit greyscale/RGB/RGBA, non-interlaced PNG -> (width, height, rows of (r, g, b, a) tuples).

    Row 0 is the top row as stored, the same convention as the atlas extras.
    """
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, w = 8, b"", None
    while pos < len(data):
        ln, tag = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + ln]
        if tag == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8 or interlace or ctype not in (0, 2, 6):
                raise ValueError(f"unsupported PNG depth={depth} type={ctype} interlace={interlace}")
            bpp = {0: 1, 2: 3, 6: 4}[ctype]
        elif tag == b"IDAT":
            idat += body
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        ft, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if ft == 1:
                line[x] = (line[x] + a) & 255
            elif ft == 2:
                line[x] = (line[x] + b) & 255
            elif ft == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif ft == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = line
        px = []
        for x in range(w):
            v = line[x * bpp:(x + 1) * bpp]
            px.append((v[0], v[0], v[0], 255) if bpp == 1 else (v[0], v[1], v[2], v[3] if bpp == 4 else 255))
        rows.append(px)
    return w, h, rows


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def atlas_zone_of_uv(u, v, size, cell, zone_at):
    """glTF UV (v down from the top) -> zone name via {(col, row): zone}."""
    return zone_at.get((int(u * size // cell), int(v * size // cell)))
