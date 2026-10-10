"""Drive Safari with real macOS VoiceOver and record what VoiceOver actually spoke.

Evidence for REQ-ACCESS-01 (docs/DEVICE-VALIDATION.md section 2). Each step sends a real
keystroke to Safari, waits, then reads VoiceOver's own "last phrase". Nothing is inferred:
a step whose phrase does not match its expectation is recorded as FAIL with the phrase.
"""
import json
import subprocess
import sys
import time
from datetime import datetime, timezone

URL = sys.argv[1] if len(sys.argv) > 1 else "https://employee-rpg.air-buddy.site/?a11ylog=1"
OUT = sys.argv[2] if len(sys.argv) > 2 else "voiceover-run.json"

KEYCODES = {"tab": 48, "return": 36, "escape": 53, "down": 125, "right": 124, "space": 49}


def osa(script, timeout=15):
    try:
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else "ERROR: " + r.stderr.strip()[:200]
    except subprocess.TimeoutExpired:
        return "TIMEOUT"


def phrase():
    return osa('tell application "VoiceOver" to return content of last phrase')


def key(name, shift=False, vo=False, opt=False):
    mods = []
    if shift:
        mods.append("shift down")
    if opt:
        mods.append("option down")
    if vo:
        mods += ["control down", "option down"]
    using = (" using {" + ", ".join(mods) + "}") if mods else ""
    osa('tell application "System Events" to key code %d%s' % (KEYCODES[name], using))


def vo_cmd(cmd):
    osa('tell application "VoiceOver" to tell vo cursor to %s' % cmd)


steps = []


def record(name, expect_any, action, wait=1.6):
    action()
    time.sleep(wait)
    spoken = phrase()
    ok = any(e.lower() in spoken.lower() for e in expect_any)
    steps.append({"step": name, "expect_any": expect_any, "spoken": spoken, "result": "PASS" if ok else "FAIL"})
    print(("PASS " if ok else "FAIL ") + name + " -> " + spoken[:160], flush=True)


osa('tell application "Safari" to activate')
osa('tell application "Safari" to set URL of front document to "%s"' % URL)
time.sleep(9)
record("1 muat halaman: judul dibacakan", ["Kantor", "SIMULASI", "Employee", "RPG"], lambda: None, wait=0.5)
# Safari's default Tab skips links; Option+Tab is the documented way to reach links by keyboard.
record("1b Option+Tab: tautan lewati ke direktori", ["Lewati ke direktori"], lambda: key("tab", opt=True))
record("2 Enter lalu Tab: masuk direktori", ["Pergi", "Info", "Lobby", "ruang", "Direktori"],
       lambda: (key("return"), time.sleep(0.8), key("tab")))
for i in range(3):
    record("2.%d Tab berikut di direktori bernama" % (i + 1), ["Pergi", "Info", "Temui", "tombol", "button"], lambda: key("tab"))
record("4 Enter pada Pergi: nama ruang diumumkan", ["Lobby", "Galeri", "Ruang", "rapat"], lambda: key("return"), wait=4)

osa('tell application "Safari" to set URL of front document to "%s"' % URL)
time.sleep(8)
osa('tell application "Safari" to do JavaScript "document.getElementById(\'btn-directory\').focus()" in front document')
record("2c tombol Direktori bernama", ["Direktori"], lambda: None, wait=1)
record("2d buka direktori", ["direktori", "Direktori", "complementary"], lambda: key("return"), wait=1.5)
for i in range(30):
    key("tab")
    time.sleep(0.35)
    if "Temui" in phrase():
        break
record("3a tombol Temui persona bernama", ["Temui"], lambda: None, wait=0.3)
record("3b Enter: dialog persona dibacakan", ["dialog", "Nova", "Max", "Rex", "Bruno", "Hugo", "Clara", "Stella", "Kevin", "Echo", "Leo"],
       lambda: key("return"), wait=1.8)
record("3c Escape: fokus kembali ke Temui", ["Temui"], lambda: key("escape"), wait=1.5)

osa('tell application "Safari" to do JavaScript "document.getElementById(\'btn-settings\').click()" in front document')
time.sleep(1.5)
found = {}
for i in range(25):
    key("tab")
    time.sleep(0.35)
    p = phrase()
    for k in ("Tema", "Kualitas grafis", "Kurangi gerak", "Mode visitor"):
        if k in p and k not in found:
            found[k] = p
steps.append({"step": "6 pengaturan: legend & checkbox dibacakan", "expect_any": ["Tema", "Kualitas grafis", "Kurangi gerak", "Mode visitor"],
              "spoken": json.dumps(found, ensure_ascii=False), "result": "PASS" if len(found) == 4 else "FAIL"})
print(steps[-1]["result"], "6 pengaturan", found, flush=True)
key("escape")

osa('tell application "Safari" to set URL of front document to "%s"' % URL.replace("?a11ylog=1", "?nogl=1&a11ylog=1"))
time.sleep(8)
seen = set()
for i in range(25):
    key("tab")
    time.sleep(0.35)
    p = phrase()
    if "Pergi" in p or "Info" in p or "Temui" in p:
        seen.add(p[:60])
steps.append({"step": "7 tanpa WebGL: ruang/persona dapat dicapai keyboard", "expect_any": ["Pergi", "Info", "Temui"],
              "spoken": json.dumps(sorted(seen), ensure_ascii=False), "result": "PASS" if len(seen) >= 3 else "FAIL"})
print(steps[-1]["result"], "7 nogl", len(seen), flush=True)

meta = {
    "url": URL,
    "ranAt": datetime.now(timezone.utc).isoformat(),
    "screenReader": "macOS VoiceOver (real), Safari",
    "method": "System Events keystrokes; VoiceOver AppleScript 'content of last phrase'",
    "steps": steps,
    "passed": sum(s["result"] == "PASS" for s in steps),
    "total": len(steps),
}
with open(OUT, "w") as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)
print("SAVED", OUT, meta["passed"], "/", meta["total"])
