"""The committed drawing set must come from the committed world.json (ADR-015).

Every DXF stamps the sha256 of the dataset it was drawn from (KR_WORLD_SHA256).
World edits in e44495a, f324078 and 76d5867 left cad/out drawn from an older
dataset while every other check stayed green; this is the guard for that.
"""
import hashlib
import json
from pathlib import Path

import ezdxf

ROOT = Path(__file__).resolve().parents[2]


def _world_sha():
    return hashlib.sha256((ROOT / "design" / "world.json").read_bytes()).hexdigest()


def test_every_committed_dxf_was_drawn_from_the_committed_world():
    want = _world_sha()
    stale = []
    for dxf in sorted((ROOT / "cad" / "out").glob("*.dxf")):
        got = ezdxf.readfile(dxf).header.custom_vars.get("KR_WORLD_SHA256")
        if got != want:
            stale.append(f"{dxf.name}: {got}")
    assert not stale, f"world.json is {want}; regenerate with python3 cad/generate.py --all-available:\n" + "\n".join(stale)


def test_register_hashes_match_the_committed_drawing_files():
    reg = json.loads((ROOT / "drawings" / "register.json").read_text(encoding="utf-8"))
    for sheet in reg["sheets"]:
        for f in sheet["files"].values():
            assert hashlib.sha256((ROOT / f["path"]).read_bytes()).hexdigest() == f["sha256"], f["path"]
