"""Stdlib-only GLB reader (no bpy, no numpy) shared by validators and pytest.

Supports what the kantor-rpg exporters write: one JSON chunk, one BIN chunk,
float32 VEC3 POSITION accessors and unsigned byte/short/int index accessors.
"""
from __future__ import annotations

import json
import struct
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
        bv = self.doc["bufferViews"][a["bufferView"]]
        fmt, size = COMP[a["componentType"]]
        n = NCOMP[a["type"]]
        stride = bv.get("byteStride", size * n)
        base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        out = []
        for i in range(a["count"]):
            vals = struct.unpack_from("<" + fmt * n, self.bin, base + i * stride)
            out.append(vals if n > 1 else vals[0])
        return out

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
