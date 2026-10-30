// EAS local-build failures can include an encoded job carrying signing credentials.
// Keep useful diagnostics, but never print the encoded invocation or raw secret records.
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  if (/"(?:secrets|keystorePassword|keyPassword|certificatePassword)"\s*:/i.test(line)) {
    process.stdout.write('[redacted EAS signing data]\n');
    return;
  }
  const safe = line
    .replace(/(eas-cli-local-build-plugin@\S+\s+)[A-Za-z0-9+/=_-]+/g, '$1[redacted EAS job]')
    .replace(/[A-Za-z0-9+/_=-]{400,}/g, '[redacted encoded payload]');
  process.stdout.write(safe + '\n');
});
