#!/usr/bin/env bash
set -euo pipefail
root="$PWD"
flow=$(node -e 'const fs=require("fs"),p=require("path");const r=fs.realpathSync("test-source");const f=fs.realpathSync(p.resolve(r,process.env.FLOW_PATH));if(!f.startsWith(r+p.sep))throw Error("Flow outside test checkout");process.stdout.write(f)')
cp binary/manifest.json results/binary-manifest.json
mkdir -p results/maestro
simulator_id=''
finish() {
  result=$?
  trap - EXIT
  if [[ "$PLATFORM" == android ]]; then
    adb logcat -d -t 2000 > "$root/results/android-logcat.txt" 2>&1 || true
    adb exec-out screencap -p > "$root/results/final-screen.png" 2>/dev/null || true
  elif [[ -n "$simulator_id" ]]; then
    xcrun simctl io "$simulator_id" screenshot "$root/results/final-screen.png" >/dev/null 2>&1 || true
    xcrun simctl shutdown "$simulator_id" || true
  fi
  exit "$result"
}
trap finish EXIT
if [[ "$PLATFORM" == android ]]; then
  adb install -r binary/app.apk
  device_id=$(adb get-serialno)
else
  xcrun simctl list devices available --json > "$RUNNER_TEMP/expo-e2e-devices.json"
  simulator_id=$(node -e '
    const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1])).devices;
    const runtimes=Object.keys(d).filter(k=>k.includes(".iOS-")).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    const phone=runtimes.flatMap(k=>d[k]).find(x=>x.isAvailable&&x.name.startsWith("iPhone"));
    if(!phone)throw Error("No available iPhone simulator runtime on runner");process.stdout.write(phone.udid);
  ' "$RUNNER_TEMP/expo-e2e-devices.json")
  xcrun simctl boot "$simulator_id"
  xcrun simctl bootstatus "$simulator_id" -b
  mkdir -p "$RUNNER_TEMP/expo-e2e-app"
  tar -xzf binary/app.tar.gz -C "$RUNNER_TEMP/expo-e2e-app"
  shopt -s nullglob
  apps=("$RUNNER_TEMP/expo-e2e-app/"*.app)
  [[ ${#apps[@]} -eq 1 ]]
  xcrun simctl install "$simulator_id" "${apps[0]}"
  device_id="$simulator_id"
fi
maestro --device "$device_id" test --format junit --output "$root/results/junit.xml" \
  --debug-output "$root/results/maestro" --test-output-dir "$root/results/maestro" \
  -e APP_ID="$APP_ID" "$flow" 2>&1 | tee "$root/results/maestro.log"
