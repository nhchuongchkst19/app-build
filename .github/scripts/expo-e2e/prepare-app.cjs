const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve('app');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
if (!pkg.dependencies?.expo && !pkg.devDependencies?.expo) throw Error('Expected an Expo app at repository root');
const locks = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'].filter(f => fs.existsSync(path.join(root, f)));
if (locks.length !== 1) throw Error('Commit exactly one supported lockfile (pnpm, npm, Yarn)');
let command;
if (locks[0] === 'pnpm-lock.yaml') {
  run('corepack', ['enable']);
  run('pnpm', ['install', '--frozen-lockfile']);
  command = ['pnpm', ['exec', 'expo']];
} else if (locks[0] === 'package-lock.json') {
  run('npm', ['ci']);
  command = ['npx', ['--no-install', 'expo']];
} else {
  run('corepack', ['enable']);
  const version = execFileSync('yarn', ['--version'], { cwd: root, encoding: 'utf8' }).trim();
  run('yarn', ['install', version.startsWith('1.') ? '--frozen-lockfile' : '--immutable']);
  command = ['yarn', ['exec', 'expo']];
}
// Honor the same app hook used by EAS, without requiring Expo login/signing.
if (pkg.scripts?.['eas-build-post-install']) {
  const manager = locks[0] === 'pnpm-lock.yaml' ? 'pnpm' : locks[0] === 'yarn.lock' ? 'yarn' : 'npm';
  run(manager, ['run', 'eas-build-post-install']);
}
const platform = process.env.PLATFORM;
if (!['android', 'ios'].includes(platform)) throw Error('Invalid platform');
if (!fs.existsSync(path.join(root, platform))) {
  run(command[0], [...command[1], 'prebuild', '--platform', platform, '--no-install']);
}
