"""Render docs/requirements-matrix.md from design/requirements.json."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    req = json.loads((ROOT / "design" / "requirements.json").read_text(encoding="utf-8"))
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    out = ["# Matriks requirement", "",
           f"Dibuat dari `design/requirements.json` oleh `tools/req_matrix.py` (basis commit {sha}; evidence menunjuk file di repo).",
           req["note"], "", "| REQ | Milestone | Bagian | Test | Evidence | Status |", "|---|---|---|---|---|---|"]
    counts = {}
    for r in req["requirements"]:
        for p in r["parts"]:
            counts[p["status"]] = counts.get(p["status"], 0) + 1
            out.append(f"| {r['id']} | {r['milestone']} | {p['scope']} | {'<br>'.join(p['tests']) or '-'} | "
                       f"{'<br>'.join(p['evidence']) or '-'} | {p['status']} |")
    out += ["", "Ringkasan status bagian: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) + ".", "",
            "## Story, AC, failure dan boundary", ""]
    for r in req["requirements"]:
        out += [f"### {r['id']} ({r['milestone']})", "", r["story"], "", r["ac"], "",
                f"Failure: {r['failure']}. Boundary: {r['boundary']}.", ""]
    (ROOT / "docs" / "requirements-matrix.md").write_text("\n".join(out), encoding="utf-8")
    print(counts)


if __name__ == "__main__":
    main()
