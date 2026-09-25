// create-user.js -- make a Gnumbat account straight in the database (same
// bcrypt hashing as POST /auth/register), for when the backend isn't up or you
// just want it done from the terminal. The password is asked for with hidden
// typing, so it never lands in your shell history.
//
//   cd src/backend && node scripts/create-user.js <username> <email>
//   cd src/backend && node scripts/create-user.js <username> --dev
//     --dev: a local debug account -- no email needed, and passwords shorter
//     than 8 characters are allowed (the web/plugin register forms still
//     require 8+; logging in doesn't check length).
require('dotenv').config()
const bcrypt = require('bcryptjs')
const readline = require('readline')
const { createUser } = require('../db/queries')

const args = process.argv.slice(2)
const dev = args.includes('--dev')
const [username, email] = args.filter(a => a !== '--dev')
if (!username || (!email && !dev)) { console.error('usage: node scripts/create-user.js <username> <email>   (or <username> --dev)'); process.exit(1) }

function askHidden(q) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = s => { if (s.startsWith(q)) rl.output.write(q) }   // echo the prompt, not the typing
    rl.question(q, a => { rl.close(); process.stdout.write('\n'); resolve(a) })
  })
}

;(async () => {
  const pw = await askHidden('password: ')
  if (!pw) { console.error('empty password'); process.exit(1) }
  if (pw.length < 8 && !dev) { console.error('password must be at least 8 characters (or use --dev for a debug account)'); process.exit(1) }
  const again = await askHidden('password again: ')
  if (pw !== again) { console.error("passwords don't match"); process.exit(1) }
  try {
    const user = await createUser({ username, passwordHash: await bcrypt.hash(pw, 10), email: email || null, is_dj: false, is_artist: false })
    console.log(`created ${user.username} (id ${user.id}) -- sign in on the panel's bottom line`)
    process.exit(0)
  } catch (err) {
    console.error(err.code === '23505' ? 'that username or email is already taken' : err.message)
    process.exit(1)
  }
})()
