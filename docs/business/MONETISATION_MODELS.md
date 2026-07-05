# Monetisation Models

EBYS has multiple revenue streams. They are complements, not alternatives — each one is more powerful when the others exist.

---

## 1. Hardware — EBYS-A1

A physical instrument built for DJs. The AI deck as a hardware device.

**Who buys it:** DJs who want the full EBYS experience without maintaining a Python stack. The hardware comes pre-configured — plug in, connect library, perform.

**Economics:** hardware margin is the cleanest revenue. One transaction, no recurring relationship needed. The brand does the selling.

**Status:** planned. The current software deck is the proof of concept. The A1 is the packaged product that follows.

---

## 2. Stripe Connect — Tipping (In Progress)

The tipping protocol uses Stripe Connect to send dollars to DJs and artists. The split equation runs, the amounts are calculated, and a Stripe transfer is initiated to each connected account.

**Current blocker:** DJs and artists don't have connected Stripe accounts yet. The split calculates correctly, but transfers fail at the Stripe step for missing account IDs.

**Next step:** build the DJ profile page with Stripe Connect onboarding flow. When a DJ connects their Stripe account, transfers start working immediately for all future (and queued) payouts.

---

## 3. The Nag Screen

The software is free. The nag screen is a soft monetisation layer for solo users who want to remove the EBYS credit overlay.

**Mechanic:** when EBYS is running in "free" mode, a small overlay appears during playback (subtly branded, not intrusive). DJs performing publicly see it. Removing it costs a small annual fee — no subscription tiers, no feature lockout, just the option to perform without the brand visible.

**Why it works:** it only activates when EBYS is on. DJs who perform see it and have an incentive to pay. Listeners on the web radio may also notice the overlay. It's a soft incentive that scales with usage.

**Status:** planned. Not implemented.

---

## 4. Merch

The EBYS brand is strong enough to wear. The spider, the visual language of the deck — these have an identity that translates to objects.

**Who buys it:** early community members, DJs, fans of the Montreal scene, people who want to signal something about their relationship to AI and music.

**Economics:** low overhead, high margin. Drop-ship on demand. No inventory risk.

**Status:** brand exists. Store not yet built.

---

## The Revenue Stack View

```
Foundation (enables everything else):
→ Tipping protocol + Stripe Connect

Scales with usage:
→ Hardware (A1)
→ Nag screen removal

Scales with brand:
→ Merch
```

None of these require the user to think about money at the moment of use. The listener tips a set. The artist receives a notification. The rest is automatic.
