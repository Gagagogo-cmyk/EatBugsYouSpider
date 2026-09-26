require('dotenv').config()
const express = require('express')
const app = express()

// Stripe webhooks need raw body — must come before express.json()
app.use('/tips/webhook', express.raw({ type: 'application/json' }))
// Artifact publish (POST /network/artifacts) carries raw bytes, not JSON —
// same reason, same fix, same pattern as the webhook above. Harmless on
// the router's other routes (GET has no body).
app.use('/network/artifacts', express.raw({ type: 'application/octet-stream', limit: '500mb' }))
app.use(express.json())
// CORS for the local web panel -- the GUI (src/gui/panel.html) is served from
// the hub on another port (:8080), so its calls to /auth etc. here are
// cross-origin. Only this machine's own pages are allowed in.
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === 'null')) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.static('public'))

const tipsRouter     = require('./routes/tips')
const slicesRouter   = require('./routes/slices')
const accountsRouter = require('./routes/accounts')
const { router: authRouter } = require('./routes/auth')
const networkRouter  = require('./routes/network')
// Consumer app (Radio + Shows + Like/Dislike) -- see
// docs/instrument/CONSUMER_FEEDBACK_PIPELINE.md. Read-only ModelService/
// RadioService plus the single-write FeedbackService; SHOWS/EventService
// stays in the Go event-crawler's own server (src/backend/event-crawler),
// not proxied through here.
const modelsRouter   = require('./routes/models')
const radioRouter    = require('./routes/radio')
const feedbackRouter = require('./routes/feedback')

app.use('/tips',     tipsRouter)
app.use('/slices',   slicesRouter)
app.use('/accounts', accountsRouter)
app.use('/auth',     authRouter)
app.use('/network',  networkRouter)
app.use('/models',   modelsRouter)
app.use('/radio',    radioRouter)
app.use('/feedback', feedbackRouter)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Gnumbat backend running on port ${PORT}`))

// DEV ACCOUNT -- user: "change the ... username for abc and password for 123.
// so its faster to debug". If .env sets GNUMBAT_DEV_ACCOUNT=<username>:<password>,
// that account is created on startup (or its password reset to match), so a
// debug login always works. Remove the line from .env before anyone else uses
// this backend.
if (process.env.GNUMBAT_DEV_ACCOUNT) {
  ;(async () => {
    const raw = process.env.GNUMBAT_DEV_ACCOUNT, i = raw.indexOf(':')
    const username = raw.slice(0, i), password = raw.slice(i + 1)
    if (i < 1 || !password) return console.log('GNUMBAT_DEV_ACCOUNT should look like username:password')
    try {
      const bcrypt = require('bcryptjs')
      const { findUserByUsername, createUser, setPasswordAndClearReset, renameUser } = require('./db/queries')
      const hash = await bcrypt.hash(password, 10)
      let existing = await findUserByUsername(username)
      // GNUMBAT_DEV_ACCOUNT_FROM=<old name>: rename that account instead of
      // making a new one (user: "change my account name from abc to ap3")
      const from = (process.env.GNUMBAT_DEV_ACCOUNT_FROM || '').trim()
      if (!existing && from) {
        const old = await findUserByUsername(from)
        if (old) { await renameUser(old.id, username); existing = await findUserByUsername(username); console.log(`dev account "${from}" renamed to "${username}"`) }
      }
      if (existing) await setPasswordAndClearReset(existing.id, hash)
      else await createUser({ username, passwordHash: hash, email: null, is_dj: false, is_artist: false })
      console.log(`dev account "${username}" ready`)
    } catch (err) {
      console.log('dev account setup failed: ' + err.message)
    }
  })()
}
