#!/usr/bin/env node
// streamWatcher_bridge.js — Node.js replacement for the Max `js
// streamWatcher.js` object, talking to Pd over OSC/UDP instead of Max's
// inline outlet() calls. Logic is otherwise IDENTICAL to the original:
// polls data/sessions/<current session>/stream.txt every 1s, sends
// /streamWatcher/bang whenever the content changes (including the first
// read -- see the BUG comment in the original file, preserved below).
//
// What changed vs. the original streamWatcher.js, and why:
//   - `patcher.filepath` (Max-only global, no Node equivalent) -> the data
//     directory is passed explicitly via --data-dir (or EBYS_DATA_DIR env
//     var), since a standalone Node process has no patch to ask.
//   - `File` (Max's built-in file I/O object) -> Node's `fs` module.
//   - `Task`/`.schedule(ms)` (Max's js scheduler) -> `setTimeout`.
//   - `post(...)` (Max console) -> `console.log(...)`.
//   - `outlet(0, "bang")` -> `osc.send("/streamWatcher/bang")` over UDP,
//     received on the Pd side by [netreceive -u PORT] -> [oscparse] ->
//     [route /streamWatcher/bang] -> bang, replacing js_streamWatcher_stub.
//
// Run: node streamWatcher_bridge.js --data-dir /path/to/EBYS/data --send-port 9001
// (send-port must match the Pd-side [netreceive -u] port in
// bridge_streamWatcher.pd)
const fs = require("fs");
const path = require("path");
const { OscUdpPort } = require("./osc.js");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const dataDir = args["data-dir"] || process.env.EBYS_DATA_DIR;
const sendPort = parseInt(args["send-port"] || "9001", 10);
const pollMs = parseInt(args["poll-ms"] || "1000", 10);

if (!dataDir) {
  console.error("streamWatcher_bridge: need --data-dir (or EBYS_DATA_DIR env var)");
  process.exit(1);
}

const osc = new OscUdpPort({ sendPort });

function getSessionId() {
  try {
    const id = fs.readFileSync(path.join(dataDir, "current_session.txt"), "utf8").trim();
    return id || "default";
  } catch (e) {
    return "default";
  }
}

function getSessionDataDir() {
  return path.join(dataDir, "sessions", getSessionId());
}

function streamPath() {
  return path.join(getSessionDataDir(), "stream.txt");
}

let lastContent = null;
let lastSessionId = null;

function readFile() {
  try {
    return fs.readFileSync(streamPath(), "utf8");
  } catch (e) {
    return null; // matches original: missing/unreadable file -> null, no bang
  }
}

function poll() {
  const sid = getSessionId();
  if (sid !== lastSessionId) {
    if (lastSessionId !== null) {
      console.log(`streamWatcher: session changed (${lastSessionId} -> ${sid}) -- resetting baseline`);
    }
    lastSessionId = sid;
    lastContent = null;
  }

  const content = readFile();

  if (content !== null) {
    const isFirstRead = lastContent === null;
    if (content !== lastContent) {
      lastContent = content;
      const lines = content.split("\n").filter((l) => l.trim());
      if (lines.length > 0) {
        // Same fix as the original: first-ever read bangs too, not just
        // subsequent changes (see the original file's BUG comment).
        console.log(
          `streamWatcher: ${isFirstRead ? "baseline read" : "change detected"} -> bang (${lines.length} stems)`
        );
        // single-segment OSC address on purpose -- oscparse (Pd's vanilla
        // OSC decoder) splits multi-segment addresses like
        // "/streamWatcher/bang" into separate leading list atoms on "/",
        // which needs nested [route] stages to re-join on the Pd side.
        // Keeping this to one segment lets a single [route streamWatcherBang]
        // handle it directly -- see bridge_streamWatcher.pd for the receiving end.
        osc.send("/streamWatcherBang");
      } else {
        console.log("streamWatcher: stream.txt empty -- skipping bang");
      }
    }
  }

  setTimeout(poll, pollMs);
}

console.log(`streamWatcher_bridge: watching ${dataDir}, sending OSC to 127.0.0.1:${sendPort}`);
setTimeout(poll, 300); // same 300ms startup delay as the original
