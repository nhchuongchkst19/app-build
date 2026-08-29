const fs = require('node:fs');
const path = require('node:path');

const projectDirectory = path.resolve(process.cwd(), process.argv[2] || '.');
const appJsonPath = path.join(projectDirectory, 'app.json');

if (!fs.existsSync(appJsonPath)) {
  console.log(`Skipping iOS development HTTP configuration: app.json not found at ${appJsonPath}`);
  process.exit(0);
}

let appJson;

try {
  appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
} catch (error) {
  console.error(`Unable to parse ${appJsonPath}: ${error.message}`);
  process.exit(1);
}

function ensureObject(parent, key, propertyPath) {
  if (parent[key] === undefined) {
    parent[key] = {};
  } else if (
    parent[key] === null
    || typeof parent[key] !== 'object'
    || Array.isArray(parent[key])
  ) {
    console.error(`${propertyPath} must be an object in ${appJsonPath}`);
    process.exit(1);
  }

  return parent[key];
}

if (appJson === null || typeof appJson !== 'object' || Array.isArray(appJson)) {
  console.error(`${appJsonPath} must contain a JSON object`);
  process.exit(1);
}

const expo = ensureObject(appJson, 'expo', 'expo');
const ios = ensureObject(expo, 'ios', 'expo.ios');
const infoPlist = ensureObject(ios, 'infoPlist', 'expo.ios.infoPlist');
const appTransportSecurity = ensureObject(
  infoPlist,
  'NSAppTransportSecurity',
  'expo.ios.infoPlist.NSAppTransportSecurity',
);

if (appTransportSecurity.NSAllowsArbitraryLoads === true) {
  console.log('iOS development HTTP is already configured in app.json');
  process.exit(0);
}

appTransportSecurity.NSAllowsArbitraryLoads = true;
fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
console.log('Enabled unrestricted HTTP requests for the iOS development build');
