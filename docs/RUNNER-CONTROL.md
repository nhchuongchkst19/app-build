# Agent-controlled runner sessions

The builder owns the worker, CLI and workflows. Target app repositories only supply source code; they do not need a workflow or control-plane dependency. A single Actions job keeps its emulator, Metro, files and build outputs while an agent iterates. Nothing submits to an app store.

## Start

Requires Node 24, pnpm 9, authenticated `gh` with Actions access to the builder repository and the existing builder `KEY` locally. The builder already needs `KEY`, `GH_TOKEN` (target checkout access) and `USER` (default target owner) as repository secrets. Do not add the root key or session token to workflow inputs, CLI arguments, Git or endpoint artifacts.

```bash
cd /home/Projects/app-build/tools/runner-control
pnpm install --frozen-lockfile
# Provide RUNNER_KEY through your agent's secret environment, or --key-file /private/path.
node src/cli.mjs start --repo hoangdaicntt/temp-mail-otp --ref FULL_COMMIT_SHA --app-id com.otpinbox.app --state /tmp/otp-session.json
node src/cli.mjs status --state /tmp/otp-session.json
```

Native PTY requires a compiler/make/Python on supported Unix systems; GitHub Ubuntu/macOS images have them. On a thin CLI-only host, `pnpm install --frozen-lockfile --ignore-scripts` suffices for the CLI (PTY executes remotely). Use Docker for local PTY build/tests if host software changes are not authorized.

`start` dispatches `expo-agent-session.yml` using `gh`, identifies the run by its UUID, then downloads its non-secret endpoint artifact while the job is still running. A state file stores only endpoint metadata; use different `--state` files for simultaneous sessions. `--builder OWNER/REPO` and `--workflow-ref REF` select a different builder. Session dispatch requires normal GitHub authorization. The public tunnel requires a derived session credential.

Start options: `--platform android|ios`, `--profile development|release`, `--no-prepare`, `--max-minutes 120` (5..330), `--idle-minutes 15` (1..60), `--api-level 35`. Both platforms boot a device. App dependency installation/prebuild is a normal recoverable worker command, visible in `status`; wait for it before building. Preparation failure leaves the session open for repair. iOS is implemented but must be tested separately on a macOS runner.

## Control

```bash
node src/cli.mjs exec --cwd app -- 'git rev-parse HEAD'
node src/cli.mjs exec --background --cwd app --timeout 0 --env '{"CI":"false"}' -- 'pnpm exec expo start --dev-client --host lan'
node src/cli.mjs rpc exec.list
node src/cli.mjs wait PROCESS_UUID
node src/cli.mjs logs PROCESS_UUID
node src/cli.mjs exec --pty --background -- 'bash --noprofile --norc'
node src/cli.mjs rpc exec.write '{"processId":"PROCESS_UUID","data":"pwd\n"}'
node src/cli.mjs rpc exec.resize '{"processId":"PROCESS_UUID","cols":120,"rows":40}'
node src/cli.mjs rpc exec.signal '{"processId":"PROCESS_UUID","signal":"SIGINT"}'
node src/cli.mjs patch /tmp/fix.patch --cwd app
node src/cli.mjs upload /tmp/flow.yaml results/smoke.yaml
node src/cli.mjs download results/screen.png /tmp/screen.png
node src/cli.mjs finish passed --reason 'Smoke test passed after repair'
```

Append `--state /tmp/otp-session.json` to commands when not using the default state file. `exec` waits by default and returns the command's exit code; `--background` returns a process ID immediately. Its default remote timeout is 600000 ms; `--timeout 0` leaves a background process alive until explicitly stopped or the session ends. `--env '{"NAME":"value"}'` supplies per-command environment. `cwd` resolves relative to the Actions workspace, which contains `app/` and `builder/`. Each ordinary exec has its own shell; use explicit cwd/env or a persistent PTY for shell state.

A failed command never ends the job. Agent mutations/builds/tests must be ordered explicitly; independent background processes may run concurrently. Reload/relaunch and reset app state before a deterministic UI flow.

Android development build example (after preparation finishes):

