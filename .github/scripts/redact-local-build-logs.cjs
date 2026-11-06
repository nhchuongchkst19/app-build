'use strict';
const readline = require('node:readline');
// EAS local-build failures can echo an encoded job containing signing material.
// Keep it out of public Actions logs before GitHub's secret masking runs.
function redact(line) {
  return line
    .replace(/[A-Za-z0-9+/_=-]{300,}/g, '[redacted encoded build payload]')
    .replace(/(["']?(?:password|privateKey|dataBase64)["']?\s*[:=]\s*)["'][^"']*["']/gi, '$1"[redacted]"');
}
if (require.main === module) {
  readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
    .on('line', line => process.stdout.write(redact(line) + '\n'));
}
module.exports = { redact };
