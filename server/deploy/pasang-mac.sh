#!/bin/bash
# Pasang/rilis backend privat kantor-rpg di Mac mini (tempat profil Hermes).
#   server/deploy/pasang-mac.sh <sha>
# Salin server/ ke ~/.hermes/kantor-rpg/releases/<sha> (disk internal, bukan
# SSD eksternal, supaya launchd tetap jalan saat boot), arahkan symlink
# current, lalu muat ulang launchd id.perumnet.kantor-rpg-api.
# Rollback: ln -sfn releases/<sha-lama> ~/.hermes/kantor-rpg/current && launchctl kickstart -k gui/$UID/id.perumnet.kantor-rpg-api
set -euo pipefail
SHA="${1:?pakai: pasang-mac.sh <sha>}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$HOME/.hermes/kantor-rpg"
REL="$BASE/releases/$SHA"
LABEL=id.perumnet.kantor-rpg-api
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$BASE/releases" "$BASE/data" "$HOME/.hermes/log"
chmod 700 "$BASE" "$BASE/data"
[ -s "$BASE/data/proxy-secret" ] || { (umask 077; openssl rand -hex 32 > "$BASE/data/proxy-secret"); }
rm -rf "$REL.tmp"; mkdir -p "$REL.tmp"
rsync -a --exclude test --exclude deploy "$SRC/" "$REL.tmp/"
(cd "$REL.tmp" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
rm -rf "$REL"; mv "$REL.tmp" "$REL"
PREV="$(readlink "$BASE/current" 2>/dev/null || true)"
ln -sfn "$REL" "$BASE/current"
echo "current: $REL (sebelumnya: ${PREV:-tidak ada})"
HERMES_BIN="$(dirname "$(command -v hermes)")"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/opt/homebrew/bin/node</string><string>$BASE/current/main.mjs</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$HERMES_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>KANTOR_RPG_DATA</key><string>$BASE/data</string>
    <key>KANTOR_RPG_BIND</key><string>100.122.121.27</string>
    <key>KANTOR_RPG_PORT</key><string>3242</string>
  </dict>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>KeepAlive</key><true/><key>RunAtLoad</key><true/><key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$HOME/.hermes/log/kantor-rpg-api.log</string>
  <key>StandardErrorPath</key><string>$HOME/.hermes/log/kantor-rpg-api.log</string>
</dict></plist>
PL
[ "${KANTOR_RPG_NO_LOAD:-}" = 1 ] && { echo "plist: $PLIST (belum dimuat)"; exit 0; }
"$(dirname "$0")/muat-launchd.sh"
