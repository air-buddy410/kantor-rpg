import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQ = json.loads((ROOT / "design" / "requirements.json").read_text())


def test_status_vocabulary():
    vocab = set(REQ["statusVocabulary"])
    for r in REQ["requirements"]:
        for p in r["parts"]:
            assert p["status"] in vocab, (r["id"], p)


def test_verified_parts_have_existing_evidence():
    for r in REQ["requirements"]:
        for p in r["parts"]:
            if p["status"] == "terverifikasi":
                assert p["evidence"], (r["id"], p["scope"])
                for e in p["evidence"]:
                    assert (ROOT / e).exists(), (r["id"], e)


def test_prd_requirements_all_present():
    prd = (ROOT / "PRD" / "PRD-v0.2.md").read_text(encoding="utf-8")
    for r in REQ["requirements"]:
        assert r["id"] in prd, r["id"]
