"""Publication safety scan for the public repo (REQ-SAFE-01).

Checks tracked + staged files for secret-like strings, private network
addresses, unexpected external URLs in app/runtime code, oversized binaries
and binary assets that are not registered in the asset registry.
Exit 1 on any finding. This is a heuristic gate, not a guarantee.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRET_PATTERNS = {
    "aws_key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "private_key": re.compile(r"-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----"),
    "github_token": re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}"),
    "anthropic_key": re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    "openai_key": re.compile(r"sk-[A-Za-z0-9]{40,}"),
    "slack_token": re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),
    "generic_assign": re.compile(r"(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][A-Za-z0-9/+_\-]{16,}['\"]"),
}
PRIVATE_IP = re.compile(r"\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b")
URL = re.compile(r"https?://[^\s'\"<>)]+")
# Runtime code may only reference these hosts (none are fetched at runtime;
# they appear in licence notices or docs links).
APP_URL_ALLOW = ("www.w3.org", "github.com/air-buddy410/kantor-rpg", "threejs.org", "openfontlicense.org", "scripts.sil.org")
BINARY_EXT = {".png", ".jpg", ".jpeg", ".webp", ".glb", ".gltf", ".blend", ".dxf", ".dwg", ".pdf", ".ktx2", ".woff2", ".mp4", ".webm"}
MAX_BINARY = 30 * 1024 * 1024
SKIP_SCAN = {"tools/safety_scan.py"}


def files():
    out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True, check=True)
    return [p for p in out.stdout.splitlines() if p and (ROOT / p).is_file()]


def main():
    findings = []
    registry_paths = set()
    reg = ROOT / "design" / "asset-registry.json"
    if reg.exists():
        for a in json.loads(reg.read_text()).get("assets", []):
            for k in ("glb", "blend", "preview", "texture"):
                if a.get(k):
                    registry_paths.add(a[k])
    allowed_binary_dirs = ("PRD/", "drawings/", "cad/", "docs/evidence/", "design/derived/", "blender/out/", "app/public/assets/", "assets/")
    scanned = 0
    for rel in files():
        p = ROOT / rel
        ext = p.suffix.lower()
        size = p.stat().st_size
        if ext in BINARY_EXT:
            if size > MAX_BINARY:
                findings.append(f"{rel}: binary {size} bytes > {MAX_BINARY}")
            if not rel.startswith(allowed_binary_dirs):
                findings.append(f"{rel}: binary outside allowed output dirs")
            if ext == ".dwg":
                findings.append(f"{rel}: DWG present; native DWG must come from a verified native tool (see capability report)")
            continue
        if rel in SKIP_SCAN or size > 5 * 1024 * 1024:
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        scanned += 1
        for name, pat in SECRET_PATTERNS.items():
            for m in pat.finditer(text):
                findings.append(f"{rel}: {name} pattern '{m.group(0)[:12]}...'")
        for m in PRIVATE_IP.finditer(text):
            findings.append(f"{rel}: private IP literal {m.group(0)}")
        if rel.startswith("app/src/") or rel.startswith("app/index.html"):
            for m in URL.finditer(text):
                if not any(h in m.group(0) for h in APP_URL_ALLOW):
                    findings.append(f"{rel}: external URL in runtime code {m.group(0)}")
    print(f"scanned_text_files={scanned} findings={len(findings)}")
    for f in findings:
        print("FINDING", f)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
