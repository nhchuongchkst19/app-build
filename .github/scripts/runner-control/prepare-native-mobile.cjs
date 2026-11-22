const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const appRoot = path.resolve('app');
const projectInput = process.env.PROJECT_PATH || '.';
const projectRoot = path.resolve(appRoot, projectInput);
const platform = process.env.PLATFORM;

if (!['android', 'ios'].includes(platform)) throw Error('Native mobile preparation requires android or ios');
if (projectRoot !== appRoot && !projectRoot.startsWith(appRoot + path.sep)) throw Error('PROJECT_PATH escapes the app checkout');
if (!fs.existsSync(projectRoot)) throw Error(`Native mobile project directory not found: ${projectInput}`);

const run = (command, args, cwd = projectRoot) => execFileSync(command, args, { cwd, stdio: 'inherit' });

if (platform === 'android') {
  const wrapper = path.join(projectRoot, 'gradlew');
  if (!fs.existsSync(wrapper)) throw Error('Android native project requires a committed Gradle wrapper');
  if (!['settings.gradle', 'settings.gradle.kts'].some(file => fs.existsSync(path.join(projectRoot, file)))) {
    throw Error('Android native project requires settings.gradle or settings.gradle.kts');
  }
  fs.chmodSync(wrapper, 0o755);
  run('./gradlew', ['--version']);
} else {
  const entries = fs.readdirSync(projectRoot);
  const hasXcodeProject = entries.some(file => file.endsWith('.xcodeproj') || file.endsWith('.xcworkspace'));
  const hasPackage = fs.existsSync(path.join(projectRoot, 'Package.swift'));
  if (!hasXcodeProject && !hasPackage) throw Error('iOS native project requires an Xcode project/workspace or Package.swift');

  if (fs.existsSync(path.join(projectRoot, 'Podfile'))) {
    if (fs.existsSync(path.join(projectRoot, 'Gemfile'))) {
      run('bundle', ['install']);
      run('bundle', ['exec', 'pod', 'install']);
    } else run('pod', ['install']);
  }
  if (hasPackage) run('swift', ['package', 'resolve']);
}

console.log(`Prepared native ${platform} project at ${projectInput}`);
