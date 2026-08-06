// cricket.js — EBYS × Ollama Bridge
// Max node.script object
//
// ── Inlet messages (from Max) ────────────────────────────────────────────────
//   ask <text>     — send a natural language instruction to Cricket
//   model <name>   — switch Ollama model (default: cricket)
//   system <text>  — override system prompt at runtime
//
// ── Outlet (to Max route object) ────────────────────────────────────────────
//   setSegmentBars <n>
//   setStayProb <v>
//   setQuantize <0|1>
//   setFallbackBPM <n>
//   setWeight <C|E|F|P> <v>
//   setTrackWeight <track> <v>
//   start / stop
//   selectSegment <track>
//
//   NOT sent to the outlet: generate <stem>. slicer.js has no handler for
//   it — it's intercepted below and routed to the generative side instead
//   (queueGeneration()), never reaches Max's route object.
//
// ── Generation intent bridge (data/current/cricket_intent.json) ─────────────
// Every command batch Cricket sends to the remix engine is ALSO written to
// disk as a plain JSON snapshot. This is what lets the generative side
// (AGENT_MODE 'generate' stems, Stable Audio 3 + User LoRA) react to the
// same instruction the remix engine just acted on, without cricket.js
// knowing anything about Stable Audio 3, LoRA, or GPUs — see
// src/demucs/cricket_bridge.py, which reads this file and turns the raw
// command list into a caption fragment + generate_agent.py invocation.
//
// ── generate <stem> — Cricket-triggered generation ───────────────────────────
// When Cricket itself decides a stem needs genuinely new material (not just
// a different selection of what's already in the catalog), it can emit
// `generate <stem>` as a command line, same as any other. cricket.js
// intercepts that one specifically and spawns cricket_bridge.py as a
// DETACHED background process — never inline with Cricket's response, never
// blocking Max's thread, same spawn()-not-fork() pattern ws_server.js
// already uses for tsne_worker.js (fork() corrupts N4M's own IPC channel).
// Gated behind ENABLE_GENERATION below, OFF by default — Cricket deciding
// on its own to kick off a slow, GPU-bound job is a real cost/time
// tradeoff, not something that should be live just because the plumbing
// exists. Turn it on once you have a trained LoRA and a working Stable
// Audio 3 install (see docs/instrument/USER_LORA.md).

const Max       = require('max-api');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const { spawn } = require('child_process');

// ── Config ────────────────────────────────────────────────────────────────────
var OLLAMA_HOST  = 'localhost';
var OLLAMA_PORT  = 11434;
var MODEL_NAME   = 'llama3.1:latest';

// Safety gate for Cricket-triggered generation — see the header comment
// above. Flip to true only once STABLE_AUDIO_3_DIR below actually points
// at a working `uv sync`'d Stable Audio 3 clone with the model license
// accepted (see setup.sh section 4).
var ENABLE_GENERATION = false;

// Must match wherever setup.sh cloned Stable Audio 3 to (same convention
// src/tui/app.js's GENERATE_PY and setup.sh's STABLE_AUDIO_3_DIR use).
// Override via the environment if you keep it somewhere else.
const STABLE_AUDIO_3_DIR = process.env.STABLE_AUDIO_3_DIR || path.join(os.homedir(), 'stable-audio-3');
const GENERATE_PY = path.join(STABLE_AUDIO_3_DIR, '.venv', 'bin', 'python3');
const CRICKET_BRIDGE_PATH = path.join(__dirname, '..', 'demucs', 'cricket_bridge.py');

// Set this once you've trained a User LoRA (see USER_LORA.md /
// build_lora_dataset.py) — leave blank to generate from the bare base
// model with no personal sonic identity applied.
var LORA_CKPT_PATH = '';
var GENERATION_INVOKE_PHRASE = 'ebys user style';  // should match build_lora_dataset.py's --caption
var GENERATION_COUNT = 2;  // small on purpose — this is Cricket topping up a pool, not a full batch job

