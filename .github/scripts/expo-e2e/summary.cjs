const fs = require('node:fs');
if (!process.env.GITHUB_STEP_SUMMARY) process.exit(0);
const lines = ['## Expo build/test', '', `Platform: ${process.env.PLATFORM}; mode: ${process.env.MODE}.`, ''];
if (fs.existsSync('binary/manifest.json')) {
  const m = JSON.parse(fs.readFileSync('binary/manifest.json'));
  lines.push(`Binary: ${m.repository}@${m.sourceSha}`, `Binary-producing run: ${m.runId}`, `SHA-256: ${m.sha256}`, '');
}
if (fs.existsSync('results/test-source-sha.txt')) lines.push(`Test source: ${fs.readFileSync('results/test-source-sha.txt', 'utf8').trim()}`, '');
lines.push('See step statuses for build/test outcome; binary availability alone does not mean UI tests passed.', '',
  'Native caches are enabled only for private builder repositories. GitHub-hosted simulators are recreated on every run.', '');
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
