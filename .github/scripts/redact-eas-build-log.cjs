// EAS local-worker errors can echo a base64 job containing signing credentials.
const readline = require('node:readline');
const lines = readline.createInterface({input:process.stdin, crlfDelay:Infinity});
lines.on('line', line => {
  if (line.includes('eas-cli-local-build-plugin') && /[A-Za-z0-9+/=]{512,}/.test(line)) {
    console.log('EAS local worker failed; encoded signing payload omitted. See preceding phase errors.');
  } else console.log(line);
});
