import fs from 'node:fs';
import path from 'node:path';
const result = JSON.parse(fs.readFileSync(path.join(process.env.SESSION_STATE_DIR, 'result.json')));
console.log(`## Agent session: ${result.result}\n\nSession: \`${result.sessionId}\`\n\n${result.reason}\n\nCommands: ${result.processes.length}\n`);
