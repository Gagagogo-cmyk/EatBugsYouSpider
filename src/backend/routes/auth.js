const express = require('express')
const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const crypto  = require('crypto')
const { createUser, findUserByUsername, findUserByLogin, setResetToken, findUserByResetHash, setPasswordAndClearReset } = require('../db/queries')
const { sendMail } = require('../mailer')

const router = express.Router()

const JWT_SECRET = process.env.JWT_SECRET || 'gnumbat_dev_secret'

// POST /auth/register
// Body: { username, password, email, is_dj, is_artist }
router.post('/register', async (req, res) => {
  const { username, password, email, is_dj = false, is_artist = false } = req.body
  if (!username || !password) return res.status(400).json({ error: 'username and password required' })
  // an email is required: it's where "forgot password" sends the reset link
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'a valid email address is required' })
  if (String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' })

  try {
    const hash = await bcrypt.hash(password, 10)
    const user = await createUser({ username, passwordHash: hash, email, is_dj, is_artist })
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' })
    res.json({ user: { id: user.id, username: user.username, is_dj: user.is_dj, is_artist: user.is_artist }, token })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'username or email already taken' })
    res.status(500).json({ error: err.message })
  }
})

// POST /auth/login
// Body: { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'username and password required' })

  try {
    const user = await findUserByUsername(username)
    if (!user) return res.status(401).json({ error: 'invalid credentials' })

    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) return res.status(401).json({ error: 'invalid credentials' })

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' })
    res.json({ user: { id: user.id, username: user.username, is_dj: user.is_dj, is_artist: user.is_artist }, token })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /auth/forgot
// Body: { login }  -- a username or an email address
// Emails a one-hour reset link to the address the account was registered with. Always answers
// the same way, whether or not the account exists, so it can't be used to discover accounts.
router.post('/forgot', async (req, res) => {
  const login = String(req.body?.login || '').trim()
  const answer = { ok: true, message: 'if that account exists, a reset link was sent to its email address' }
  if (!login) return res.status(400).json({ error: 'enter your username or email first' })
  try {
    const user = await findUserByLogin(login)
    if (user && user.email) {
      const token = crypto.randomBytes(32).toString('hex')
      const hash  = crypto.createHash('sha256').update(token).digest('hex')
      await setResetToken(user.id, hash, new Date(Date.now() + 60 * 60 * 1000))
      const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
      await sendMail({
        to: user.email,
        subject: 'Gnumbat -- reset your password',
        text: `Yo ${user.username}!\n\nSomeone (hopefully you) asked to reset your Gnumbat password.\n` +
              `Open this link within the next hour to choose a new one:\n\n${base}/reset.html?token=${token}\n\n` +
              `If it wasn't you, ignore this email -- your password stays the same.`,
      })
    }
    res.json(answer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /auth/reset
// Body: { token, password }  -- from the emailed link (public/reset.html)
router.post('/reset', async (req, res) => {
  const { token, password } = req.body || {}
  if (!token || !password) return res.status(400).json({ error: 'token and password required' })
  if (String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' })
  try {
    const hash = crypto.createHash('sha256').update(String(token)).digest('hex')
    const user = await findUserByResetHash(hash)
    if (!user) return res.status(400).json({ error: 'this reset link is invalid or has expired' })
    await setPasswordAndClearReset(user.id, await bcrypt.hash(password, 10))
    res.json({ ok: true, username: user.username })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /auth/me  (protected — requires Authorization: Bearer <token>)
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user })
})

// Middleware: verify JWT
function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'no token' })
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'invalid token' })
  }
}

module.exports = { router, requireAuth }
