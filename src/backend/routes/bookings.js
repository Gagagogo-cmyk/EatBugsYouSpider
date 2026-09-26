'use strict'

// routes/bookings.js -- the panel's compact BOOKING box (src/gui/panel.html,
// #bookingBox, right of the model list): book a model for a show. Public
// like /feedback -- a booking is a request (status 'requested') the model's
// owner confirms out of band; the contact field is how they reach you.

const express = require('express')
const router = express.Router()
const { listBookings, createBooking } = require('../db/queries')

// GET /bookings?model=<ref> -- upcoming bookings (no contact details)
router.get('/', async (req, res) => {
  try {
    const rows = await listBookings(req.query.model ? String(req.query.model) : null)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /bookings
// Body: { modelRef, modelName?, startsAt (ISO), hours, venue, contact }
router.post('/', async (req, res) => {
  const { modelRef, modelName, startsAt, hours, venue, contact } = req.body || {}
  const h = Number(hours)
  const when = new Date(startsAt)
  if (!modelRef) return res.status(400).json({ error: 'pick a model' })
  if (!startsAt || isNaN(when)) return res.status(400).json({ error: 'date and time required' })
  if (when < new Date()) return res.status(400).json({ error: 'that date is in the past' })
  if (!(h > 0 && h <= 24)) return res.status(400).json({ error: 'hours must be between 0 and 24' })
  if (!venue || !String(venue).trim()) return res.status(400).json({ error: 'venue required' })
  if (!contact || !String(contact).trim()) return res.status(400).json({ error: 'contact required' })
  try {
    const out = await createBooking({
      modelRef: String(modelRef).slice(0, 255),
      modelName: modelName ? String(modelName).slice(0, 255) : null,
      startsAt: when.toISOString(),
      hours: Math.round(h * 10) / 10,
      venue: String(venue).trim().slice(0, 255),
      contact: String(contact).trim().slice(0, 255)
    })
    if (out.conflict) return res.status(409).json({ error: 'already booked then', conflict: out.conflict })
    res.status(201).json(out.booking)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
