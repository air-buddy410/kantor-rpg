#!/bin/bash
# Muat atau mulai ulang layanan backend privat kantor-rpg (bukan gateway Hermes).
set -euo pipefail
LABEL=id.perumnet.kantor-rpg-api
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then launchctl kickstart -k "gui/$UID/$LABEL"; else launchctl bootstrap "gui/$UID" "$PLIST"; fi
sleep 2
launchctl print "gui/$UID/$LABEL" | grep -E "state =|pid =" | head -2
