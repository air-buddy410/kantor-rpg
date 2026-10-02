"""Must requirement audit (R2): every PRD v0.1 section 12 REQ, element by element.

design/must-audit.json lists, per REQ, the AC, each named test kind, the
failure path and the boundary with a status and references "path::substring".
The audit fails when a PRD REQ is missing, a status is outside the vocabulary,
or a reference file/substring does not exist (a stale claim). It renders
docs/MUST-AUDIT.md so gaps (belum diuji / blocked / asumsi / tidak didukung)
stay visible next to the verified rows.

Usage: python3 tools/must_audit.py [--write]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def audit():
    spec = json.loads((ROOT / "design" / "must-audit.json").read_text(encoding="utf-8"))
    prd = (ROOT / "PRD" / "PRD-v0.1.md").read_text(encoding="utf-8")
    sec = prd[prd.index("## 12."):prd.index("## 13.")]
    prd_reqs = sorted(set(re.findall(r"^(REQ-[A-Z]+-\d+)", sec, re.M)))
    problems = []
    for rid in prd_reqs:
        if rid not in spec["requirements"]:
            problems.append(f"{rid}: missing from audit")
    counts = {}
    for rid, elements in spec["requirements"].items():
        kinds = {e["kind"] for e in elements}
        for k in ("AC", "test", "failure", "boundary"):
            if k not in kinds:
                problems.append(f"{rid}: no {k} element")
        for e in elements:
            counts[e["status"]] = counts.get(e["status"], 0) + 1
            if e["status"] not in spec["statusVocabulary"]:
                problems.append(f"{rid}: bad status {e['status']}")
            if e["status"] != "terverifikasi" and not e.get("note"):
                problems.append(f"{rid}: '{e['text']}' is {e['status']} without a note")
            for ref in e["refs"]:
                path, _, needle = ref.partition("::")
                f = ROOT / path
                if not f.exists():
                    problems.append(f"{rid}: {path} does not exist")
                elif needle and f.suffix not in (".png", ".pdf") and needle not in f.read_text(encoding="utf-8", errors="replace"):
                    problems.append(f"{rid}: '{needle}' not found in {path}")
    return {"prdRequirements": prd_reqs, "counts": counts, "problems": problems, "spec": spec}


def render(rep) -> str:
    lines = ["# Must audit (PRD v0.1 bagian 12)", "",
             "Dibuat oleh `tools/must_audit.py` dari `design/must-audit.json`. Status per elemen AC, test, failure dan boundary; referensi diperiksa ada di repo. "
             "Elemen selain terverifikasi adalah gap yang terbuka, bukan selesai.", "",
             "Ringkasan: " + ", ".join(f"{k} {v}" for k, v in sorted(rep["counts"].items())), ""]
    for rid, elements in rep["spec"]["requirements"].items():
        lines += [f"## {rid}", "", "| Elemen | Isi | Status | Bukti | Catatan |", "|---|---|---|---|---|"]
        for e in elements:
            refs = "<br>".join(f"`{r.split('::')[0]}`" + (f" ({r.split('::', 1)[1]})" if "::" in r and r.split("::", 1)[1] else "") for r in e["refs"])
            lines.append(f"| {e['kind']} | {e['text']} | {e['status']} | {refs} | {e.get('note', '')} |")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    rep = audit()
    if args.write:
        (ROOT / "docs" / "MUST-AUDIT.md").write_text(render(rep), encoding="utf-8")
    print(f"requirements={len(rep['prdRequirements'])} counts={rep['counts']} problems={len(rep['problems'])}")
    for p in rep["problems"]:
        print("  FAIL", p)
    return 1 if rep["problems"] else 0


if __name__ == "__main__":
    sys.exit(main())
