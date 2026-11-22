const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const workspace = process.cwd();
const appRoot = path.resolve(workspace, 'app');
const projectInput = process.env.PROJECT_PATH || '.';
const projectRoot = path.resolve(appRoot, projectInput);
const framework = process.env.DESKTOP_FRAMEWORK;

if (!['electron', 'tauri'].includes(framework)) throw Error('DESKTOP_FRAMEWORK must be electron or tauri');
if (projectRoot !== appRoot && !projectRoot.startsWith(appRoot + path.sep)) throw Error('PROJECT_PATH escapes the app checkout');
if (!fs.existsSync(projectRoot)) throw Error(`Desktop project directory not found: ${projectInput}`);

const executable = command => process.platform === 'win32' && ['corepack', 'pnpm', 'npm', 'yarn'].includes(command)
  ? `${command}.cmd`
  : command;
const run = (command, args, cwd = projectRoot) => execFileSync(executable(command), args, { cwd, stdio: 'inherit' });
const packageFile = path.join(projectRoot, 'package.json');

function installJavaScriptDependencies() {
  if (!fs.existsSync(packageFile)) return false;
  const lockfiles = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb']
    .filter(file => fs.existsSync(path.join(projectRoot, file)));
  if (lockfiles.length !== 1) throw Error('Commit exactly one supported lockfile (pnpm, npm, Yarn, or Bun)');
  const lock = lockfiles[0];
  if (lock === 'pnpm-lock.yaml') {
    run('corepack', ['enable']);
    run('pnpm', ['install', '--frozen-lockfile']);
  } else if (lock === 'package-lock.json') {
    run('npm', ['ci']);
  } else if (lock === 'yarn.lock') {
    run('corepack', ['enable']);
    const version = execFileSync(executable('yarn'), ['--version'], { cwd: projectRoot, encoding: 'utf8' }).trim();
    run('yarn', ['install', version.startsWith('1.') ? '--frozen-lockfile' : '--immutable']);
  } else {
    run('bun', ['install', '--frozen-lockfile']);
  }
  return true;
}

if (framework === 'electron') {
  if (!fs.existsSync(packageFile)) throw Error('Electron project requires package.json');
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!dependencies.electron) throw Error('The project does not declare Electron');
  installJavaScriptDependencies();
} else {
  const tauriRoot = path.join(projectRoot, 'src-tauri');
  if (!fs.existsSync(path.join(tauriRoot, 'Cargo.toml'))) throw Error('Tauri project requires src-tauri/Cargo.toml');
  const configs = ['tauri.conf.json', 'tauri.conf.json5', 'Tauri.toml'].filter(file => fs.existsSync(path.join(tauriRoot, file)));
  if (!configs.length) throw Error('No supported Tauri configuration found in src-tauri');
  installJavaScriptDependencies();
  run('cargo', fs.existsSync(path.join(tauriRoot, 'Cargo.lock')) ? ['fetch', '--locked'] : ['fetch'], tauriRoot);
}

console.log(`Prepared ${framework} project at ${projectInput}`);
