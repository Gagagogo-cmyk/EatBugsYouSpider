#!/usr/bin/env node
// test_osc_roundtrip.js — the parts of the GUI hub that can be checked
// without a running Pd.
//
// Run: node src/gui/test_osc_roundtrip.js
//
// This project has no test suite (see CLAUDE.md), and every bridge written so
// far carries the same caveat: "not exercised against a live Pd instance."
// That caveat is unavoidable for the patch itself, but it was doing more work
// than it should have been — the OSC framing, the WebSocket handshake, and the
// command whitelist are all pure functions of bytes and can be checked here.
// The leading-slash bug this file's first case covers is exactly the kind of
// thing that survived five bridges precisely because nothing ever ran.

"use strict";

const assert = require("assert");
const { encodeMessage, decodeMessage } = require("../pd/bridge/osc.js");
const { COMMANDS, TELEMETRY, wsAccept, wsFrame } = require("./gui_hub_bridge.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log("  ok    " + name);
  } catch (e) {
    fail++;
    console.log("  FAIL  " + name + "\n        " + e.message);
  }
}

console.log("\nOSC framing");

t("encode/decode round-trips a bare selector (Pd's `start`)", () => {
  const { address, args } = decodeMessage(encodeMessage("/start"));
  assert.strictEqual(address, "start");
  assert.deepStrictEqual(args, []);
});

t("leading slash is stripped so DISPATCH['next'] resolves", () => {
  // THE REGRESSION. Pd's [oscformat] always emits "/next"; every bridge's
  // DISPATCH table keys on the bare "next", transcribed from Max where there
  // is no slash. Before the fix in osc.js this decoded to "/next" and every
  // single inbound command missed its handler.
  const { address, rawAddress } = decodeMessage(encodeMessage("/next", [
    { type: "s", value: "drums" },
  ]));
  assert.strictEqual(address, "next", "address must be dispatchable as-is");
  assert.strictEqual(rawAddress, "/next", "wire form must still be inspectable");
});

t("encode adds the slash when a caller omits it", () => {
  // Send-side mirror: OSC 1.0 requires it and [oscparse] relies on it.
  assert.strictEqual(decodeMessage(encodeMessage("guiCmd")).rawAddress, "/guiCmd");
});

t("float args survive the round trip", () => {
  const { args } = decodeMessage(encodeMessage("/bpm", [{ type: "f", value: 120 }]));
  assert.strictEqual(args.length, 1);
  assert.ok(Math.abs(args[0] - 120) < 1e-4);
});

t("mixed string/float args keep their order", () => {
  const { address, args } = decodeMessage(encodeMessage("/guiCmd", [
    { type: "s", value: "slicer" },
    { type: "s", value: "setWeight" },
    { type: "s", value: "all" },
    { type: "s", value: "C" },
    { type: "f", value: 2 },
  ]));
  assert.strictEqual(address, "guiCmd");
  assert.deepStrictEqual(args.slice(0, 4), ["slicer", "setWeight", "all", "C"]);
  assert.ok(Math.abs(args[4] - 2) < 1e-6);
});

t("a full 64-band spectrum frame fits in one UDP datagram", () => {
  // 20Hz x 5 stems of these go over localhost; if one ever exceeded the path
  // MTU it would fragment and the display would tear under load.
  const bands = [{ type: "s", value: "drums" }];
  for (let i = 0; i < 64; i++) bands.push({ type: "f", value: i / 64 });
  const buf = encodeMessage("/spectrum", bands);
  assert.ok(buf.length < 1472, "datagram is " + buf.length + " bytes");
  assert.strictEqual(decodeMessage(buf).args.length, 65);
});

t("padding is correct for an address whose length is a multiple of 4", () => {
  // encodeString appends a NUL then pads to 4 — the case that silently breaks
  // hand-rolled OSC is a string already aligned, which still needs 4 more.
  const { address, args } = decodeMessage(encodeMessage("/abc", [
    { type: "s", value: "wxyz" },
    { type: "f", value: 1.5 },
  ]));
  assert.strictEqual(address, "abc");
  assert.deepStrictEqual(args, ["wxyz", 1.5]);
});

console.log("\nCommand whitelist");

t("every target the panel can address exists", () => {
  assert.deepStrictEqual(Object.keys(COMMANDS).sort(),
    ["analyze", "patch", "reader", "slicer"]);
});

t("the transport commands the panel's Start button needs are whitelisted", () => {
  for (const sel of ["start", "stop", "next", "buildIndex", "nextNearest"])
    assert.ok(COMMANDS.slicer.has(sel), sel + " missing");
});