```bash
node src/cli.mjs exec --cwd app/android --timeout 1800000 -- './gradlew :app:assembleDebug --max-workers=2 --build-cache -PreactNativeArchitectures=x86_64'
node src/cli.mjs exec -- 'adb install -r app/android/app/build/outputs/apk/debug/app-debug.apk'
node src/cli.mjs exec -- 'adb reverse tcp:8081 tcp:8081'
node src/cli.mjs exec --background --cwd app --timeout 0 --env '{"CI":"false"}' -- 'pnpm exec expo start --dev-client --host lan'
# Open your app's development-client deep link, then run uploaded Maestro flows.
node src/cli.mjs exec -- 'adb exec-out screencap -p > results/screen.png'
```

For Expo SDK 57, `expo prebuild` recreates native folders by default. For a compatible display-name/resource change, preserve the generated tree and build outputs with `pnpm exec expo prebuild --platform android --no-install --no-clean` before Gradle. Check the installed CLI help for other SDKs; native dependency/plugin changes may require a clean regeneration. Metro must use `CI=false` for watch/reload behavior. Using `--host lan` avoids localhost resolving to an IPv6-only listener while `adb reverse` connects over IPv4; Metro still stays inside the runner network and is not exposed by the control tunnel.

Bundled verification can use the existing Expo E2E build helper from workspace root (`mkdir -p binary; node builder/.github/scripts/expo-e2e/build.cjs`); pass a valid `APP_ID`. This produces an emulator release binary, not a store submission. The agent remains free to use other build commands.

## Protocol

WebSocket `/control`, `Authorization: Bearer SESSION_TOKEN`. JSON requests `{id, method, params}`; responses `{id, result}` or `{id, error: {message}}`. Stable request IDs deduplicate side effects within a running worker; reuse with different parameters is rejected. Limits: 20000 requests and 1000 processes per session, 1 MiB RPC frames, 64 MiB output per process. These protect bounded session memory/disk, not provide a sandbox.

Methods: `session.status`, `session.finish` (`result: passed|failed`), `exec.start`, `exec.get`, `exec.list`, `exec.write` (stdin; optional eof), `exec.signal`, `exec.resize`, `fs.read` (offset/length, optional base64), `fs.write` (atomic replace), `fs.patch` (checked git patch), `events.since` (after/limit).

Events have a monotonically increasing `seq`. The worker retains the last 2000 events in memory and appends all events to disk. Replay returns `oldestSeq`, `latestSeq`, and `truncated` if older events were evicted. Full per-process log paths come from `exec.get`; use HTTP download for older output. WebSocket backpressure disconnects slow clients instead of accumulating unlimited memory. Worker and processes survive socket disconnects; they do not survive runner/worker loss.

Authenticated HTTP `GET /health`; `GET /files?path=...&offset=...&length=...` streams files; `PUT /files?path=...` atomically uploads up to 256 MiB. Larger binary downloads should use GitHub artifacts or explicit ranged requests. Paths may be absolute because shell control already permits arbitrary runner-user access.

Session token is HMAC-SHA256 of the existing KEY and a JSON tuple: `["runner-control:v1", builderRepository, sessionId, runId, runAttempt]`. The root key is removed before spawning worker commands; derived token is masked. This inherits the security/entropy of the existing KEY; session derivation does not fix a previously exposed/guessable root key. Authorized shell access is full runner-user access, including sudo on hosted images; do not treat it as isolation from secrets on the same machine.

## Lifecycle and recovery

The worker listens only on loopback. Pinned, checksum-verified cloudflared creates a random HTTPS/WSS Quick Tunnel. No VPS or inbound firewall change is needed. Quick Tunnel has no SLA; heartbeat and retry are required. It supports this WebSocket design; SSE is not used.

On tunnel process exit, supervisor starts a replacement and publishes a new endpoint artifact with increasing generation. `refresh` discovers it; CLI RPC calls and long-running waits refresh it automatically on transport errors while retaining request IDs. A wait can also be restarted for the same process; file transfer can be retried. CLI refuses to replay commands into a different run attempt because that means the worker was replaced. Old process output is available through logs. No rebuild is required after a socket/tunnel reconnect.

The worker closes on `finish`, idle timeout or maximum lifetime. Protocol pings do not extend idle time; status/polling do. `finish` stops process groups, writes `result.json`, closes sockets/tunnel and determines the job exit code. Workflow finally uploads session evidence plus workspace `results/` and shuts down the emulator. GitHub force cancellation/runner loss can prevent final artifact upload; endpoint artifacts already published remain available until retention/cleanup.

References: [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [ws](https://github.com/websockets/ws), [node-pty](https://github.com/microsoft/node-pty).
