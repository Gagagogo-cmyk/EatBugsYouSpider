# Gnumbat carnet -- Montreal's regional Hypercore

Implements "Within one instance: the regional carnet" from
`docs/platform/NETWORK.md`. This is **stage 1 of 3** -- see that doc for
why this exists and why it's scoped to Montreal's own data only (never
merged across instances/regions).

## What this is

`carnet-daemon.js` watches `src/backend/event-crawler/all_events.json` and
appends every new event it finds into a local, append-only Hypercore
("the carnet") stored under `data/carnet/`. The Go crawler is untouched --
it keeps writing `all_events.json` exactly like it always has; this daemon
just reads it.

Each entry in the carnet is one event, wrapped with an id (a hash of the
fields that identify "this show" -- venue, name, date, time) and an
`appended_at` timestamp, so the carnet is a genuine history of what's been
seen, not just a mirror of the crawler's current snapshot. Re-scraping an
unchanged event never adds a duplicate entry.

## Stage 1 (this): local only, no network

```
cd src/network
npm install
npm start          # runs the daemon, watches all_events.json, appends new events
npm run dump        # prints the last 10 entries in the carnet, doesn't watch
```

On first run it does one full pass over whatever's already in
`all_events.json`, then sits and watches for changes. `Ctrl+C` to stop --
nothing is lost, `data/carnet/seen.json` remembers what's already been
appended, and `data/carnet/store/` is the actual Hypercore storage (both
gitignored, same as everything else under `data/`).

To check it's actually working: `npm run dump` after it's had a chance to
do its first pass. The startup log line also prints the carnet's public
key (`carnet ready -- public key <hex>`) -- that's the value that goes in
the network registry's per-instance listing once stage 2 exists, so anyone
else can find and mirror this exact carnet.

## What's not built yet

**Stage 2 -- replication.** Add `hyperswarm`, join the carnet's discovery
key, replicate on connection. Proves a second machine (a friend's laptop,
a second machine of your own) can hold a real live copy, not just read
about the idea. Nothing in stage 1 needs to change for this -- it's
additive.

**Stage 3 -- multiple contributors.** Only once more than one person is
actually contributing Montreal data: `autobase` to merge multiple
contributors' own carnets into one Montreal-scoped view, materialized back
out to a local file in this same shape.

## Why Node, when the crawler is Go

Hypercore/Corestore/Hyperswarm/Autobase are a JS-first stack (Holepunch);
there's no mature Go implementation to call directly from
`event-crawler`. Running this as a separate small watcher daemon (same
shape as `watch_demucs.py` watching `data/raw_uploads/`, or
`streamWatcher.js` polling `stream.txt`) means the crawler never needs to
know this exists, in either language.
