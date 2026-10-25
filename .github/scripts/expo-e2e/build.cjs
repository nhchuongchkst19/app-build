const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve('app');
const output = path.resolve('binary');
const platform = process.env.PLATFORM;
const run = (cmd, args, cwd = root, capture = false) => execFileSync(cmd, args, {
  cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
});
function files(dir, predicate) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (predicate(p, e)) return [p];
    return e.isDirectory() ? files(p, predicate) : [];
  });
}
function only(list, label) {
  if (list.length !== 1) throw Error(`Expected one ${label}, found ${list.length}; custom flavors/schemes need explicit project configuration`);
  return list[0];
}
let artifact;
if (platform === 'android') {
  const native = path.join(root, 'android');
  fs.chmodSync(path.join(native, 'gradlew'), 0o755);
  // Release embeds JS. Limit compilation to the emulator architecture.
  run('./gradlew', [':app:assembleRelease', '--build-cache', '--max-workers=2', '-PreactNativeArchitectures=x86_64'], native);
  const apk = only(files(path.join(native, 'app/build/outputs/apk/release'), p => p.endsWith('.apk')), 'release APK');
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const versions = fs.readdirSync(path.join(sdk, 'build-tools')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const aapt = path.join(sdk, 'build-tools', versions.at(-1), 'aapt');
  const badging = run(aapt, ['dump', 'badging', apk], root, true);
  if (badging.match(/package: name='([^']+)'/)?.[1] !== process.env.APP_ID) throw Error('APK package differs from app_id');
  // A project requiring production signing must add an emulator signing config;
  // never fetch store keys. Expo-generated projects normally use a debug key.
  const apksigner = path.join(sdk, 'build-tools', versions.at(-1), 'apksigner');
  run(apksigner, ['verify', apk]);
  artifact = 'app.apk';
  fs.copyFileSync(apk, path.join(output, artifact));
} else {
  const native = path.join(root, 'ios');
  const bundle = fs.existsSync(path.join(root, 'Gemfile'));
  if (bundle) run('bundle', ['install']);
  run(bundle ? 'bundle' : 'pod', bundle ? ['exec', 'pod', 'install', '--project-directory=ios'] : ['install', '--project-directory=ios']);
  const workspace = only(fs.readdirSync(native).filter(p => p.endsWith('.xcworkspace')), 'Xcode workspace');
  const schemes = files(native, (p) => p.includes('/xcshareddata/xcschemes/') && p.endsWith('.xcscheme'))
    .filter(p => !p.includes('/Pods/')).map(p => path.basename(p, '.xcscheme'));
  const scheme = process.env.IOS_SCHEME || only([...new Set(schemes)], 'shared app scheme');
  run('xcodebuild', ['-workspace', path.join('ios', workspace), '-scheme', scheme,
    '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator',
    '-derivedDataPath', '.expo-e2e-derived', 'CODE_SIGNING_ALLOWED=NO', 'build', '-showBuildTimingSummary']);
  const app = only(fs.readdirSync(path.join(root, '.expo-e2e-derived/Build/Products/Release-iphonesimulator'))
    .filter(p => p.endsWith('.app')), 'simulator app');
  const dir = path.join(root, '.expo-e2e-derived/Build/Products/Release-iphonesimulator', app);
  const id = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(dir, 'Info.plist')], root, true).trim();
  if (id !== process.env.APP_ID) throw Error('Simulator bundle differs from app_id');
  artifact = 'app.tar.gz';
  run('tar', ['-czf', path.join(output, artifact), '-C', path.dirname(dir), path.basename(dir)]);
}
const manifest = {
  schema: 1, platform, appId: process.env.APP_ID,
  repository: run('git', ['config', '--get', 'remote.origin.url'], root, true).trim().replace(/\.git$/, '').replace('https://github.com/', ''),
  sourceSha: run('git', ['rev-parse', 'HEAD'], root, true).trim(),
  workflowSha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
  artifact, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(output, artifact))).digest('hex'),
  node: process.version, builtAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
