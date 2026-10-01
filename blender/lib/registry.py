"""Merge validator-measured entries into design/asset-registry.json (stdlib only).

Each validator owns its own ids; entries with other ids (characters, other
kinds) are kept untouched. Order: kind, then id, so diffs stay small.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "design" / "asset-registry.json"
KIND_ORDER = {"character": 0, "building": 1, "furniture": 2}


def merge(entries):
    reg = json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else {"schemaVersion": 1, "assets": []}
    ids = {e["id"] for e in entries}
    keep = [a for a in reg.get("assets", []) if a.get("id") not in ids]
    chars = [a for a in keep if a.get("kind") == "character"]
    rest = [a for a in keep if a.get("kind") != "character"] + list(entries)
    rest.sort(key=lambda a: (KIND_ORDER.get(a.get("kind"), 9), a.get("id", "")))
    reg["assets"] = chars + rest  # character order is owned by blender/validate_assets.py
    REGISTRY.write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return len(reg["assets"])
