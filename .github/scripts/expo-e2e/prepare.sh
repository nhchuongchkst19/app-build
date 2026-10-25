#!/usr/bin/env bash
set -euo pipefail
mkdir -p binary results
if [[ "$MODE" != build ]]; then
  node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync('test-source');
const flow = fs.realpathSync(path.resolve(root, process.env.FLOW_PATH));
if (!flow.startsWith(root + path.sep)) throw Error('Flow path must stay inside test checkout');
NODE
  git -C test-source rev-parse HEAD > results/test-source-sha.txt
fi
