#!/usr/bin/env node
'use strict';
const path = require('path');
const { createShellbook } = require('../src/server');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: shellbook [folder] [--port 3000] [--host 127.0.0.1]\n\nServes <folder>/README.md with runnable ```shell blocks and a live terminal.');
  process.exit(0);
}
const positional = args.filter((a, i) => !a.startsWith('-') && !['--port', '--host'].includes(args[i - 1]));
const root = path.resolve(positional[0] || process.cwd());
const port = Number(opt('--port', process.env.PORT || 3000));
const host = opt('--host', process.env.HOST || '127.0.0.1');

const sb = createShellbook({ root });
sb.listen(port, host).then(({ url }) => {
  console.log(`shellbook  ${root}\n→ ${url}`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.warn('\n警告：伺服器對外開放，任何能連上的人都能在你的機器上執行指令。');
  }
}).catch((e) => { console.error(e.message); process.exit(1); });

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => sb.close().then(() => process.exit(0)));
