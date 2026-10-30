#!/usr/bin/env bash
set -euo pipefail
bin="$RUNNER_TEMP/runner-tools"
mkdir -p "$bin"
# Pin release and verify against the publisher's release checksum metadata.
release='2026.10.6'
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset='cloudflared-linux-amd64'; digest='1d356dac769d0dbf62ebe588c4034824bbff98d5790c2f844cc99e0e2f57462d';;
  Darwin-arm64) asset='cloudflared-darwin-arm64.tgz'; digest='ea1e5105d35bbe16cee5b2f7b4742059ada341fbd35938ed827c24b85efa51c8';;
  Darwin-x86_64) asset='cloudflared-darwin-amd64.tgz'; digest='6c04a13835ca5ff29a0c6f58d17d1f3956aad1b7df1631f5b5efbc06269deded';;
  *) echo 'Unsupported runner architecture' >&2; exit 1;;
esac
curl --fail --location --retry 3 "https://github.com/cloudflare/cloudflared/releases/download/$release/$asset" -o "$bin/$asset"
node - "$bin/$asset" "$digest" <<'NODE'
const fs = require('node:fs'), crypto = require('node:crypto');
const [file, expected] = process.argv.slice(2);
const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (expected !== actual) throw Error('cloudflared release digest mismatch');
NODE
if [[ "$asset" == *.tgz ]]; then tar -xzf "$bin/$asset" -C "$bin"; else mv "$bin/$asset" "$bin/cloudflared"; fi
chmod +x "$bin/cloudflared"
echo "$bin" >> "$GITHUB_PATH"
curl --fail --location --retry 3 https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.11.0/maestro.zip -o "$bin/maestro.zip"
unzip -q "$bin/maestro.zip" -d "$bin/maestro-cli"
echo "$bin/maestro-cli/maestro/bin" >> "$GITHUB_PATH"
mkdir -p "$SESSION_STATE_DIR" results
