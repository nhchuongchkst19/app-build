// Run as a recoverable worker process; errors must not terminate the session.
const { execFileSync } = require('node:child_process');
execFileSync(process.execPath, ['builder/.github/scripts/expo-e2e/prepare-app.cjs'], { stdio: 'inherit' });
console.log('App dependencies and native project ready. Build via runnerctl exec.');
