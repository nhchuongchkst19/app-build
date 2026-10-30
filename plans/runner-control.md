# Feature: Agent-controlled GitHub runner sessions

## Overview
An AI agent opens one GitHub Actions job, controls its shell/files/processes through an authenticated WebSocket over Cloudflare Quick Tunnel, iterates on build/test without recreating the runner, then finishes the session. User authorized implementation, push to main and a real Android experiment with `/home/Projects/temp-mail-otp`.

## Current project survey
- Existing checkout at `/home/Projects/app-build`; preserve unrelated `fix/expo-ios-driver-timeout` commit. Implement from current `origin/main`.
- Reuse pinned checkout/setup actions and Expo E2E helpers where useful. Keep legacy workflows unchanged.
- Root package is an old Expo app: isolate control-plane dependencies under `tools/runner-control` with its own pnpm lockfile.
- Target app: `hoangdaicntt/temp-mail-otp`, main, Expo 57, pnpm 9.15.9, Android ID `com.otpinbox.app`, development client present, no committed Maestro flows. Preserve local untracked Store assets.

## Dependencies and references
- Node 24, pnpm 9; `ws` 8.22.0, `node-pty` 1.1.0, `@actions/artifact` 6.3.1, pinned lockfile.
- https://github.com/websockets/ws/blob/master/doc/ws.md
- https://github.com/microsoft/node-pty
- https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
- https://docs.expo.dev/versions/v57.0.0/
- https://github.com/actions/toolkit/tree/main/packages/artifact

## Architecture and decisions
- Worker binds loopback only. cloudflared creates a per-session HTTPS/WSS endpoint; no VPS service or inbound firewall change.
- Reuse `secrets.KEY`; HMAC-SHA256 with versioned purpose + builder repository + session UUID + GitHub run ID + run attempt. No secret workflow input. CLI uses RUNNER_KEY (or key file) locally. Existing KEY is low entropy/exposed by existing inputs; this inherits that limitation and does not claim to repair it.
- RPC: session.status/finish, exec.start/list/write/signal/resize, fs.read/write/patch; authenticated HTTP streaming for upload/download. Shell is deliberately unrestricted for this trusted private-control use case.
- Commands have stable IDs and an in-memory deduplication map for the session. Processes outlive socket disconnects. Append sequenced events to disk, expose bounded replay with cursors, use heartbeat and reconnection. No arbitrary claim of persistence after runner loss.
- Supervisor restarts failed tunnels and publishes a new non-secret endpoint artifact. CLI discovers current endpoint via gh; metadata pins run/repository/session identity.
- Endpoint artifacts are uploaded during the running job, not deferred until completion. Output artifacts/logs contain no session token. Mask derived token and remove root key from worker child environment.
- Workflow inputs: app repo/owner/ref, platform, profile, app ID, session ID, native preparation toggle, emulator API, max and idle lifetime. Android first real validation; iOS toolchain support with simulator startup and same RPC, documented as unverified until exercised.
- JS iteration uses a development build + Metro; bundled release check available via shell/existing helpers. Never auto-submit to app stores.
- Final session result determines workflow exit code. Ordinary failed commands do not terminate the worker. Timeouts/cancellation clean process groups and tunnel. Idle timeout measures authenticated application activity, not ping traffic.

## Tasks
- [x] 1. Implement worker: auth, RPC, shell + PTY, stdin/signals, file operations, binary HTTP transport, process logs/replay, idempotency and lifecycle.
- [x] 2. Implement supervisor and CLI: gh dispatch/discovery, endpoint publication/replacement, reconnect, exec/wait/logs/files/finish.
- [x] 3. Add workflow and setup helpers: Android/iOS toolchain, persistent emulator, optional app preparation, tunnel, final artifact collection and cleanup.
- [x] 4. Add meaningful integration tests for auth rejection, command replay, reconnect, process cancellation, PTY/stdin, file transfer/patch, limits and finish cleanup. Add CI validation and operator documentation.
- [x] 5. Run local checks, commit and push main. Dispatch Android session pinned to target app SHA.
- [x] 6. Through public WSS, exercise commands and files, failure then repair, build/install/launch target app, run UI test, fetch screenshots, rename the app and measure rebuild with/without preserving the native tree, finish, verify job result. Record run URL, source SHA, outcomes and limitations here.