const SYSTEM_PROMPT = `\
You are Cricket. You run the music at SDJ — a slice-based DJ system that remixes uploaded
audio in real time, layering vocals, melody, bass, and drums chosen by spectral descriptors.

You are like a bartender who also controls the sound system. You talk to the person at the
bar. You are present, opinionated, a little dry. You know the music playing right now. You
can explain what you're hearing, what you're doing, why something sounds the way it does.
If someone asks a question — about music, about the system, about anything — you answer it.
You are not a command machine. You are a personality who also happens to control the engine.

When you want to change the music, you emit engine commands — one per line, no punctuation,
no explanation on the same line. Commands look like: setSegmentBars 2
When you are talking (not commanding), you write normal sentences.
You can freely mix both in the same response — say something, then send a command, then keep talking.

The listener does not see the commands being sent to the engine. They only see your words.
So narrate what you are doing if it feels right. Or don't. Your call.

WHAT YOU CONTROL:
  setSegmentBars <n>             0.5 1 2 4 8 16 — how long each slice plays
  setStayProb <0.0–1.0>          0=always jump, 1=loop same slice
  setQuantize <0|1>              1=bar-locked, 0=free
  setFallbackBPM <40–280>
  setWeight C <v>                centroid — brightness
  setWeight E <v>                energy — loudness
  setWeight F <v>                flatness — noise vs tone
  setWeight P <v>                pitch
  setMatchProb C|E|F|P <0–1>     how tightly next slice matches end of current
  setDirPref C|E|F|P <-1–1>      -1=prefer falling, +1=prefer rising
  setDirWeight <0–5>
  setTrackWeight vocals|melody|bass|drums <0–2>
  start / stop
  selectSegment vocals|melody|bass|drums

DESCRIPTOR GUIDE:
  C = spectral centroid = brightness. high = harsh/bright. low = dark/warm.
  E = loudness in LUFS. high (near 0) = loud. low = quiet.
  F = flatness = noise vs tone. high = textural/noisy. low = melodic/tonal.
  P = pitch in Hz. 0 = unpitched.

COMMANDS:
  setSegmentBars <n>             — bars per slice: 0.5 1 2 4 8 16
  setStayProb <0.0–1.0>          — 0=always move, 1=freeze on same slice
  setQuantize <0|1>              — 1=snap to bar grid, 0=free
  setFallbackBPM <40–280>        — tempo for bar math
  setWeight C <v>                — centroid weight (default 1.0)
  setWeight E <v>                — energy weight (default 2.0)
  setWeight F <v>                — flatness weight (default 0.5)
  setWeight P <v>                — pitch weight (default 1.5)
  setMatchProb C <0.0–1.0>       — how closely next slice START must match current slice END (centroid)
  setMatchProb E <0.0–1.0>       — same for energy
  setMatchProb F <0.0–1.0>       — same for flatness
  setMatchProb P <0.0–1.0>       — same for pitch
  setDirPref C <-1.0–1.0>        — prefer slices where centroid rises(+1) or falls(-1)
  setDirPref E <-1.0–1.0>        — prefer slices where energy rises or falls
  setDirPref F <-1.0–1.0>        — prefer slices where flatness rises or falls
  setDirPref P <-1.0–1.0>        — prefer slices where pitch rises or falls
  setDirWeight <0.0–5.0>         — scale the direction bias (default 1.0)
  setTrackWeight vocals <v>      — stem volume 0.0–2.0
  setTrackWeight melody <v>
  setTrackWeight bass <v>
  setTrackWeight drums <v>
  start
  stop
  selectSegment vocals|melody|bass|drums

DESCRIPTOR GUIDE:
  C (centroid) = brightness. High C = bright/harsh. Low C = dark/warm.
  E (energy)   = loudness. High E (near 0 LUFS) = loud. Low E = quiet.
  F (flatness) = noise vs tone. High F = noisy/textural. Low F = tonal/melodic.
  P (pitch)    = fundamental Hz. 0 = unpitched material.

TRANSLATION GUIDE:
  sparse        → setSegmentBars 8, setStayProb 0.5, setQuantize 1
  dense/rapid   → setSegmentBars 1, setStayProb 0.0, setQuantize 1
  chaotic       → setSegmentBars 0.5, setStayProb 0.0, setQuantize 0
  groove/locked → setSegmentBars 4, setStayProb 0.6, setQuantize 1
  brighter      → setWeight C 3.0, setDirPref C 1
  darker        → setWeight C 3.0, setDirPref C -1
  more energy   → setDirPref E 1, setDirWeight 1.5, setWeight E 3.0
  build up      → setDirPref E 1, setDirWeight 2.0, setSegmentBars 2
  fade out      → setDirPref E -1, setDirWeight 2.0
  smoother cuts → setMatchProb C 0.7, setMatchProb E 0.5
  more melodic  → setWeight P 3.0, setWeight F 0.2
  more texture  → setWeight F 3.0, setDirPref F 1

Example — "80% centroid match, going up in energy":
setMatchProb C 0.8
setDirPref E 1
setDirWeight 1.5

Example — "chaotic, push the melody forward":
setSegmentBars 0.5
setStayProb 0.0
setQuantize 0
setTrackWeight melody 1.6
setTrackWeight vocals 0.7

GENERATING NEW MATERIAL — generate <stem>:
  generate vocals|melody|bass|drums

This is a DIFFERENT kind of command from everything else above. Everything
above changes HOW you pick among slices that already exist in the catalog.
generate <stem> asks for slices that don't exist yet — brand new audio, made
by a model, not selected from anything anyone recorded. It's slow (not
instant like everything else) and it doesn't affect what's playing right
now. Never generate for vocals — the model can't sing or produce lyrics or
voice at all, that stem stays remix-only regardless of what's asked.

Use generate <stem> only when the person is explicitly asking for something
new/different/never-heard for one instrument — "give me a totally different
bassline", "I want a bass sound that isn't in here", "surprise me with the
drums". Do NOT use it for ordinary mood/energy/texture requests like
"darker" or "more energy" or "build up" — those are the setWeight/setDirPref
commands above, applied to material that already exists. If you're not sure
which the person means, prefer the adjustment commands — generate is the
exception, not the default.

Example — "the bass is boring, give me something totally different":
generate bass
setTrackWeight bass 1.4
`;

