const fs = require('node:fs');
const path = require('node:path');

const appJsonPath = path.resolve(process.cwd(), 'app.json');

if (!fs.existsSync(appJsonPath)) {
  console.error(`app.json not found at ${appJsonPath}`);
  process.exit(1);
}

const pad = (value) => String(value).padStart(2, '0');
const now = new Date();
const buildNumber = [
  String(now.getFullYear()).replace('202', ''),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  pad(now.getHours()),
  pad(now.getMinutes()),
].join('');

const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

if (!appJson.expo?.ios || !appJson.expo?.android) {
  console.error('app.json must define expo.ios and expo.android');
  process.exit(1);
}

appJson.expo.ios.buildNumber = buildNumber;
appJson.expo.android.versionCode = Number.parseInt(buildNumber, 10);

fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
console.log(`App build version updated to ${buildNumber}`);
