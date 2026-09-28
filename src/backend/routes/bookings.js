'use strict'

// routes/bookings.js -- the panel's compact BOOKING box (src/gui/panel.html,
// #bookingBox, right of the model list). Every model is its own 24/7
// timeline: the model plays by itself, except during a slot a DJ has booked
// on it -- then the model stops and the DJ plays. Each model is booked
// separately. Booking needs a DJ account (the panel's login); reading the
// schedule doesn't.

const express = require('express')
const router = express.Router()
const { listBookings, getCurrentBooking, createBooking, cancelBooking, challengeBooking, confirmBooking, myBookings, upcomingBookings, setBookingLive } = require('../db/queries')
const { requireAuth } = require('./auth')

// GET /bookings?model=<ref> -- current + upcoming slots
router.get('/', async (req, res) => {
  try {
    res.json(await listBookings(req.query.model ? String(req.query.model) : null))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /bookings/now?model=<ref> -- who's on the model right now:
// { onAir: 'dj', booking } while a slot runs, else { onAir: 'model', booking: null }
router.get('/now', async (req, res) => {
  if (!req.query.model) return res.status(400).json({ error: 'model required' })
  try {
    const booking = await getCurrentBooking(String(req.query.model))
    res.json({ onAir: booking ? 'dj' : 'model', booking })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /bookings/mine  (logged-in DJ) -- your slots, and the ones you challenge;
// a slot of yours someone challenged carries challenger_name + challenge_deadline
router.get('/mine', requireAuth, async (req, res) => {
  try {
    res.json(await myBookings(req.user.userId))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /bookings/upcoming -- every upcoming slot on every model (the show
// page's CRKT cards, src/backend/event-crawler)
router.get('/upcoming', async (req, res) => {
  try {
    res.json(await upcomingBookings())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /bookings  (logged-in DJ)
// Body: { modelRef, modelName?, startsAt (ISO), hours }
router.post('/', requireAuth, async (req, res) => {
  const { modelRef, modelName, startsAt, hours } = req.body || {}
  const h = Number(hours)
  const when = new Date(startsAt)
  if (!modelRef) return res.status(400).json({ error: 'pick a model' })
  if (!startsAt || isNaN(when)) return res.status(400).json({ error: 'date and time required' })
  if (when < new Date(Date.now() - 60 * 1000)) return res.status(400).json({ error: 'that time has passed' })
  if (!(h > 0 && h <= 24)) return res.status(400).json({ error: 'hours must be between 0 and 24' })
  try {
    const out = await createBooking({
      modelRef: String(modelRef).slice(0, 255),
      modelName: modelName ? String(modelName).slice(0, 255) : null,
      djId: req.user.userId,
      djName: String(req.user.username || 'dj').slice(0, 255),
      startsAt: when.toISOString(),
      hours: Math.round(h * 10) / 10
    })
    if (out.conflict) return res.status(409).json({ error: 'booked by ' + out.conflict.dj_name, conflict: out.conflict, canChallenge: out.conflict.dj_id !== req.user.userId && !out.conflict.challenger_name && new Date(out.conflict.starts_at) > new Date() })
    res.status(201).json(out.booking)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /bookings/:id/challenge  (another logged-in DJ) -- "someone booked it":
// ask for it. The holder has until challenge_deadline to confirm, or the slot
// becomes the challenger's.
router.post('/:id/challenge', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' })
  try {
    const out = await challengeBooking(id, req.user.userId, String(req.user.username || 'dj').slice(0, 255))
    if (out.error) return res.status(out.code || 400).json({ error: out.error })
    res.json(out.booking)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /bookings/:id/confirm  (the holder) -- "still using it": dismisses the challenge
router.post('/:id/confirm', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' })
  try {
    const row = await confirmBooking(id, req.user.userId)
    if (!row) return res.status(404).json({ error: 'not your slot' })
    res.json(row)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /bookings/:id/live  { live: true|false }  (the holder, during the slot)
// -- going on air opens a 'web' radio session for them at CRKT (the model
// stops, the dj plays); false ends it
router.post('/:id/live', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' })
  try {
    const out = await setBookingLive(id, req.user.userId, req.body && req.body.live !== false)
    if (out.error) return res.status(out.code || 400).json({ error: out.error })
    res.json(out.booking)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /bookings/:id/cancel  (the DJ who booked it)
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' })
  try {
    const row = await cancelBooking(id, req.user.userId)
    if (!row) return res.status(404).json({ error: 'not your booking' })
    res.json(row)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
