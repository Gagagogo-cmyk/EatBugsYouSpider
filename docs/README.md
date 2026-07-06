# © Eat Bugs You Spider! 

Vibe DJing instrument / Indie Webradio
Montréal, 2023 — en cours
Licence : AGPL-3.0

---

## platform/

The EBYS platform — what it is, how all the pieces fit, what's been built and what's next.

| File | What it covers |
|------|----------------|
| `OVERVIEW.md` | Everything in one page — instrument, radio, protocol, file map |
| `PLATFORM.md` | Platform description, radio modes, what's built, what's next |
| `EBYS_SYSTEM.md` | Website + radio architecture (French), temperature trigger, UI skin system |
| `WEBSITE.md` | Website: event calendar, radio, artist directory, mixer console, spider |
| `STATEMENT.md` | Brand statement |

---

## protocol/

The tipping protocol and split equation.

| File | What it covers |
|------|----------------|
| `TIPPING_PROTOCOL.md` | Three precision levels (web, venue+EBYS, venue-only) |
| `SPLIT_EQUATION.md` | L0–L4 split levels |

---

## instrument/

The EBYS instrument — architecture, engine, AI, training, hardware.

| File | What it covers |
|------|----------------|
| `ARCHITECTURE.md` | **Full system reference** — all stages, every file, who talks to whom |
| `TECH_STACK.md` | Software stack: HTDemucs, madmom, Essentia, FluCoMa, Llama, PD |
| `CRICKET.md` | Cricket AI: descriptors, all commands, vocabulary translations, :bake |
| `DEFAULTS.md` | Factory defaults — all parameters, commands, notes |
| `PLAYBACK.md` | Playback engine — buffers, slot/track architecture, M/S, FX, VU |
| `LINK.md` | EBYS LINK protocol — multi-unit sync, missile switch, ▲⬢▼ |
| `BAKE.md` | Training loop — :bake start/end, trajectory learning, snapshot lock |
| `MOMENTUM.md` | add_tension.py — tension field computation, bar-level slopes |
| `STRETCH_WIRING.md` | Time-stretch wiring guide for Max patch |
| `ILM.md` | EBYS as an Intonation Language Model |
| `CHANGELOG.md` | Version history: 0.1.0 → 0.1.7 |

---

## business/

Revenue models and a speculative future layer.

| File | What it covers |
|------|----------------|
| `MONETISATION_MODELS.md` | Active revenue models: hardware, merch, nag screen, Stripe Connect |
| `SPECULATIVE.md` | Exploratory concept: cricket protein powder company, CRKT token economy |

---

## Licence

Copyleft © 2026 Eat Bugs You Spider!

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

See <https://www.gnu.org/licenses/> for details.
