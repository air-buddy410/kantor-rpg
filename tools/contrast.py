"""Compute WCAG 2.x contrast ratios for the UI theme tokens in app/src/styles.css.

Both themes are parsed (light :root block and [data-theme='dark'] block) and
every declared text/control pair must meet its threshold: normal text 4.5,
large/bold text 3.0, UI component boundaries 3.0. Exit 1 on any miss.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSS = ROOT / "app" / "src" / "styles.css"

# (foreground token, background token, threshold, what it is)
PAIRS = [
    ("ink", "bg", 4.5, "teks utama di latar"),
    ("ink", "surface", 4.5, "teks utama di panel"),
    ("ink", "surface-2", 4.5, "teks di tag/hover"),
    ("ink-2", "surface", 4.5, "teks sekunder di panel"),
    ("ink-2", "bg", 4.5, "teks sekunder di latar"),
    ("on-green", "green", 4.5, "teks tombol utama / chip lantai"),
    ("green", "surface", 4.5, "judul hijau di panel"),
    ("on-accent", "accent", 4.5, "badge SIMULASI / tag terkunci"),
    ("accent-ink", "surface", 4.5, "tautan dokumen"),
    ("control-border", "surface", 3.0, "batas kontrol"),
    ("control-border", "bg", 3.0, "batas kontrol di latar"),
    ("focus", "bg", 3.0, "cincin fokus di latar"),
    ("focus", "surface", 3.0, "cincin fokus di panel"),
    ("accent", "surface", 3.0, "garis prompt interaksi"),
]
# Fixed colours used on the 3D overlay labels (not themed): text on label pill.
FIXED = [("#1d2a23", "#fffaf0", 4.5, "label ruang"), ("#8a3b1c", "#fffaf0", 4.5, "label ruang terkunci")]


def block(css: str, selector_regex: str) -> dict:
    m = re.search(selector_regex + r"\s*\{(.*?)\}", css, re.S)
    if not m:
        raise SystemExit(f"selector not found: {selector_regex}")
    return dict(re.findall(r"--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})", m.group(1)))


def lum(hex_: str) -> float:
    c = [int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(a: str, b: str) -> float:
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def main() -> int:
    css = CSS.read_text(encoding="utf-8")
    themes = {"light": block(css, r"(?m)^:root"), "dark": block(css, r":root\[data-theme='dark'\]")}
    # the prefers-color-scheme dark block must equal the explicit dark theme
    media_dark = block(css, r":root:not\(\[data-theme='light'\]\)")
    mismatch = {k: (v, themes["dark"].get(k)) for k, v in media_dark.items() if themes["dark"].get(k) != v}
    rows, fails = [], []
    for theme, tok in themes.items():
        for fg, bg, need, what in PAIRS:
            r = ratio(tok[fg], tok[bg])
            rows.append({"theme": theme, "fg": fg, "bg": bg, "fgHex": tok[fg], "bgHex": tok[bg], "ratio": round(r, 2), "need": need, "what": what, "ok": r >= need})
            if r < need:
                fails.append(rows[-1])
    for fg, bg, need, what in FIXED:
        r = ratio(fg, bg)
        rows.append({"theme": "both", "fg": fg, "bg": bg, "ratio": round(r, 2), "need": need, "what": what, "ok": r >= need})
        if r < need:
            fails.append(rows[-1])
    for row in rows:
        print(f"{'PASS' if row['ok'] else 'FAIL'} {row['theme']:5} {row['what']:32} {row['ratio']:5.2f} >= {row['need']}")
    if mismatch:
        print("FAIL media-query dark block differs from [data-theme=dark]:", mismatch)
    out = ROOT / "docs" / "evidence" / "M1" / "contrast.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"pairs": rows, "mediaDarkMismatch": mismatch}, indent=1) + "\n", encoding="utf-8")
    return 1 if fails or mismatch else 0


if __name__ == "__main__":
    sys.exit(main())
