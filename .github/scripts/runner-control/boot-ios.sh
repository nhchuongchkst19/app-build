#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$SESSION_STATE_DIR"
xcrun simctl list devices available --json > "$SESSION_STATE_DIR/simulators.json"
sim=$(node - "$SESSION_STATE_DIR/simulators.json" <<'NODE'
const fs = require('node:fs');
const devices = JSON.parse(fs.readFileSync(process.argv[2])).devices;
const runtimes = Object.keys(devices).filter(k => k.includes('.iOS-')).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }));
const device = runtimes.flatMap(k => devices[k]).find(d => d.isAvailable && d.name.startsWith('iPhone'));
if (!device) throw Error('No iPhone simulator available');
process.stdout.write(device.udid);
NODE
)
echo "$sim" > "$SESSION_STATE_DIR/simulator-id"
xcrun simctl boot "$sim"
xcrun simctl bootstatus "$sim" -b
