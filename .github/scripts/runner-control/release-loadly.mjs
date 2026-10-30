// Runs after the control session, with release credentials scoped to that step.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { normalizeLoadlyRequest } from '../../../tools/runner-control/src/loadly.mjs';

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const stateDir = path.resolve(process.env.SESSION_STATE_DIR);
const results = path.join(root, 'results/loadly');
const platform = process.env.PLATFORM;
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...options });
const output = (key, value) => fs.appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);

async function readRequest() {
  const stored = JSON.parse(await fs.readFile(path.join(stateDir, 'loadly-request.json'), 'utf8'));
  const session = JSON.parse(await fs.readFile(path.join(stateDir, 'result.json'), 'utf8'));
  if (stored.schema !== 1 || session.result !== 'passed' || stored.sessionId !== process.env.SESSION_ID || session.sessionId !== stored.sessionId || stored.platform !== platform) {
    throw Error('Loadly release requires finish passed from the matching session/platform');
  }
  return normalizeLoadlyRequest({ profile: stored.profile, title: stored.title, path: stored.artifactPath ?? undefined }, root, platform);
}

async function validateDeviceArtifact(file) {
  const entries = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (platform === 'android') {
    if (!/^lib\/(arm64-v8a|armeabi-v7a)\//m.test(entries)) throw Error('APK has no ARM device libraries; build a device APK instead of an x86_64-only emulator APK');
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!sdk) throw Error('Android SDK is required to verify APK signing');
    const versions = (await fs.readdir(path.join(sdk, 'build-tools'))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    run(path.join(sdk, 'build-tools', versions.at(-1), 'apksigner'), ['verify', file]);
  } else {
    const plistEntry = entries.split('\n').filter(entry => /^Payload\/[^/]+\.app\/Info\.plist$/.test(entry));
    if (plistEntry.length !== 1) throw Error('Expected one device app in the IPA');
    const plist = path.join(results, 'device-info.plist');
    try {
      await fs.writeFile(plist, execFileSync('unzip', ['-p', file, plistEntry[0]], { maxBuffer: 4 * 1024 * 1024 }));
      const supported = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleSupportedPlatforms', plist], { encoding: 'utf8' });
      if (!supported.includes('iPhoneOS')) throw Error('IPA must target a physical iOS device, not iOS Simulator');
    } finally { await fs.rm(plist, { force: true }); }
  }
}

async function stage(file, request) {
  await validateDeviceArtifact(file);
  const target = path.join(results, platform === 'android' ? 'app.apk' : 'app.ipa');
  if (file !== target) await fs.copyFile(file, target);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  await fs.writeFile(path.join(results, 'artifact.json'), JSON.stringify({
    platform, profile: request.profile, sourceSha: process.env.APP_SOURCE_SHA,
    artifact: target, sha256: hash.digest('hex'), stagedAt: new Date().toISOString(),
  }, null, 2));
}

async function findBinaries(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await findBinaries(file));
    else if (entry.isFile() && /\.(apk|ipa|aab|tar\.gz)$/.test(entry.name)) files.push(file);
  }
  return files;
}

async function main() {
  const mode = process.argv[2] || 'resolve';
  if (mode === 'record') {
    await fs.mkdir(results, { recursive: true });
    let response = process.env.LOADLY_OUTPUT || null;
    try { response = JSON.parse(response); } catch { /* Some action versions return plain text. */ }
    await fs.writeFile(path.join(results, 'release.json'), JSON.stringify({
      destination: 'loadly', actionOutcome: process.env.LOADLY_OUTCOME || 'skipped',
      response, recordedAt: new Date().toISOString(),
    }, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
      `\n## Loadly release\n\nAction outcome: ${process.env.LOADLY_OUTCOME || 'skipped'}. See the Loadly action logs, Telegram notification and results/loadly/release.json.\n`);
    return;
  }
  if (!['resolve', 'build'].includes(mode)) throw Error('Expected resolve, build or record');
  if (mode === 'resolve') {
    try { await fs.access(path.join(stateDir, 'loadly-request.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await output('enabled', 'false'); return; }
  }
  const request = await readRequest();
  await fs.mkdir(results, { recursive: true });
  if (mode === 'resolve') {
    if (!process.env.LOADLYIO_TOKEN) throw Error('Repository secret LOADLYIO_TOKEN is required');
    if (request.artifactPath) await stage(request.artifactPath, request);
    await output('profile', request.profile);
    const label = process.env.APP_SOURCE_SHA || 'session';
    await output('title', request.title || `${process.env.APP_REPO}[${label}] ${platform} ${request.profile}`);
    await output('artifact_path', path.join(results, platform === 'android' ? 'app.apk' : 'app.ipa'));
    await output('build', request.artifactPath ? 'false' : 'true');
    await output('enabled', 'true');
    return;
  }
  if (!process.env.EXPO_TOKEN) throw Error('Repository secret EXPO_TOKEN is required for an EAS device build');
  if (request.artifactPath) throw Error('An existing artifact does not require a build');
  run(process.execPath, ['builder/.github/scripts/update-app-version.cjs', 'app'], { env: { ...process.env, BUILD_PLATFORM: platform } });
  if (platform === 'ios' && request.profile === 'development') {
    run(process.execPath, ['builder/.github/scripts/configure-ios-development-http.cjs', 'app']);
  }
  const artifacts = path.join(results, 'eas');
  await fs.mkdir(artifacts, { recursive: true });
  run('npx', ['--yes', 'eas-cli@21.0.0', 'build', '--local', '--non-interactive', '--platform', platform, '--profile', request.profile], {
    cwd: path.join(root, 'app'), env: { ...process.env, EAS_LOCAL_BUILD_ARTIFACTS_DIR: artifacts },
  });
  const binaries = await findBinaries(artifacts);
  const extension = platform === 'android' ? '.apk' : '.ipa';
  if (binaries.length !== 1 || !binaries[0].endsWith(extension)) {
    throw Error(`Loadly requires one ${extension}; configure the EAS profile for a device APK/IPA (not AAB or simulator)`);
  }
  await stage(binaries[0], request);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
