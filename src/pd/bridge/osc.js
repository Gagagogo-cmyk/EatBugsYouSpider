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
  // OSC 1.0 requires the address pattern to begin with "/", and Pd's
  // [oscparse] relies on it to split the address into leading atoms. Adding
  // it here (rather than trusting every call site to remember) is the
  // send-side mirror of the leading-slash normalization in decodeMessage --
  // together they mean callers can use the bare selector in both directions
  // and the wire format stays correct.
  const addr = String(address).charCodeAt(0) === 47 ? String(address) : "/" + address;
  const addrBuf = encodeString(addr);
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
  // Pd's [oscformat] always emits a leading "/" -- it joins its address
  // arguments with "/" and prefixes one, so `set next` on the Pd side goes
  // out as the address "/next". Every bridge in this project dispatches on
  // the bare selector (DISPATCH.next, DISPATCH.buildIndex, ...), because
  // those tables were transcribed from Max's message-name dispatch, where
  // there is no slash. Left as-is that mismatch makes EVERY inbound command
  // miss its handler and log "no handler for '/next'".
  //
  // Normalizing here rather than in each bridge's onMessage fixes all four
  // (slicer, slice_writer, analyze_reader, buffer_manager) at once and keeps
  // the DISPATCH tables reading like the Max originals. `rawAddress` is kept
  // on the returned object so a caller that genuinely wants the wire form
  // (or a multi-segment address) can still see it.
  //
  // NOTE: single-segment addresses only, which is the convention every
  // bridge here already follows deliberately -- see bridge_streamWatcher.pd's
  // comment on why (oscparse splits multi-segment addresses into separate
  // leading atoms, which would need nested [route] stages).
  const rawAddress = readString();
  const address = rawAddress.charCodeAt(0) === 47 ? rawAddress.slice(1) : rawAddress;
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
  return { address, rawAddress, args };
}

// Convenience wrapper: an OSC-over-UDP client bound to one destination
// (Pd's [netreceive -u <port>]) plus an optional local listener (for
// messages Pd sends INTO this bridge via [netsend -u]/[oscformat]).
class OscUdpPort {
  // IPv6, NOT IPv4 -- this is load-bearing and was the reason nothing ever
  // reached the patch.
  //
  // Pd 0.56's [netreceive] binds the IPv6 wildcard on macOS ("pd ... IPv6
  // UDP *:9001" in lsof), and its [netsend]'s "connect localhost" resolves to
  // ::1. These bridges were creating udp4 sockets and sending to 127.0.0.1,
  // so every packet went out over a protocol nothing was listening on. UDP is
  // fire-and-forget: no error on the sending side, no log on the receiving
  // side, both processes reporting success. The streamWatcher bridge would
  // cheerfully log "bang" while the patch sat there having received nothing.
  //
  // A udp6 socket bound to :: is dual-stack on macOS, so it also accepts
  // IPv4-mapped traffic -- this direction works regardless of which family
  // Pd ends up using, whereas udp4 only ever worked if Pd chose IPv4.
  constructor({ sendPort, sendHost = "::1", listenPort = null, onMessage = null }) {
    this.sendPort = sendPort;
    this.sendHost = sendHost;

    // SEND on udp6 to ::1. Pd's [netreceive] binds the IPv6 wildcard on macOS,
    // and this is the direction that is confirmed working end to end (the
    // streamWatcher bang arrives).
    this.socket = dgram.createSocket({ type: "udp6", ipv6Only: false });

    // LISTEN: one dual-stack udp6 socket bound to ::. Verified to receive
    // BOTH IPv6 and IPv4-mapped traffic, so a separate udp4 listener is
    // unnecessary -- and actively harmful, since it collides with this socket
    // for the same port (EADDRINUSE).
    if (listenPort != null) {
      this.socket.bind(listenPort, "::");
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
  }

  send(address, args = []) {
    const buf = encodeMessage(address, args);
    this.socket.send(buf, this.sendPort, this.sendHost);
  }

  close() {
    for (const s of (this.listeners || [])) {
      if (s !== this.socket) { try { s.close(); } catch (e) {} }
    }
    try { this.socket.close(); } catch (e) {}
  }
}

module.exports = { encodeMessage, decodeMessage, OscUdpPort };
