#!/usr/bin/env node
// test_hub_e2e.js — drives the real hub with a real WebSocket client and a
// fake Pd, end to end, over real sockets.
//
// Run: node src/gui/test_hub_e2e.js
//
// Everything in this chain except Pd itself is exercised here: the HTTP
// server, the WebSocket handshake and framing, the command whitelist, the OSC
// encode/decode, and the telemetry shaping. "Fake Pd" is a UDP socket bound to
// the port bridge_guiHub.pd's [netreceive] would own, decoding with the same
// osc.js the bridges use — so what it asserts about the bytes on the wire is
// exactly what Pd will see.
//
// What this canNOT cover, and what a live smoke test still has to: whether
// bridge_guiHub.pd's [route] chain and stem_telemetry~.pd's objects behave as
// written inside a running Pd. Those are code review only. The first thing to
// check there is [array get] — see stem_telemetry~.pd's own note.

"use strict";

const http = require("http");
const dgram = require("dgram");
const crypto = require("crypto");
const assert = require("assert");
const path = require("path");
const { decodeMessage, encodeMessage } = require("../pd/bridge/osc.js");

// Ports offset from the real ones so a running instrument is never disturbed.
const HTTP_PORT = 18080, TO_PD = 19010, FROM_PD = 19011;

let pass = 0, fail = 0;
function ok(name) { pass++; console.log("  ok    " + name); }
function bad(name, e) { fail++; console.log("  FAIL  " + name + "\n        " + e); }

// ── a minimal WebSocket client (client frames MUST be masked) ─────────────
function wsConnect(port, onMessage) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const req = http.request({
      port, host: "127.0.0.1", path: "/",
      headers: {
        Connection: "Upgrade", Upgrade: "websocket",
        "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13",
      },
    });
    // `head` is the third argument for a reason: the hub sends its `hello`
    // frame the instant it finishes the handshake, so those bytes usually
    // arrive in the SAME packet as the response headers, and Node hands them
    // over here rather than through 'data'. Dropping it loses the first frame
    // every time — which looks exactly like the hub failing to greet.
    req.on("upgrade", (res, socket, head) => {
      let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      const pump = () => {
        for (;;) {
          if (buf.length < 2) return;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(6); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.slice(off, off + len).toString("utf8");
          buf = buf.slice(off + len);
          if ((buf[0] & 0x0f) !== 0x8) onMessage(payload);
        }
      };
      socket.on("data", (c) => { buf = Buffer.concat([buf, c]); pump(); });
      pump(); // drain whatever came in with the handshake
      resolve({
        send(obj) {
          const data = Buffer.from(JSON.stringify(obj), "utf8");
          const mask = crypto.randomBytes(4);
          let header;
          if (data.length < 126) {
            header = Buffer.alloc(2); header[1] = 0x80 | data.length;
          } else {
            header = Buffer.alloc(4); header[1] = 0x80 | 126;
            header.writeUInt16BE(data.length, 2);
          }
          header[0] = 0x81;
          const masked = Buffer.from(data);
          for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
          socket.write(Buffer.concat([header, mask, masked]));
        },
        close() { socket.destroy(); },
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function waitFor(pred, ms, what) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const v = pred();
      if (v) return resolve(v);
      if (Date.now() - t0 > ms) return reject(new Error("timed out waiting for " + what));
      setTimeout(poll, 10);
    })();
  });
}

