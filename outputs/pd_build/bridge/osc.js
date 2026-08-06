// osc.js — minimal, dependency-free OSC 1.0 message encoder/decoder over
// UDP, for talking to Pd's built-in [oscparse]/[oscformat] + [netreceive
// -u]/[netsend -u] objects (both vanilla, no external Pd library required,
// available since Pd 0.52). No npm packages -- just Node's built-in
// `dgram`, so a bridge script only needs `require("./osc.js")`, nothing
// to `npm install`.
//
// Supports the subset actually needed by this project's bridges: no-arg
// messages (bangs), and float/int32/string arguments. That covers every
// inlet/outlet shape in the 8 js control-logic files (checked their
// outlet() call sites -- none pass anything beyond numbers, strings, or a
// bare "bang").

const dgram = require("dgram");

function pad4(buf) {
  const rem = buf.length % 4;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}

function encodeString(s) {
  const b = Buffer.from(String(s) + "\0", "utf8");
  return pad4(b);
}

// Encodes one OSC message: address pattern + type tag string + args.
// args: array of {type: 'f'|'i'|'s', value}.
function encodeMessage(address, args = []) {
  const addrBuf = encodeString(address);
  let typeTags = ",";
  const argBufs = [];
  for (const a of args) {
    typeTags += a.type;
    if (a.type === "f") {
      const b = Buffer.alloc(4);
      b.writeFloatBE(a.value, 0);
      argBufs.push(b);
    } else if (a.type === "i") {
      const b = Buffer.alloc(4);
      b.writeInt32BE(a.value | 0, 0);
      argBufs.push(b);
    } else if (a.type === "s") {
      argBufs.push(encodeString(a.value));
    } else {
      throw new Error("osc.js: unsupported arg type " + a.type);
    }
  }
  const typeBuf = encodeString(typeTags);
  return Buffer.concat([addrBuf, typeBuf, ...argBufs]);
}

// Decodes one OSC message (no bundle support -- not needed here, Pd's
// oscformat never emits bundles for a single [oscformat]->send).
function decodeMessage(buf) {
  let offset = 0;
  function readString() {
    let end = offset;
    while (buf[end] !== 0) end++;
    const s = buf.toString("utf8", offset, end);
    offset = end + 1;
    offset = Math.ceil(offset / 4) * 4;
    return s;
  }
  const address = readString();
  const typeTags = readString(); // starts with ","
  const args = [];
  for (let i = 1; i < typeTags.length; i++) {
    const t = typeTags[i];
    if (t === "f") {
      args.push(buf.readFloatBE(offset));
      offset += 4;
    } else if (t === "i") {
      args.push(buf.readInt32BE(offset));
      offset += 4;
    } else if (t === "s") {
      args.push(readString());
    }
  }
  return { address, args };
}

// Convenience wrapper: an OSC-over-UDP client bound to one destination
// (Pd's [netreceive -u <port>]) plus an optional local listener (for
// messages Pd sends INTO this bridge via [netsend -u]/[oscformat]).
class OscUdpPort {
  constructor({ sendPort, sendHost = "127.0.0.1", listenPort = null, onMessage = null }) {
    this.sendPort = sendPort;
    this.sendHost = sendHost;
    this.socket = dgram.createSocket("udp4");
    if (listenPort != null) {
      this.socket.bind(listenPort);
    }
    if (onMessage) {
      this.socket.on("message", (msg) => {
        try {
          onMessage(decodeMessage(msg));
        } catch (e) {
          console.error("osc.js: failed to decode incoming message:", e);
        }
      });
    }
  }

  send(address, args = []) {
    const buf = encodeMessage(address, args);
    this.socket.send(buf, this.sendPort, this.sendHost);
  }

  close() {
    this.socket.close();
  }
}

module.exports = { encodeMessage, decodeMessage, OscUdpPort };
