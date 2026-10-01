"""Dependency licence audit (REQ-SAFE-01).

Reads licences from installed metadata (no network):
- npm: every package in app/package-lock.json, split runtime vs dev, licence
  from node_modules/<pkg>/package.json;
- Python: requirements-dev.txt packages via importlib.metadata;
- fonts and system tools used by generators (declared list, checked file).
Fails when a runtime (shipped) dependency has a licence outside the allow
list or no licence at all. Dev-only tools are reported, not shipped.

Usage: python3 tools/license_audit.py [--out docs/evidence/M3/license-audit.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ALLOW = {"MIT", "OFL-1.1", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD"}
DEV_ALLOW = RUNTIME_ALLOW | {"MPL-2.0", "BlueOak-1.0.0", "CC0-1.0", "Python-2.0", "CC-BY-4.0", "Unlicense", "PSF-2.0", "LGPL-3.0-or-later"}


def npm_packages():
    lock = json.loads((ROOT / "app" / "package-lock.json").read_text(encoding="utf-8"))
    out = []
    for path, meta in lock.get("packages", {}).items():
        if not path.startswith("node_modules/"):
            continue
        name = path.split("node_modules/")[-1]
        pj = ROOT / "app" / path / "package.json"
        lic = meta.get("license")
        if pj.exists():
            data = json.loads(pj.read_text(encoding="utf-8"))
            lic = data.get("license", lic)
            if isinstance(lic, dict):
                lic = lic.get("type")
        out.append({"name": name, "version": meta.get("version"), "license": lic or "UNKNOWN",
                    "scope": "dev" if meta.get("dev") else "runtime", "optional": bool(meta.get("optional"))})
    return out


def python_packages():
    names = [re.split(r"[=<>]", line)[0].strip() for line in (ROOT / "requirements-dev.txt").read_text().splitlines()
             if line.strip() and not line.startswith("#")]
    out = []
    for n in names:
        try:
            md = metadata.metadata(n)
            lic = md.get("License-Expression") or md.get("License") or ""
            classifiers = [c.split(" :: ")[-1] for c in md.get_all("Classifier") or [] if c.startswith("License ::")]
            out.append({"name": n, "version": metadata.version(n), "license": (lic.splitlines()[0][:60] if lic else ", ".join(classifiers)) or "UNKNOWN", "scope": "dev (generators/tests, not shipped)"})
        except metadata.PackageNotFoundError:
            out.append({"name": n, "version": None, "license": "NOT INSTALLED", "scope": "dev"})
    return out


def spdx_ok(lic: str, allow: set) -> bool:
    parts = re.split(r"\s+(?:OR|AND)\s+|[()]", lic or "")
    parts = [p for p in parts if p.strip()]
    return bool(parts) and all(p.strip() in allow for p in parts)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "docs" / "evidence" / "M3" / "license-audit.json"))
    args = ap.parse_args()
    npm = npm_packages()
    py = python_packages()
    other = [
        {"name": "Alegreya Sans (Debian fonts-alegreya-sans, converted as KantorRPG Sans for PDFs)", "license": "OFL-1.1", "scope": "embedded subsets in generated PDFs"},
        {"name": "@fontsource/alegreya-sans (web font files in the app build)", "license": "OFL-1.1", "scope": "runtime"},
        {"name": "Blender 4.0.2 (Ubuntu package)", "license": "GPL-2.0-or-later", "scope": "tool only; generated .blend/.glb are project output, not Blender code"},
        {"name": "Chromium (Playwright build)", "license": "BSD-3-Clause and others", "scope": "test tool only"},
    ]
    problems = []
    for p in npm:
        allow = RUNTIME_ALLOW if p["scope"] == "runtime" else DEV_ALLOW
        if not spdx_ok(p["license"], allow):
            (problems if p["scope"] == "runtime" else p.setdefault("notes", [])).append(f"{p['name']}@{p['version']}: {p['license']}")
    runtime = [p for p in npm if p["scope"] == "runtime"]
    report = {"runtimeAllow": sorted(RUNTIME_ALLOW), "npmRuntime": runtime, "npmDevCount": len(npm) - len(runtime),
              "npmDevLicenses": sorted({p["license"] for p in npm if p["scope"] == "dev"}),
              "npmDevNotAllowListed": [f"{p['name']}@{p['version']}: {p['license']}" for p in npm if p["scope"] == "dev" and not spdx_ok(p["license"], DEV_ALLOW)],
              "python": py, "other": other, "runtimeProblems": problems}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    print(f"npm runtime={len(runtime)} dev={report['npmDevCount']} python={len(py)} runtimeProblems={len(problems)} devNotAllowListed={len(report['npmDevNotAllowListed'])}")
    for p in runtime:
        print(f"  runtime {p['name']}@{p['version']} {p['license']}")
    for x in report["npmDevNotAllowListed"]:
        print(f"  dev-review {x}")
    for p in py:
        print(f"  python {p['name']}=={p['version']} {p['license']}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