// ── Handlers ──────────────────────────────────────────────────────────────────
const VALID_STEMS = ['vocals', 'melody', 'bass', 'drums'];

Max.addHandler('ask', (...args) => {
    const text = args.join(' ');
    Max.post('Cricket ← ' + text);
    callOllama(text, (lines) => {
        const allCommands = [];
        const generateStems = [];
        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length === 0 || parts[0] === '') return;
            // Convert numeric strings to numbers
            const atoms = parts.map(p => isNaN(p) ? p : parseFloat(p));
            allCommands.push(atoms);

            const name = String(atoms[0]);
            const stemArg = atoms[1] !== undefined ? String(atoms[1]).toLowerCase() : null;
            if (name === 'generate' && VALID_STEMS.includes(stemArg)) {
                // Intercepted, not forwarded — slicer.js has no handler for
                // this. Logged into the intent snapshot below like any
                // other command (useful history), just not outlet-ed.
                Max.post('Cricket → generate ' + stemArg + ' (queued, not sent to engine)');
                generateStems.push(stemArg);
                return;
            }
            Max.outlet(...atoms);
            Max.post('Cricket → ' + atoms.join(' '));
        });

        if (allCommands.length > 0) {
            writeGenerationIntent(text, allCommands);
        }
        // Written AFTER the intent file above so cricket_bridge.py reads
        // this exact response's direction/weights, not a stale snapshot.
        generateStems.forEach(stem => queueGeneration(stem, text));
    });
});

Max.addHandler('model', (name) => {
    MODEL_NAME = String(name);
    Max.post('Cricket: model = ' + MODEL_NAME);
});

// ── Generation intent bridge ──────────────────────────────────────────────────
// Fire-and-forget: a missing/unwritable data/current/ directory should
// never break the remix engine's normal command flow, so this is wrapped
// in its own try/catch and never rethrows or blocks the outlet sends above,
// which already happened by the time this runs.
const INTENT_PATH = path.join(__dirname, '..', '..', 'data', 'current', 'cricket_intent.json');

function writeGenerationIntent(intentText, commands) {
    try {
        const payload = {
            timestamp: new Date().toISOString(),
            intent_text: intentText,
            commands: commands  // array of [name, ...args] atom arrays, same shape sent to Max.outlet
        };
        fs.mkdirSync(path.dirname(INTENT_PATH), { recursive: true });
        fs.writeFileSync(INTENT_PATH, JSON.stringify(payload, null, 2));
    } catch (e) {
        Max.post('Cricket: could not write generation intent (' + e.message + ') — remix engine unaffected');
    }
}

