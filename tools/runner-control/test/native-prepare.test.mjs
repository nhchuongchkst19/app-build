import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const mobileScript = path.resolve(import.meta.dirname, '../../../.github/scripts/runner-control/prepare-native-mobile.cjs');
const desktopScript = path.resolve(import.meta.dirname, '../../../.github/scripts/runner-control/prepare-native-desktop.cjs');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-prepare-'));
  await fs.mkdir(path.join(root, 'app'));
  return root;
}

function run(script, root, env) {
  return spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
}

test('native mobile preparation validates platform and project layout', async t => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.match(run(mobileScript, root, { PLATFORM: 'windows' }).stderr, /requires android or ios/);
  assert.match(run(mobileScript, root, { PLATFORM: 'android' }).stderr, /committed Gradle wrapper/);
  assert.match(run(mobileScript, root, { PLATFORM: 'ios' }).stderr, /Xcode project\/workspace or Package.swift/);
});

test('native desktop preparation validates platform and toolchain markers', async t => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.match(run(desktopScript, root, { PLATFORM: 'android' }).stderr, /requires windows or macos/);
  assert.match(run(desktopScript, root, { PLATFORM: 'windows', NATIVE_TOOLCHAIN: 'winui3' }).stderr, /requires a Windows solution or project/);
  assert.match(run(desktopScript, root, { PLATFORM: 'macos', NATIVE_TOOLCHAIN: 'swiftpm' }).stderr, /requires Package.swift/);
});
