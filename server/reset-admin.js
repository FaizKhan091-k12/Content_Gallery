'use strict';
// Emergency admin password reset when the portal runs on your own PC:  node server/reset-admin.js <username>
// (Uses the same storage settings as the server: local folder, or the cloud bucket set by STORAGE=r2/s3 and its variables.)
// Stop the portal first: a running portal keeps its own copy of the accounts and would overwrite this change.
// On Render, use the ADMIN_RESET_USER / ADMIN_RESET_PASSWORD environment variables instead (see README).

const path = require('path');
const readline = require('readline');
const { JsonStore } = require('./lib/store');
const { createBlobs } = require('./lib/blobs');
const { Auth, passwordProblem } = require('./lib/auth');

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = true;
    rl._writeToOutput = function (s) { if (!this.stdoutMuted || s.includes(question)) this.output.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const store = new JsonStore(createBlobs(process.env, process.env.GP_STORAGE || path.join(__dirname, '..', 'storage')));
  await store.init(['users', 'sessions']);
  const auth = new Auth(store);
  const username = process.argv[2];
  const admins = auth.users().filter((u) => u.role === 'admin');
  if (!username) {
    console.log('Usage: node server/reset-admin.js <admin username>');
    console.log('Admins: ' + (admins.map((u) => u.username).join(', ') || '(none - open /setup in the browser)'));
    process.exit(1);
  }
  const user = auth.findUser(username);
  if (!user) { console.error(`No user "${username}".`); process.exit(1); }

  console.log('Make sure the Game Portal is stopped before continuing.');
  const pw = await ask(`New password for ${user.username}: `);
  const again = await ask('Repeat it: ');
  if (pw !== again) { console.error('Passwords do not match.'); process.exit(1); }
  const problem = passwordProblem(pw);
  if (problem) { console.error(problem); process.exit(1); }
  auth.updateUser(user.id, { password: pw, disabled: false });
  await store.flush();
  console.log(`Password updated for ${user.username}. Start the portal again and sign in.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