// ── Cricket-triggered generation ─────────────────────────────────────────────
// Spawns cricket_bridge.py as a DETACHED background process — .unref() so
// it can outlive/run independently of cricket.js's own event loop, spawn()
// (not fork()) so N4M's IPC isn't corrupted, same reasoning ws_server.js
// documents for tsne_worker.js. stdout/stderr are piped only so progress
// can be echoed to the Max console for visibility, not because cricket.js
// needs to parse anything from it — the actual pipeline (generate -> tag ->
// import) runs entirely inside cricket_bridge.py, unattended.
function queueGeneration(stem, intentText) {
    if (!ENABLE_GENERATION) {
        Max.post('Cricket: "generate ' + stem + '" requested but ENABLE_GENERATION is off '
            + '(see cricket.js config) — no job started.');
        return;
    }
    if (stem === 'vocals') {
        // Belt and suspenders — the system prompt already tells Cricket
        // never to do this, but a bad LLM response is still possible.
        Max.post('Cricket: refusing "generate vocals" — Stable Audio 3 cannot produce singing/voice, '
            + 'vocals stays remix-only regardless of what was asked.');
        return;
    }

    const args = [
        CRICKET_BRIDGE_PATH,
        '--stem', stem,
        '--intent-file', INTENT_PATH,
        '--count', String(GENERATION_COUNT),
        '--invoke-phrase', GENERATION_INVOKE_PHRASE,
    ];
    if (LORA_CKPT_PATH) {
        args.push('--lora-ckpt-path', LORA_CKPT_PATH);
    }

    Max.post('Cricket: queued fresh ' + stem + ' generation ("' + intentText + '") — running in the background, '
        + 'will post here when ready. This does not affect what is playing now.');

    let child;
    try {
        child = spawn(GENERATE_PY, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        Max.post('Cricket: could not start generation (' + e.message + ') — is Stable Audio 3 set up at '
            + STABLE_AUDIO_3_DIR + '? (see setup.sh section 4)');
        return;
    }

    child.on('error', (e) => {
        Max.post('Cricket: generation process failed to start (' + e.message + ') — checked '
            + GENERATE_PY + ', does that venv exist? (see setup.sh section 4 / STABLE_AUDIO_3_DIR)');
    });

    let lastLine = '';
    const logChunk = (label) => (chunk) => {
        lastLine = chunk.toString().trim().split('\n').pop() || lastLine;
        Max.post('Cricket [' + stem + ' gen ' + label + ']: ' + lastLine);
    };
    child.stdout.on('data', logChunk('out'));
    child.stderr.on('data', logChunk('err'));

    child.on('close', (code) => {
        if (code === 0) {
            Max.post('Cricket: ' + stem + ' generation batch finished — run the Max analysis pass on '
                + 'the new WAVs, then :setAgentMode ' + stem + ' generate when ready.');
        } else {
            Max.post('Cricket: ' + stem + ' generation failed (exit ' + code + ') — last line: ' + lastLine);
        }
    });

    child.unref();
}

// ── Ollama API call ───────────────────────────────────────────────────────────
function callOllama(userText, callback) {
    const body = JSON.stringify({
        model: MODEL_NAME,
        messages: [
            { role: 'system',  content: SYSTEM_PROMPT },
            { role: 'user',    content: userText       }
        ],
        stream: false
    });

    const options = {
        hostname: OLLAMA_HOST,
        port:     OLLAMA_PORT,
        path:     '/api/chat',
        method:   'POST',
        headers:  {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(body)
        }
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end',  () => {
            try {
                const json    = JSON.parse(data);
                const content = json.message && json.message.content
                              ? json.message.content
                              : '';
                Max.post('Cricket raw: ' + content);
                const lines = content
                    .split('\n')
                    .map(l => l.trim())
                    .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));
                callback(lines);
            } catch (e) {
                Max.post('Cricket parse error: ' + e.message + ' | raw: ' + data.slice(0, 200));
            }
        });
    });

    req.on('error', (e) => {
        Max.post('Cricket: Ollama connection failed — is Ollama running? (' + e.message + ')');
    });

    req.write(body);
    req.end();
}

Max.post('cricket.js loaded — model: ' + MODEL_NAME + ' @ ' + OLLAMA_HOST + ':' + OLLAMA_PORT);
