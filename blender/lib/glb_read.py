"""Stdlib-only GLB reader (no bpy, no numpy) shared by validators and pytest.

Supports what the kantor-rpg exporters write: one JSON chunk, one BIN chunk,
float32 / unsigned byte, short, int accessors (VEC2..4, SCALAR), sparse
accessors with or without a base bufferView (morph targets), and the embedded
8-bit PNG palette atlas of the character GLBs (decode_png).
"""
from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path

COMP = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


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

    def accessor(self, idx):
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
        """(min, max) of POSITION over the node's primitives from accessor min/max (glTF frame)."""
        mn, mx = [1e9] * 3, [-1e9] * 3
        for p in self.mesh_primitives(node_name):
            a = self.doc["accessors"][p["attributes"]["POSITION"]]
            mn = [min(u, v) for u, v in zip(mn, a["min"])]
            mx = [max(u, v) for u, v in zip(mx, a["max"])]
        return mn, mx

    def node_triangles(self, node_name):
        return sum(self.doc["accessors"][p["indices"]]["count"] // 3 for p in self.mesh_primitives(node_name))

    def material_name(self, prim):
        m = prim.get("material")
        return self.doc["materials"][m]["name"] if m is not None else None


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