## Validation
- node --test for real worker/CLI integration; pnpm frozen install; actionlint in Docker; syntax checks.
- Real Actions experiment must demonstrate public tunnel/auth, reconnect/deduplication, failed command followed by repair, Android app build, emulator interaction and screenshot download in one job. Use temporary runner-only test flow; do not change local/committed app source or local Store assets; requested display-name edits happen only in the runner checkout.
- Monitor with gh; no local EAS build. Finish session explicitly and verify final artifacts. If native build exposes app/toolchain issues, diagnose via the socket and record actual result rather than declare a pass.

## Risks and constraints
- Quick Tunnel has no SLA; endpoint changes on restart. No SSE. WebSocket ping/reconnect/replay required.
- GitHub-hosted job maximum six hours; default 120 minutes, idle 15 minutes. Runner loss requires a new session.
- Any shell authorized here can access files/processes as the runner user; this is not a sandbox for untrusted agents. Do not introduce production signing secrets to the session.
- Serialize source mutation/build/test at agent level; background Metro/emulator may coexist. RPC does not guess dependency ordering.

## Execution evidence
Android experiment completed; worker result and final artifacts verified: https://github.com/nhchuongchkst19/app-build/actions/runs/41096035847

- Target SHA: `6a088a1c19f860000a4d8b1b397bdc4f4ad1cae6`.
- Public WSS verified: auth rejection, shell/PTY/stdin, patch, binary round trip, failed command recovery, reconnect and duplicate request protection.
- Initial Android debug build succeeded in 13m56s; unchanged incremental build: 20s.
- Rename `OTP Inbox` -> `OTP Inbox Agent Test`, default Expo 57 prebuild: 163.83s total (3.29s prebuild, 160.54s Gradle).
- Rename again to `OTP Inbox Agent`, `prebuild --no-clean`: 19.34s total (3.03s prebuild, 16.31s Gradle). APK badging confirms the new native label.
- Public tunnel replacement reached generation 3; CLI rediscovered the endpoint and retained the same worker/processes. Retry budget was extended to tolerate DNS propagation.
- Functional flow verifies real OS clipboard by pasting into focused app search, refresh feedback, QR and appearance navigation. Final rerun waits for transition completion and theme-update feedback before screenshots.
- Metro uses CI=false and --host lan (localhost bound IPv6 only on this runner). Disable the Expo Tools floating button through the dev menu before UI automation; it otherwise overlaps Search.
- Sample source changes are confined to the runner checkout; local sample and remote app repository remain untouched.
- Eight local integration tests pass; initial GitHub CI passed.
- Session setup resolves pnpm from the isolated package directory to avoid Corepack selecting a different version from the workspace root.

## Final lifecycle verification
- Full session `result.json`: `passed`, finished at `2026-10-30T17:49:06.397Z`; every tracked command is marked stopped. Public endpoint returns 530 after tunnel shutdown.
- Final renamed-APK Maestro flow: 1/1 passed in 69s. Screenshots downloaded and visually checked (complete QR screen, Dark selected with dark UI, native name in Android App info).
- Results artifact downloaded successfully to `/tmp/otp-final-artifacts`; includes APK, JUnit, screenshots, source patch, timings and `experiment.json`.
- Final workflow bootstrap run: https://github.com/nhchuongchkst19/app-build/actions/runs/41101607635 ; Pixel 5/2048M configuration boots, authenticated shell works, `finish passed` accepted and result artifact published.
- Local final integration tests: 8 passed; workflow actionlint passed. Earlier remote CI passed at https://github.com/nhchuongchkst19/app-build/actions/runs/41098512322 .
- As of `2026-10-30T17:56Z`, GitHub Actions/Checks API still reports the full run as in_progress and the final bootstrap/CI as queued, despite their running endpoints, accepted finish commands and downloadable final artifacts. Do not claim a final green GitHub conclusion until the service metadata updates. This does not replace the independently verified worker/UI results.
- Detailed evidence and reproduction: [experiment report](../docs/RUNNER-CONTROL-EXPERIMENT.md).

## Optional agent-requested Loadly release

Implemented `runnerctl loadly` / `release.loadly` to queue one release in the active session, executed on the same runner after `finish passed`. The agent chooses an EAS profile (default development) or an existing signed device APK/IPA. No request means no release; failed/expired/cancelled sessions skip publishing. Reuses the pinned Loadly/Telegram action and existing secrets from `build.yml`, with release credentials scoped to post-session steps. EAS device builds reuse the existing native-version and iOS development HTTP helpers. Device artifact validation rejects simulator archives, AABs and emulator-only APKs. Upload response and binary hash are saved in the final evidence artifact.

Validation for this addition: JavaScript syntax, whitespace and actionlint only. No tests, workflow dispatch, build or upload were run, as requested by the user. The commit skips automatic CI to avoid starting additional runners for this untested addition.
