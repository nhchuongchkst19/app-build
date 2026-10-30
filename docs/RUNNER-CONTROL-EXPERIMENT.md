# Android runner-session experiment

Target: `hoangdaicntt/temp-mail-otp` at `6a088a1c19f860000a4d8b1b397bdc4f4ad1cae6`.

Full build/test run: https://github.com/nhchuongchkst19/app-build/actions/runs/41096035847

Session: `e6cd219c-05fc-41a7-be59-80b4d548ab7e`. Android API 35, x86_64 emulator, development APK, Expo SDK 57, Node 24, Java 17 and Maestro 2.11.0. Metro ran on the same runner with `CI=false`; `adb reverse tcp:8081 tcp:8081` connected the emulator to Metro. The control tunnel did not expose Metro.

## Build measurements

| Operation on the same runner | Prebuild | Gradle | Total measured |
| --- | ---: | ---: | ---: |
| Initial native debug build | Prepared separately | 13m56s | 13m56s Gradle |
| Unchanged incremental build | Not needed | 20s | 20s Gradle |
| Rename to `OTP Inbox Agent Test`, default SDK 57 prebuild | 3.29s | 160.54s | 163.83s |
| Rename to `OTP Inbox Agent`, `prebuild --no-clean` | 3.03s | 16.31s | 19.34s |

The final rename was about 43 times faster than the initial Gradle build, even including prebuild time. These are measurements for a display-name change on this app, not a guarantee for arbitrary native/dependency changes.

The installed SDK 57 CLI defaults to recreating native folders. Its `--no-clean` flag preserves the native tree and build outputs. Use it for compatible incremental config/resource changes; choose clean regeneration when required by changed native dependencies/plugins. Check the installed CLI help for other SDK versions.

`aapt dump badging` confirmed `application-label:'OTP Inbox Agent'` in the final APK. The APK installed successfully and Android App info displayed the new name.

## Functional verification

The final Maestro flow passed in 69 seconds on the renamed APK:

- Copy the actual inbox address, paste it through Android's native Paste menu into app search, assert that the focused input equals the captured address.
- Refresh the inbox and assert success feedback.
- Open QR code, verify the address screen, copy the address and return.
- Open Settings and Appearance, select Dark and Light, assert update feedback and capture each state.
- Return to Settings and verify Preferences.

Screenshots were inspected after download. The final dark screenshot shows the Dark row checked and the dark UI; the QR screenshot shows the complete QR screen. Wait for transitions before taking screenshots: accessibility elements can appear before navigation animations finish. Disable Expo's floating Tools button through its menu because it overlaps Search on this device. Do not send an extra Back/hideKeyboard after closing app search; closing the input already dismisses the keyboard.

An intentionally incorrect assertion failed, then a corrected flow was applied through `fs.patch` and rerun in the same session. Intermediate automation timing/overlay issues were corrected before the final pass. No inbound OTP/email delivery was tested.

## Control-plane verification

- Public HTTP without token returned 401; authenticated WSS and HTTP file transfer worked.
- Shell failure did not end the worker; repair and subsequent commands succeeded.
- Real PTY input, checked git patches and binary upload/download were exercised.
- A duplicate request ID across reconnect returned the same process and executed once.
- Tunnel processes were restarted, producing endpoint generations 1, 2 and 3. The same worker, files, build outputs and Metro persisted. CLI endpoint refresh recovered generation 3 automatically. Retries tolerate the tunnel/DNS propagation delay.
- The final `finish passed` command was accepted; `result.json` reports passed at 17:49:06 UTC with all tracked processes stopped. Final artifacts were downloaded and the public tunnel is closed. GitHub Actions/Checks API metadata had not reflected completion at 17:56 UTC; the plan records this separately from the verified worker/UI results.

## Evidence

Results artifact: `runner-e6cd219c-05fc-41a7-be59-80b4d548ab7e-results`.

Relevant paths inside the artifact:

- `results/experiment.json`: protocol checks, source SHA, timings and final UI outcome.
- `results/name-rebuild-timing.json`, `results/name-rebuild-preserve-timing.json`.
- `results/final-junit.xml`.
- `results/final/2026-10-30_174551/smoke/takeScreenshot/`: inbox, clipboard-search, QR, dark/light appearance and settings screenshots.
- `results/renamed-app.png`: Android App info showing `OTP Inbox Agent`.
- `results/app-source.patch`: temporary runner-only app changes.
- `results/otp-inbox-agent-debug.apk`: x86_64 emulator development APK (requires Metro).
- Worker event log, per-command logs and `result.json` under the session-state portion of the artifact.

No changes were pushed to the app repository. The local `/home/Projects/temp-mail-otp` source and its existing untracked Store assets were preserved. All implementation, workflow and documentation changes belong to `app-build`. iOS is implemented but was not exercised in this experiment.
