"""Pure-Python furniture contract shared by the builder, validator and pytest.

Frame: origin at the footprint centre on the floor, Blender Z up, front = local
-Y (glTF +Z), matching world.json `fixtureFront` and app/src/world/furniture.ts.
Every GLB bounding box equals its catalog size [w, d, h] within TOL_M.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORLD = ROOT / "design" / "world.json"
GLB_DIR = ROOT / "app" / "public" / "assets" / "furniture"  # shipped (tools/glb_optimize.mjs output)
# Blender exports land here; tools/glb_optimize.mjs turns them into GLB_DIR files.
RAW_GLB_DIR = ROOT / "blender" / "out" / "raw-glb" / "furniture"
TOL_M = 0.02
SMALL_TRIS = 2000
LARGE_TRIS = 5000

# Wall-mounted items keep the catalog bbox from z = 0; runtime lifts them by
# this much (same values as app/src/world/furniture.ts panel() calls).
MOUNT_HEIGHT_M = {"whiteboard": 0.9, "wall_display": 1.1, "poster": 1.2, "directory_sign": 1.0}

# Orientation probes: centroid of faces using `material` (optionally only above
# zmin metres) must lie on the given side of the local Y axis. "-" = front (-Y).
FRONT_RULES = {
    "desk": ("woodLight", "-", 0.0), "desk_exec": ("woodLight", "-", 0.0),
    "chair": ("fabricGreen", "+", 0.55), "chair_guest": ("wood", "+", 0.50),
    "reception_desk": ("accent", "-", 0.0), "sofa": ("fabricGreen", "+", 0.60),
    "armchair": ("fabricSage", "+", 0.60), "beanbag": ("fabricMustard", "+", 0.40),
    "bookshelf": ("woodDark", "+", 0.0), "model_shelf": ("woodDark", "+", 0.0),
    "tool_cabinet": ("metalLight", "-", 0.0), "storage_shelf": ("paper", "-", 0.0),
    "locker": ("paper", "-", 0.0), "whiteboard": ("metal", "-", 0.0), "wall_display": ("screenGlow", "-", 0.0),
    "gallery_panel": ("art_a", "-", 0.0), "poster": ("art_a", "-", 0.0), "directory_sign": ("fabricCream", "-", 0.0),
    "easel": ("art_a", "-", 0.0), "pantry_counter": ("metalLight", "-", 0.0), "coffee_bar": ("accent", "-", 0.0),
    "fridge": ("metal", "-", 0.0), "sink": ("metalLight", "-", 0.0), "wc": ("white", "+", 0.55),
    "shower_stall": ("glass", "-", 0.0), "rack_42u": ("screenGlow", "-", 0.0), "lab_bench": ("metalLight", "-", 0.0),
    "lab_rack_open": ("screenGlow", "-", 0.0), "cue_rack": ("white", "-", 0.0),
    "media_console": ("woodLight", "-", 0.0), "arcade_cabinet": ("screenGlow", "-", 0.0),
    "treadmill": ("screenGlow", "+", 0.0), "exercise_bike": ("screenGlow", "+", 0.0),
    "plan_table": ("woodLight", "-", 0.0), "drafting_table": ("metal", "-", 0.0),
    "stair_u": ("woodDark", "-", 3.9), "lift": ("accent", "-", 0.0),
}
# Rotationally symmetric or orientation-free items: no probe.
SYMMETRIC = {"stool", "meeting_table", "round_table", "high_table", "dining_table", "coffee_table", "work_table",
             "bench", "plant_large", "plant_small", "planter_box", "tree_planter", "partition", "billiard_table",
             "board_table", "exercise_mat", "dumbbell_rack"}


def load_catalog(path=WORLD):
    w = json.loads(Path(path).read_text(encoding="utf-8"))
    assets = {}
    for f in w["fixtures"]:
        assets.setdefault(f["type"], f["asset"])
    return w["catalog"], assets


def size_class(size):
    """'small' props get the 2k budget; everything else 5k (PRD section 6)."""
    return "small" if max(size) <= 1.0 else "large"


def tri_budget(size):
    return SMALL_TRIS if size_class(size) == "small" else LARGE_TRIS


def glb_path(t):
    """The shipped (optimised) GLB the runtime loads and the validators check."""
    return GLB_DIR / f"{t}.glb"


def raw_glb_path(t):
    """The Blender export, input of tools/glb_optimize.mjs."""
    return RAW_GLB_DIR / f"{t}.glb"
