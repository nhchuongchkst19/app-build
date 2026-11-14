// EAS local failures can include signing credentials inside an encoded argv payload.
// Filter before anything reaches the public Actions console.
const readline = require("node:readline");
const lines = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
lines.on("line", line => {
  if (line.length > 12000) { console.log("[redacted oversized build payload]"); return; }
  console.log(line.replace(/[A-Za-z0-9+\/_=-]{256,}/g, "[redacted encoded build payload]"));
});
