import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="session")
def world_master():
    return json.loads((ROOT / "design" / "world.json").read_text(encoding="utf-8"))


@pytest.fixture
def world(world_master):
    # Each test mutates its own copy so negative cases cannot leak.
    return copy.deepcopy(world_master)
