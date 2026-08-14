const fs = require('node:fs');
const path = require('node:path');

const projectDirectory = path.resolve(process.cwd(), process.argv[2] || '.');
const appJsonPath = path.join(projectDirectory, 'app.json');
const easJsonPath = path.join(projectDirectory, 'eas.json');
const platform = process.env.BUILD_PLATFORM;

if (!['android', 'ios'].includes(platform)) {
  console.error('BUILD_PLATFORM must be either android or ios');
  process.exit(1);
}

if (!fs.existsSync(appJsonPath)) {
  console.log(`Skipping local version update: app.json not found at ${appJsonPath}`);
  process.exit(0);
}

if (fs.existsSync(easJsonPath)) {
  const easJson = JSON.parse(fs.readFileSync(easJsonPath, 'utf8'));
  if (easJson.cli?.appVersionSource === 'remote') {
    console.log('Skipping local version update: EAS remote app version source is enabled');
    process.exit(0);
  }
}

const runNumber = Number.parseInt(process.env.GITHUB_RUN_NUMBER || '', 10);
const parsedRunAttempt = Number.parseInt(process.env.GITHUB_RUN_ATTEMPT || '1', 10);
const runAttempt = Number.isSafeInteger(parsedRunAttempt) && parsedRunAttempt > 0
  ? parsedRunAttempt
  : 1;
const epoch2020Seconds = Date.UTC(2020, 0, 1) / 1000;
const timeBasedVersion = 1_000_000_000 + Math.floor(Date.now() / 1000 - epoch2020Seconds);
const runBasedVersion = 1_000_000_000 + runNumber * 100 + Math.min(runAttempt, 99);
const generatedVersion = Number.isSafeInteger(runNumber) && runNumber > 0
  ? runBasedVersion
  : timeBasedVersion;
const androidVersionCodeLimit = 2_100_000_000;

const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

if (!appJson.expo?.[platform]) {
  console.error(`app.json must define expo.${platform}`);
  process.exit(1);
}

if (platform === 'ios') {
  const currentBuildNumber = /^\d+$/.test(appJson.expo.ios.buildNumber || '')
    ? Number.parseInt(appJson.expo.ios.buildNumber, 10)
    : 0;
  const buildVersion = Math.max(generatedVersion, currentBuildNumber + 1);
  appJson.expo.ios.buildNumber = String(buildVersion);
  console.log(`ios build version updated to ${buildVersion}`);
} else {
  const currentVersionCode = Number.isInteger(appJson.expo.android.versionCode)
    ? appJson.expo.android.versionCode
    : 0;
  const buildVersion = Math.max(generatedVersion, currentVersionCode + 1);

  if (buildVersion > androidVersionCodeLimit) {
    console.error(`Generated version ${buildVersion} exceeds the Android versionCode limit`);
    process.exit(1);
  }

  appJson.expo.android.versionCode = buildVersion;
  console.log(`android build version updated to ${buildVersion}`);
}

fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