(async function main() {
  console.log("\nEnd to end: panel <-> hub <-> (fake) Pd\n");

  // Fake Pd: listens where [netreceive -u -b 9010] would, and sends from
  // where [netsend -u -b] would.
  const pdIn = dgram.createSocket("udp4");
  const pdOut = dgram.createSocket("udp4");
  const fromHub = [];
  pdIn.on("message", (b) => fromHub.push(decodeMessage(b)));
  await new Promise((r) => pdIn.bind(TO_PD, "127.0.0.1", r));

  // The hub, in-process, on the test ports.
  process.argv = [process.argv[0], "hub",
    "--http-port", String(HTTP_PORT),
    "--send-port", String(TO_PD),
    "--recv-port", String(FROM_PD),
    "--panel-dir", path.join(__dirname)];
  delete require.cache[require.resolve("./gui_hub_bridge.js")];
  require("./gui_hub_bridge.js").start();
  await new Promise((r) => setTimeout(r, 150));

  const fromPanel = [];
  const panel = await wsConnect(HTTP_PORT, (t) => fromPanel.push(JSON.parse(t)));

  try {
    const hello = await waitFor(
      () => fromPanel.find((m) => m.t === "hello"), 1000, "hello frame");
    assert.ok(hello.commands.slicer.includes("next"));
    assert.ok(hello.commands.reader.includes("readVocals"));
    ok("hub greets the panel with the command whitelist");
  } catch (e) { bad("hub greets the panel with the command whitelist", e.message); }

  try {
    panel.send({ t: "cmd", target: "slicer", sel: "next", args: ["drums"] });
    const m = await waitFor(
      () => fromHub.find((x) => x.address === "guiCmd"), 1000, "OSC at fake Pd");
    assert.strictEqual(m.rawAddress, "/guiCmd", "Pd needs the leading slash");
    assert.deepStrictEqual(m.args, ["slicer", "next", "drums"]);
    ok("panel command arrives at Pd as /guiCmd slicer next drums");
  } catch (e) { bad("panel command arrives at Pd", e.message); }

  try {
    fromHub.length = 0;
    panel.send({ t: "cmd", target: "patch", sel: "bpm", args: [128] });
    const m = await waitFor(() => fromHub[0], 1000, "bpm command");
    assert.strictEqual(m.args[0], "patch");
    assert.strictEqual(m.args[1], "bpm");
    // Numbers must survive as OSC floats: [route]'s dynamic-send box needs a
    // float here, and a stringified "128" would set the receive to a symbol.
    assert.ok(Math.abs(m.args[2] - 128) < 1e-4 && typeof m.args[2] === "number");
    ok("a numeric argument reaches Pd as a float, not a symbol");
  } catch (e) { bad("a numeric argument reaches Pd as a float", e.message); }

  try {
    fromHub.length = 0;
    fromPanel.length = 0;
    panel.send({ t: "cmd", target: "slicer", sel: "definitelyNotACommand", args: [] });
    const err = await waitFor(
      () => fromPanel.find((m) => m.t === "error"), 1000, "rejection");
    assert.ok(/not whitelisted/.test(err.msg));
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(fromHub.length, 0, "a rejected command must not reach Pd");
    ok("an unknown selector is rejected with a named error, not forwarded");
  } catch (e) { bad("an unknown selector is rejected", e.message); }

  try {
    fromPanel.length = 0;
    // Fake Pd reports a meter, exactly as stem_telemetry~ -> packOSC would.
    pdOut.send(encodeMessage("/meter", [
      { type: "s", value: "drums" },
      { type: "f", value: 0.62 }, { type: "f", value: 0.54 },
      { type: "f", value: 0.31 }, { type: "f", value: 0.28 },
    ]), FROM_PD, "127.0.0.1");
    const m = await waitFor(
      () => fromPanel.find((x) => x.t === "meter"), 1000, "meter at panel");
    assert.strictEqual(m.stem, "drums");
    assert.ok(Math.abs(m.peak[0] - 0.62) < 1e-4);
    assert.ok(Math.abs(m.rms[1] - 0.28) < 1e-4);
    ok("telemetry from Pd reaches the panel as a shaped JSON frame");
  } catch (e) { bad("telemetry from Pd reaches the panel", e.message); }

  try {
    fromPanel.length = 0;
    const bands = [{ type: "s", value: "vocals" }];
    for (let i = 0; i < 64; i++) bands.push({ type: "f", value: (i % 8) / 8 });
    pdOut.send(encodeMessage("/spectrum", bands), FROM_PD, "127.0.0.1");
    const m = await waitFor(
      () => fromPanel.find((x) => x.t === "spectrum"), 1000, "spectrum at panel");
    assert.strictEqual(m.bands.length, 64, "got " + m.bands.length + " bands");
    ok("a full 64-band spectrum survives the whole chain intact");
  } catch (e) { bad("a full 64-band spectrum survives", e.message); }

  try {
    fromPanel.length = 0;
    pdOut.send(encodeMessage("/status", [
      { type: "s", value: "play" }, { type: "s", value: "vocals" },
      { type: "f", value: 0 }, { type: "f", value: 0.32 },
      { type: "f", value: 0.58 }, { type: "f", value: 1 },
      { type: "f", value: 12000 },
    ]), FROM_PD, "127.0.0.1");
    const m = await waitFor(
      () => fromPanel.find((x) => x.t === "status"), 1000, "status at panel");
    assert.strictEqual(m.key, "play");
    assert.strictEqual(m.args[0], "vocals");
    // The two numbers gnumbat-live.js reads as the segment bracket.
    assert.ok(Math.abs(m.args[2] - 0.32) < 1e-4);
    assert.ok(Math.abs(m.args[3] - 0.58) < 1e-4);
    ok("a slicer playback trigger arrives shaped for the waveform overlay");
  } catch (e) { bad("a slicer playback trigger arrives shaped", e.message); }

  try {
    const body = await new Promise((resolve, reject) => {
      http.get({ port: HTTP_PORT, host: "127.0.0.1", path: "/panel.html" }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ code: res.statusCode, d }));
      }).on("error", reject);
    });
    assert.strictEqual(body.code, 200);
    assert.ok(body.d.includes("gnumbat-link.js"), "panel must load the transport");
    assert.ok(body.d.includes("gnumbat-live.js"), "panel must load the bindings");
    ok("the hub serves panel.html with both scripts wired in");
  } catch (e) { bad("the hub serves panel.html", e.message); }

  try {
    const res = await new Promise((resolve, reject) => {
      http.get({ port: HTTP_PORT, host: "127.0.0.1",
                 path: "/../pd/bridge/slicer_bridge.js" }, (r) => resolve(r))
        .on("error", reject);
    });
    // Node normalizes ".." in the request path, so this specific attempt comes
    // back 404 rather than 403 — either way the file must not be served.
    assert.ok(res.statusCode === 403 || res.statusCode === 404,
      "got " + res.statusCode);
    ok("a path-traversal request cannot escape the panel directory");
  } catch (e) { bad("a path-traversal request cannot escape", e.message); }

  panel.close();
  pdIn.close();
  pdOut.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("harness crashed:", e);
  process.exit(1);
});
