const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const appRoot = path.resolve('app');
const projectInput = process.env.PROJECT_PATH || '.';
const projectRoot = path.resolve(appRoot, projectInput);
const platform = process.env.PLATFORM;
let toolchain = process.env.NATIVE_TOOLCHAIN || 'auto';

if (!['windows', 'macos'].includes(platform)) throw Error('Native desktop preparation requires windows or macos');
if (projectRoot !== appRoot && !projectRoot.startsWith(appRoot + path.sep)) throw Error('PROJECT_PATH escapes the app checkout');
if (!fs.existsSync(projectRoot)) throw Error(`Native desktop project directory not found: ${projectInput}`);

const executable = command => process.platform === 'win32' && ['dotnet', 'nuget'].includes(command) ? `${command}.exe` : command;
const run = (command, args, cwd = projectRoot) => execFileSync(executable(command), args, { cwd, stdio: 'inherit' });
const entries = fs.readdirSync(projectRoot);
const solutions = entries.filter(file => file.endsWith('.sln') || file.endsWith('.slnx'));
const dotnetProjects = entries.filter(file => file.endsWith('.csproj') || file.endsWith('.fsproj'));
const vcProjects = entries.filter(file => file.endsWith('.vcxproj'));
const xcodeProjects = entries.filter(file => file.endsWith('.xcodeproj') || file.endsWith('.xcworkspace'));
const target = solutions[0] || dotnetProjects[0] || vcProjects[0];

if (toolchain === 'auto') {
  if (platform === 'windows') {
    const manifests = entries.some(file => file === 'Package.appxmanifest');
    const projectText = [...dotnetProjects, ...vcProjects].map(file => fs.readFileSync(path.join(projectRoot, file), 'utf8')).join('\n');
    if (manifests || /Microsoft\.WindowsAppSDK|UseWinUI/i.test(projectText)) toolchain = 'winui3';
    else if (dotnetProjects.length || solutions.length) toolchain = 'dotnet';
    else if (vcProjects.length) toolchain = 'msbuild';
    else if (fs.existsSync(path.join(projectRoot, 'CMakeLists.txt'))) toolchain = 'cmake';
  } else {
    if (xcodeProjects.length) toolchain = 'xcode';
    else if (fs.existsSync(path.join(projectRoot, 'Package.swift'))) toolchain = 'swiftpm';
    else if (fs.existsSync(path.join(projectRoot, 'CMakeLists.txt'))) toolchain = 'cmake';
  }
}

if (toolchain === 'winui3' || toolchain === 'msbuild') {
  if (platform !== 'windows' || !target) throw Error(`${toolchain} requires a Windows solution or project`);
  run('msbuild.exe', [target, '/t:Restore', '/p:Configuration=Debug']);
} else if (toolchain === 'dotnet') {
  if (platform !== 'windows' || !target) throw Error('dotnet requires a Windows solution or project');
  run('dotnet', ['restore', target]);
} else if (toolchain === 'xcode') {
  if (platform !== 'macos' || !xcodeProjects.length) throw Error('xcode requires a macOS Xcode project or workspace');
  const item = xcodeProjects[0];
  run('xcodebuild', ['-resolvePackageDependencies', item.endsWith('.xcworkspace') ? '-workspace' : '-project', item]);
} else if (toolchain === 'swiftpm') {
  if (platform !== 'macos' || !fs.existsSync(path.join(projectRoot, 'Package.swift'))) throw Error('swiftpm requires Package.swift on macOS');
  run('swift', ['package', 'resolve']);
} else if (toolchain === 'cmake') {
  if (!fs.existsSync(path.join(projectRoot, 'CMakeLists.txt'))) throw Error('cmake requires CMakeLists.txt');
  run('cmake', ['--version']);
} else {
  throw Error(`Unable to detect a supported native desktop toolchain in ${projectInput}`);
}

console.log(`Prepared native ${platform} project at ${projectInput} with ${toolchain}`);
