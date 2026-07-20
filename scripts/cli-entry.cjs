#!/usr/bin/env node
'use strict';

var major = parseInt(process.versions.node.split('.')[0], 10);
function terminalSafeText(s) {
  return String(s)
    .replace(/(?:\x1b\][\s\S]*?(?:\x07|\x1b\\))|(?:\x9d[\s\S]*?(?:\x07|\x9c))|(?:\x1b[PX^_][\s\S]*?\x1b\\)|(?:[\x90\x98\x9e\x9f][\s\S]*?\x9c)|(?:\x1b\[[0-?]*[ -/]*[@-~])|(?:\x9b[0-?]*[ -/]*[@-~])|(?:\x1b[@-Z\\-_])/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

if (major < 22) {
  process.stderr.write(
    '\ntorlnk requires Node.js v22 or later.\n' +
    'You are running v' + process.versions.node + '.\n\n' +
    'Upgrade:  https://nodejs.org\n' +
    'With nvm: nvm install 22 && nvm use 22\n\n'
  );
  process.exit(1);
}

import('./index.js').catch(function (err) {
  process.stderr.write(terminalSafeText((err && err.message) || err) + '\n');
  process.exit(1);
});