t("whitelisted slicer selectors all exist in slicer_bridge's DISPATCH", () => {
  // Read as text rather than required: requiring slicer_bridge.js opens a UDP
  // socket and starts its timers. The DISPATCH table is a flat object literal,
  // so a text scan is exact enough to catch a typo, which is the failure this
  // guards against.
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(
    path.join(__dirname, "../pd/bridge/slicer_bridge.js"), "utf8");
  const body = src.slice(src.indexOf("var DISPATCH = {"));
  const known = new Set(
    (body.slice(0, body.indexOf("\n};")).match(/^\s{4}(\w+):/gm) || [])
      .map((s) => s.trim().replace(":", ""))
  );
  assert.ok(known.size > 40, "parsed only " + known.size + " DISPATCH keys");
  const missing = [...COMMANDS.slicer].filter((s) => !known.has(s));
  assert.deepStrictEqual(missing, [], "not in DISPATCH: " + missing.join(", "));
});

t("whitelisted analyze selectors all exist in analyze_reader_bridge", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(
    path.join(__dirname, "../pd/bridge/analyze_reader_bridge.js"), "utf8");
  const body = src.slice(src.indexOf("DISPATCH = {"));
  const known = new Set(
    (body.slice(0, body.indexOf("\n};")).match(/^\s{2}(\w+):/gm) || [])
      .map((s) => s.trim().replace(":", ""))
  );
  const missing = [...COMMANDS.analyze].filter((s) => !known.has(s));
  assert.deepStrictEqual(missing, [], "not in DISPATCH: " + missing.join(", "));
});

t("whitelisted reader selectors are the ones analyze_reader.pd routes", () => {
  // This is the test that caught the original mistake: readVocals & co. were
  // whitelisted against the Node bridge, which does not handle them. Asserting
  // against the [route] line in the patch itself is the only check that would
  // have noticed, since both files are plausible homes for the name.
  const fs = require("fs");
  const path = require("path");
  const pd = fs.readFileSync(path.join(__dirname, "../pd/analyze_reader.pd"), "utf8");
  const m = pd.match(/route ((?:readVocals)[^;]*);/);
  assert.ok(m, "analyze_reader.pd no longer has the route line this depends on");
  const routed = new Set(m[1].trim().split(/\s+/));
  const missing = [...COMMANDS.reader].filter((s) => !routed.has(s));
  assert.deepStrictEqual(missing, [], "not routed in the patch: " + missing.join(", "));
});

console.log("\nTelemetry shaping");

t("meter frame unpacks to the panel's shape", () => {
  const f = TELEMETRY.meter(["drums", 0.62, 0.54, 0.31, 0.28]);
  assert.deepStrictEqual(f, {
    t: "meter", stem: "drums", peak: [0.62, 0.54], rms: [0.31, 0.28],
  });
});

t("spectrum frame keeps all 64 bands", () => {
  const bands = Array.from({ length: 64 }, (_, i) => i / 64);
  const f = TELEMETRY.spectrum(["vocals", ...bands]);
  assert.strictEqual(f.bands.length, 64);
  assert.strictEqual(f.stem, "vocals");
});

t("loudness frame is named rmsdb, never lufs", () => {
  assert.ok(!("lufs" in TELEMETRY),
    "an unweighted RMS figure must not be published as LUFS");
  assert.strictEqual(TELEMETRY.rmsdb(["master", -8.2]).db, -8.2);
});

t("status frame splits key from args", () => {
  const f = TELEMETRY.status(["play", "vocals", 0, 0.32, 0.58]);
  assert.strictEqual(f.key, "play");
  assert.deepStrictEqual(f.args, ["vocals", 0, 0.32, 0.58]);
});

console.log("\nWebSocket framing");

t("handshake accept matches the RFC 6455 worked example", () => {
  // The example key/accept pair straight out of the RFC, so a broken base64
  // or SHA1 step fails here rather than as a browser refusing to connect.
  assert.strictEqual(wsAccept("dGhlIHNhbXBsZSBub25jZQ=="),
    "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

t("short frame uses a 2-byte header", () => {
  const f = wsFrame("hi");
  assert.strictEqual(f[0], 0x81);   // FIN + text
  assert.strictEqual(f[1], 2);      // unmasked, length 2
  assert.strictEqual(f.length, 4);
});

t("medium frame switches to the 16-bit length", () => {
  const f = wsFrame("x".repeat(200));
  assert.strictEqual(f[1], 126);
  assert.strictEqual(f.readUInt16BE(2), 200);
  assert.strictEqual(f.length, 204);
});

t("large frame switches to the 64-bit length", () => {
  // A 64-band spectrum for 5 stems in one batched frame stays well under
  // this, but the boundary is worth pinning.
  const f = wsFrame("x".repeat(70000));
  assert.strictEqual(f[1], 127);
  assert.strictEqual(f.readUInt32BE(6), 70000);
  assert.strictEqual(f.length, 70010);
});

t("multi-byte characters are framed by byte length, not string length", () => {
  // The track names in this project are full of non-ASCII; a frame sized by
  // .length would truncate and desync the stream for every frame after it.
  const s = "café ☕";
  const f = wsFrame(s);
  assert.strictEqual(f[1], Buffer.byteLength(s, "utf8"));
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
