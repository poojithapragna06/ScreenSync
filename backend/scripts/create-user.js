/* Create (or reset) a dashboard account straight in the database.
 *
 *   cd backend
 *   npm run create-user
 *
 * Uses MONGODB_URI from backend/.env, so pointing that at the deployed
 * database (e.g. MongoDB Atlas) lets you add the first admin of a deployment
 * from your own laptop. If the email already exists, it offers to reset that
 * user's password and role (handy if the admin password is lost).
 */
const path = require('path');
const readline = require('readline');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const User = require('../src/models/User');
const { USER_ROLES } = require('../src/controllers/userController');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Lines typed (or pasted / piped) before the question is asked are queued,
// so answers are never lost while the database is still connecting
const pendingLines = [];
let waitingForLine = null;
let inputClosed = false;
rl.on('line', (line) => {
  if (waitingForLine) {
    const resolve = waitingForLine;
    waitingForLine = null;
    resolve(line);
  } else {
    pendingLines.push(line);
  }
});
rl.on('close', () => {
  inputClosed = true;
  if (waitingForLine) waitingForLine(null);
});

function nextLine() {
  if (pendingLines.length) return Promise.resolve(pendingLines.shift());
  if (inputClosed) return Promise.resolve(null);
  return new Promise((resolve) => {
    waitingForLine = resolve;
  });
}

async function ask(question) {
  process.stdout.write(question);
  const answer = await nextLine();
  if (answer === null) throw new Error('Input ended before all questions were answered.');
  return answer.trim();
}

// Like ask(), but shows * instead of the typed characters
async function askHidden(question) {
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (text) => write(text === '\r\n' || text === '\n' ? text : '*'.repeat(text.length));
  try {
    process.stdout.write(question);
    const answer = await nextLine();
    if (answer === null) throw new Error('Input ended before all questions were answered.');
    if (!process.stdin.isTTY) process.stdout.write('\n');
    return answer;
  } finally {
    rl._writeToOutput = write;
  }
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/screensync';
  console.log('\nScreenSync - add a dashboard user');
  console.log(`Database: ${uri.replace(/\/\/[^@]*@/, '//<user>:<password>@')}\n`);

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);

  const name = await ask('Name: ');
  const email = (await ask('Email: ')).toLowerCase();
  let role = (await ask(`Role (${USER_ROLES.join('/')}) [admin]: `)).toLowerCase() || 'admin';
  if (!USER_ROLES.includes(role)) {
    console.log(`Unknown role "${role}", using admin.`);
    role = 'admin';
  }

  const password = await askHidden('Password (min 6 characters): ');
  const again = await askHidden('Repeat password: ');
  if (password !== again) throw new Error('The passwords do not match.');

  const existing = await User.findOne({ email });
  if (existing) {
    const reset = await ask(`${email} already exists. Reset its password and set role to ${role}? (y/N): `);
    if (reset.toLowerCase() !== 'y') {
      console.log('Nothing changed.');
      return;
    }
    existing.password = password;
    existing.role = role;
    if (name) existing.name = name;
    await existing.save();
    console.log(`\nUpdated ${existing.email} (${existing.role}). They can sign in now.`);
    return;
  }

  const user = await User.create({ name, email, password, role });
  console.log(`\nCreated ${user.email} (${user.role}). They can sign in now.`);
}

main()
  .catch((err) => {
    const details = err.errors ? Object.values(err.errors).map((e) => e.message).join('; ') : err.message;
    console.error(`\nCould not save the user: ${details}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await mongoose.disconnect();
  });
