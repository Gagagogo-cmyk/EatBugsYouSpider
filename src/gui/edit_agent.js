#!/usr/bin/env node
// edit_agent.js — Cricket as a local, repo-aware coding agent ("EDIT INTERFACE").
//
// WHAT THIS IS
// ------------
// gui_hub_bridge.js already runs Cricket for two things: the OGTM instrument
// console (handleChat/callCricket) and OMSC's ambient/DM social chat
// (handleCricketDM/callCricketAmbient). Both talk to the same local Ollama
// model but only ever produce text (prose + a whitelisted engine command).
//
// This module gives Cricket a THIRD job: when the panel's EDIT INTERFACE is
// on, the user is talking to Cricket about the panel/hub codebase itself
// ("move the chat to the left and make it 40% wide"), and Cricket needs to
// actually look at and change files to do that.
//
// Rather than Ollama "tool calling" (unreliable across small local models,
// and this project already has a working alternative pattern — see
// isCricketCommand()/splitCricketReply() in gui_hub_bridge.js, and the
// COMMANDS whitelist a few hundred lines up: a small, explicit, named set
// of things Cricket is allowed to do, dispatched from parsed text), this
// uses the same idea: Cricket is told, in its system prompt, to emit ONE
// fenced ```tool block containing {"tool": "...", ...args} per turn when it
// wants to act, or plain prose with no fenced block when it's done. The hub
// parses that, runs the named tool (from the TOOLS whitelist below — the
// same "an unknown one is a named error, not silently ignored" philosophy
// as COMMANDS), feeds the result back, and loops (bounded by
// MAX_TOOL_ITERATIONS) until Cricket answers in plain prose.
//
// TOOLS, and why each one is shaped this way
// -------------------------------------------
//   list_files    — recursive directory listing, repo-root-relative, so
//                   Cricket can find files without being told file names.
//   search_files  — plain-text grep across the repo, capped, so Cricket can
//                   find where a feature (e.g. "chatChip") actually lives.
//   read_file     — paged reads (offset/limit lines), capped in size, so a
//                   14,000-line file like panel.html never blows a local
//                   model's context window in one call.
//   apply_patch   — anchor-based exact-string replacement (old_str must
//                   occur exactly once), same technique src/gui/edit1.py
//                   already used by hand to patch gui_hub_bridge.js itself.
//                   Never a full-file rewrite. Backs up the file first,
//                   using this repo's OWN pre-existing convention (see the
//                   dozens of panel.html.bak-<timestamp>-<slug> files
//                   already in src/gui/) rather than inventing a new one.
//   git_diff      — shells out to `git diff`, so a change Cricket makes is
//                   visible the same way any other change in this repo is
//                   (the repo is already a git checkout — see CLAUDE.md/
//                   XREF.md — so this reuses it instead of building a
//                   parallel history mechanism, per that doc's own "if git
//                   is already present, use it" guidance).
//   undo_change   — restores the most recent matching .bak-* file for a
//                   path. Deliberately NOT `git checkout -- <path>`: the
//                   working tree here is routinely left mid-iteration and
//                   dirty (see `git status` on this repo on any given day),
//                   so a git-based undo would blow away real uncommitted
//                   work, not just Cricket's last change. The .bak
//                   convention is scoped to exactly the one edit it made.
//   reload_ui     — broadcasts {t:"reloadUI"} to every connected panel.
//                   panel.html is served fresh off disk on every request
//                   (see gui_hub_bridge.js's own "Static, localhost,
//                   read-only" HTTP handler) — there is no build step to
//                   run and no bundler cache to invalidate, so "reload the
//                   browser tab" IS the live-reload mechanism here.
//   run_check     — `node --check` for .js files; a light open/close-tag
//                   balance check for .html. Not a real linter — just
//                   enough to catch "Cricket wrote something that can't
//                   even parse" before telling the user to look at it.
//
// SAFETY
// ------
// Every tool that touches the filesystem goes through resolveSafe(), which
// resolves the given path against repoRoot and refuses anything that
// escapes it, touches an excluded directory (.git, node_modules, data/,
// the various Python venvs, archive/), or targets a .bak-* file directly
// (those are only ever touched through undo_change). This is local-machine,
// single-user, developer-facing (section 13 of the spec this was built
// against calls this out explicitly: "your own local Cricket... broad
// access to your own Gnumbat codebase is acceptable because this is your
// trusted local environment" — shared/downloaded skins are a different,
// separate trust boundary, not handled by this file).
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const EXCLUDED_DIRS = new Set([
  ".git", "node_modules", "data", "archive",
  "demucs_env", "demucs_env311", "demucs_env314",
  "gnumbat-env", "gnumbat-mlx-env", "genenv", "stable-audio-3",
  "__pycache__",
  // BRANCHES -- list_files/search_files never need to walk into this
  // directly: every branchable file is already reachable at its normal
  // src/gui/panel.html-style path via branchAwareFull()'s redirect once
  // a branch is active, so also finding it again under its raw
  // src/gui/branches/<name>/... path would just double-list the same
  // match under two different names.
  "branches",
]);
const EXCLUDED_FILE_RE = /\.bak(-|$)/;
const BINARY_EXT_RE = /\.(png|jpg|jpeg|gif|ico|webp|woff2?|ttf|otf|wav|mp3|flac|aif|aiff|mp4|mov|psd|db|sqlite3?|pdf)$/i;

// KNOWN_FILES -- every file the user plausibly means when they say just
// "panel.html" or "base.html" in a request, with its real repo-root-
// relative path spelled out ONCE. Two consumers read this instead of
// each keeping their own hand-written copy that can drift out of sync
// with the other (exactly what happened before: the system prompt once
// said "gnumbat-live.js"/"gnumbat-link.js", renamed to ebys-live.js/
// ebys-link.js on disk without that prose ever being updated to match):
// resolveSafe's own basename redirect (below -- a WRONG directory guess
// for any of these gets silently corrected before it can ever fail) and
// SYSTEM_PROMPT's own "Repo layout" section (built from this list, see
// REPO_LAYOUT_TEXT below, so the two can never disagree again).
const KNOWN_FILES = [
  { name: "panel.html", relPath: "src/gui/panel.html",
    desc: "the single-page control panel itself (all HTML/CSS/JS in one file). Layout CSS lives in a <style> block near the top; behavior lives in <script> blocks lower down." },
  { name: "ebys-live.js", relPath: "src/gui/ebys-live.js",
    desc: "binds the panel's DOM to the instrument (loaded after panel.html's inline script; shares its top-level scope)." },
  { name: "ebys-link.js", relPath: "src/gui/ebys-link.js",
    desc: "the WebSocket transport (Gnumbat.send/.chat/.on(...)); rarely what needs to change for a visual/layout request." },
  { name: "gui_hub_bridge.js", relPath: "src/gui/gui_hub_bridge.js",
    desc: "the Node server behind the panel (serves panel.html, runs you)." },
  { name: "base.html", relPath: "src/backend/event-crawler/frontend/base.html",
    desc: "a SEPARATE single-page app (its own inline <style>/<script>, a completely different document from panel.html) embedded inside panel.html via the #omscFrame iframe. The user may refer to elements in it by name, e.g. \".search-input @ E2 -- src/backend/event-crawler/frontend/base.html\" -- that file-path suffix tells you which of these two files actually owns the element; always check it before searching, they can have similarly-named classes in both files." },
];
const KNOWN_FILES_BY_BASENAME = {};
for (const kf of KNOWN_FILES) KNOWN_FILES_BY_BASENAME[kf.name] = kf.relPath;
const REPO_LAYOUT_TEXT = KNOWN_FILES.map((kf) => `- ${kf.relPath} — ${kf.desc}`).join("\n");

const MAX_LIST_ENTRIES = 300;
const MAX_SEARCH_MATCHES = 60;
const MAX_SEARCH_FILES_SCANNED = 4000;
const MAX_READ_LINES_DEFAULT = 200;
const MAX_READ_CHARS = 20000;
const MAX_TOOL_RESULT_CHARS = 6000;
const MAX_GIT_DIFF_CHARS = 8000;
/* UPDATE -- user hit "(stopped after 14 steps to avoid a runaway loop)"
   twice in a row on a real task (repositioning .nowPlayingBar relative to
   .conv) that needed several search/read round trips before it had
   enough context to write the patch -- 14 wasn't enough headroom for a
   local model that re-verifies more than a stronger one would. Bumped to
   24. Raised MAX_HISTORY_MESSAGES to match (see trimEditHistory below,
   ~2 messages per tool iteration -- 14 iterations could already exceed
   the old 24-message cap and silently drop the EARLIEST tool results,
   e.g. the very search that found ".nowPlayingBar{" -- which is exactly
   why it kept re-searching things it had already found instead of
   finishing: its own history was trimming that result away mid-task.
   40 gives ~24 iterations of headroom without truncating early context.
   Raising both together goes hand in hand -- iterations alone would
   have just hit the same forgetting problem a few steps later. */
const MAX_TOOL_ITERATIONS = 24;
const MAX_HISTORY_MESSAGES = 40; // + the system prompt, trimmed each turn

// Appends -2, -3, ... if `base` already exists, so a backup/branch-dir
// write can never silently clobber something already at that exact
// path (two writes landing on the same timestamp, or two branches
// named the same thing).
function uniquePath(base) {
  if (!fs.existsSync(base)) return base;
  let i = 2;
  while (fs.existsSync(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function slugify(s) {
  return String(s || "edit")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "edit";
}

// YYYYMMDD-HHMMSS-mmm — same human-readable shape as the .bak-<date>-<time>
// files already all over this repo (see src/gui/panel.html.bak-2026...),
// with milliseconds appended after their own hyphen so two backups made
// inside the same wall-clock second (realistic: one Cricket turn can call
// apply_patch more than once) still sort correctly and never collide.
// Adding a third dash-segment is backward compatible with the existing
// convention -- anything doing `name.startsWith(base + ".bak-")` (see
// undo_change below) still matches.
function timestamp() {
  const d = new Date();
  const pad = (n, w) => String(n).padStart(w || 2, "0");
  return (
    d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + "-" +
    pad(d.getMilliseconds(), 3)
  );
}

function createEditAgent(opts) {
  const repoRoot = path.resolve(opts.repoRoot);
  const ollamaHost = opts.ollamaHost;
  const ollamaPort = opts.ollamaPort;
  const ollamaModel = opts.ollamaModel;
  // UPDATE -- user: "ollama timed out" on a request that needed Cricket to
  // read_file a big file (base.html, 2000+ lines) TWICE (rule 12's own
  // "read both files before matching a value" fix, just added) before it
  // could even write the patch -- more context in the conversation means
  // a slower generation on a local 7B model, and the OLD flat 120000ms
  // (2 minute) cap was sized around small, quick panel.html-only edits.
  // Defaults to 5 minutes now; still overridable (same opts-driven pattern
  // as ollamaModel above) if even that isn't enough on slower hardware.
  const ollamaTimeoutMs = opts.ollamaTimeoutMs || 300000;
  const broadcast = opts.broadcast; // (obj) -> void, sends to every connected panel
  const post = opts.post || (() => {}); // (str) -> void, hub's own stdout logger
  const http = require("http");

  // ── PATH SAFETY ───────────────────────────────────────────────────────
  // BRANCHES -- user: "the system needs to tell the user its gonna
  // create a branch of the seed... that new branch can be merged with
  // the original one." The three files EDIT INTERFACE ever plausibly
  // touches for a panel visual/behavior request. The server (gui_hub_
  // bridge.js, edit_agent.js itself) is NOT branched -- branching a
  // running server process is a much bigger undertaking (separate port,
  // separate process) that is out of scope here; only the served
  // frontend files are.
  const BRANCHABLE_RELPATHS = ["src/gui/panel.html", "src/gui/ebys-live.js", "src/gui/ebys-link.js"];
  let activeBranchDir = null;
  let activeBranchName = null;

  // Every tool that touches one of the branchable files goes through
  // this (resolveSafe for single-file tools, the search_files walk for
  // the multi-file one, both below) so Cricket always reads/writes the
  // ACTIVE branch copy once one exists, transparently -- it still just
  // says path:"src/gui/panel.html" in every tool call, unchanged.
  function branchAwareFull(relFromRepo, fallbackFull) {
    if (activeBranchDir && BRANCHABLE_RELPATHS.indexOf(relFromRepo) !== -1) {
      return path.join(activeBranchDir, path.basename(relFromRepo));
    }
    return fallbackFull;
  }

  function getCurrentBranch() {
    return activeBranchName;
  }

  // Deterministic (no Ollama involved) -- gui_hub_bridge.js calls this
  // directly once the user has answered "what do you want to name this
  // branch". A full snapshot copy, same reasoning apply_patch/undo_change
  // already use .bak file copies for: simple, obviously-correct, no
  // diffing/merging logic to get subtly wrong.
  function createBranch(name) {
    const slug = slugify(name);
    const dir = uniquePath(path.join(repoRoot, "src/gui/branches", slug));
    fs.mkdirSync(dir, { recursive: true });
    for (const rel of BRANCHABLE_RELPATHS) {
      fs.copyFileSync(path.join(repoRoot, rel), path.join(dir, path.basename(rel)));
    }
    activeBranchDir = dir;
    activeBranchName = path.basename(dir);
    return activeBranchName;
  }

  // Deterministic straight-overwrite merge (user picked this over a
  // review step): the branch files become the seed files. The seed own
  // prior content is never actually lost -- backed up first via the
  // same .bak convention as every other write in this file, read into
  // memory before writing anything, same race-safety pattern as
  // undo_change above.
  function mergeBranch() {
    if (!activeBranchDir) throw new Error("no active branch to merge");
    const mergedFiles = [];
    for (const rel of BRANCHABLE_RELPATHS) {
      const seedFull = path.join(repoRoot, rel);
      const branchFull = path.join(activeBranchDir, path.basename(rel));
      if (!fs.existsSync(branchFull)) continue;
      const branchContent = fs.readFileSync(branchFull);
      if (fs.existsSync(seedFull)) {
        const bak = uniquePath(`${seedFull}.bak-${timestamp()}-pre-merge-${activeBranchName}`);
        fs.writeFileSync(bak, fs.readFileSync(seedFull));
      }
      fs.writeFileSync(seedFull, branchContent);
      mergedFiles.push(rel);
    }
    const merged = activeBranchName;
    activeBranchDir = null;
    activeBranchName = null;
    return { merged, mergedFiles };
  }

  // UPDATE -- user: "i'm giving the exact item name and the file where
  // it should do the edit... it still doesnt reach it." A prompt-level
  // hint (Repo layout) and even a helpful tool-error message both turned
  // out not to be reliable enough -- a small local model doesn't
  // consistently act on prose, however clear, the way it reacts to the
  // path just working. This is the actually-robust fix, generalized per
  // the user's own follow-up ("the path of those files must be
  // hardcoded"): ANY path whose bare filename matches a KNOWN_FILES
  // entry (see that list's own comment, top of this file) but that
  // doesn't itself exist gets transparently redirected to the real one
  // -- covers any wrong-directory guess for any known file, not just
  // the one specific case seen so far, and applies to every tool that
  // goes through resolveSafe (read_file, apply_patch, all of them) --
  // no reasoning or self-correction required of the model at all.
  function resolveSafe(relPath) {
    if (typeof relPath !== "string" || !relPath.trim()) {
      throw new Error("path is required");
    }
    let normalizedIn = relPath.trim().replace(/^\.\//, "").replace(/\\/g, "/");
    const knownCanonical = KNOWN_FILES_BY_BASENAME[path.basename(normalizedIn)];
    if (knownCanonical && normalizedIn !== knownCanonical && !fs.existsSync(path.resolve(repoRoot, normalizedIn))) {
      normalizedIn = knownCanonical;
    }
    relPath = normalizedIn;
    const full = path.resolve(repoRoot, relPath);
    if (full !== repoRoot && !full.startsWith(repoRoot + path.sep)) {
      throw new Error("path escapes the repo root — refusing");
    }
    const rel = path.relative(repoRoot, full) || ".";
    const parts = rel.split(path.sep);
    for (const p of parts) {
      if (EXCLUDED_DIRS.has(p)) {
        throw new Error(`path passes through an excluded directory ("${p}") — refusing`);
      }
    }
    if (EXCLUDED_FILE_RE.test(path.basename(rel))) {
      throw new Error("refusing to touch a .bak file directly — use undo_change instead");
    }
    return { full: branchAwareFull(rel, full), rel };
  }

  function isExcludedDirName(name) {
    return EXCLUDED_DIRS.has(name) || name.startsWith(".");
  }

  // ── TOOL: list_files ──────────────────────────────────────────────────
  // ── STRIP COMMENTS FOR THE MODEL ────────────────────────────────────
  // User: "make panel.html lighter to use in terms of token... if you
  // deleted all the informative texts, would it save on tokens? cause
  // there is a lot lot lot of text to read that isnt code." Measured:
  // ~73% of panel.html's characters are comments (HTML/CSS/JS history
  // notes documenting past requests) -- a 200-line read_file window can
  // land almost entirely inside one of these blocks with barely any real
  // code in it, and every one of those comment characters gets re-sent to
  // Ollama as prompt tokens on every single call.
  //
  // Deciding between "delete the comments for real" vs "just don't show
  // them to Cricket": chosen the latter. This repo's own comments ARE the
  // project's memory of hundreds of past decisions (why a value is 32px
  // and not 28px, etc, per this very file's system prompt/Rule 12 style
  // reasoning) -- genuinely useful to a human or a future session reading
  // the file directly, just not to Cricket mid-edit. So this function
  // only transforms what read_file (and search_files' per-line scan)
  // shows the MODEL -- fs.readFileSync of the real file, used by
  // apply_patch/undo_change/git_diff, is completely untouched by this.
  //
  // Blanks out comment BODIES with spaces rather than deleting them, so
  // every character offset/newline position -- and therefore every line
  // number read_file's offset/limit pagination and hint text depend on --
  // stays identical to the real file. A line that was pure comment just
  // renders as blank instead of vanishing or shifting everything below it
  // up, which would silently break "read_file again at a higher offset."
  //
  // Single left-to-right scan tracking which "language" region we're in
  // (plain HTML vs inside <style> vs inside <script>) so the right
  // comment syntax applies in each, and tracking quoted-string state in
  // both CSS and JS so a quote's contents (e.g. a base64 data: URI, which
  // can coincidentally contain the literal characters "/*") are never
  // misread as a comment. Deliberately simple regex-literal handling is
  // skipped (a `//` inside a rare `/regex/` literal, not a string, could
  // in theory be misread as a line comment) -- acceptable here since this
  // only affects what Cricket SEES, never the file on disk.
  function stripCommentsForModel(text, ext) {
    if (!/\.(?:html?|css|js)$/i.test(ext || "")) return text;
    // .split("") (UTF-16 code UNITS), not Array.from (Unicode code POINTS)
    // -- this file's prose comments are full of em dashes/curly quotes/the
    // odd emoji, and Array.from collapses any surrogate-pair character
    // into a single array slot, which desyncs `out`'s indices from the
    // plain `text[i]`/text.indexOf()/text.startsWith(...,i) calls below
    // (all UTF-16-code-unit based) by one slot per such character from
    // that point on -- confirmed by test: this file has 4 fewer
    // Array.from() entries than text.length. split("") keeps a 1:1 index
    // match with `text` throughout, at the cost of (harmlessly) treating
    // one surrogate pair as two array slots.
    const out = text.split("");
    const n = out.length;
    const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; };
    const skipQuoted = (i, quote) => {
      let j = i + 1;
      while (j < n && text[j] !== quote) { if (text[j] === "\\") j++; j++; }
      return j + 1;
    };
    let mode = "html"; // "html" | "style" | "script"
    let i = 0;
    while (i < n) {
      if (mode === "html") {
        if (text.startsWith("<!--", i)) {
          const end = text.indexOf("-->", i + 4);
          const stop = end === -1 ? n : end + 3;
          blank(i, stop);
          i = stop;
          continue;
        }
        if (text[i] === "<") {
          const chunk = text.slice(i, i + 200);
          const styleM = /^<style\b[^>]*>/i.exec(chunk);
          const scriptM = /^<script\b[^>]*>/i.exec(chunk);
          if (styleM) { i += styleM[0].length; mode = "style"; continue; }
          if (scriptM) { i += scriptM[0].length; mode = "script"; continue; }
        }
        i++;
        continue;
      }
      if (mode === "style") {
        if (text.startsWith("</style", i)) { mode = "html"; i++; continue; }
        if (text.startsWith("/*", i)) {
          const end = text.indexOf("*/", i + 2);
          const stop = end === -1 ? n : end + 2;
          blank(i, stop);
          i = stop;
          continue;
        }
        if (text[i] === '"' || text[i] === "'") { i = skipQuoted(i, text[i]); continue; }
        i++;
        continue;
      }
      // mode === "script"
      if (text.startsWith("</script", i)) { mode = "html"; i++; continue; }
      if (text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2);
        const stop = end === -1 ? n : end + 2;
        blank(i, stop);
        i = stop;
        continue;
      }
      if (text.startsWith("//", i)) {
        let end = text.indexOf("\n", i);
        if (end === -1) end = n;
        blank(i, end);
        i = end;
        continue;
      }
      if (text[i] === '"' || text[i] === "'" || text[i] === "`") { i = skipQuoted(i, text[i]); continue; }
      i++;
    }
    return out.join("");
  }

  function toolListFiles(args) {
    const startRel = (args && args.dir) || ".";
    const { full: startFull } = resolveSafe(startRel);
    const entries = [];
    let truncated = false;
    (function walk(dir, depth) {
      if (truncated || depth > 8) return;
      let names;
      try {
        names = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const ent of names) {
        if (truncated) return;
        if (ent.isDirectory()) {
          if (isExcludedDirName(ent.name)) continue;
          walk(path.join(dir, ent.name), depth + 1);
        } else {
          if (ent.name === ".DS_Store") continue;
          if (EXCLUDED_FILE_RE.test(ent.name)) continue;
          const rel = path.relative(repoRoot, path.join(dir, ent.name));
          entries.push(rel);
          if (entries.length >= MAX_LIST_ENTRIES) { truncated = true; return; }
        }
      }
    })(startFull, 0);
    return { ok: true, dir: path.relative(repoRoot, startFull) || ".", entries, truncated };
  }

  // ── TOOL: search_files ────────────────────────────────────────────────
  function toolSearchFiles(args) {
    const query = args && args.query;
    if (!query || typeof query !== "string") throw new Error("query is required");
    const startRel = (args && args.dir) || ".";
    const { full: startFull } = resolveSafe(startRel);
    const needle = query.toLowerCase();
    const matches = [];
    let filesScanned = 0;
    let truncated = false;
    (function walk(dir) {
      if (truncated) return;
      let names;
      try {
        names = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const ent of names) {
        if (truncated) return;
        if (ent.isDirectory()) {
          if (isExcludedDirName(ent.name)) continue;
          walk(path.join(dir, ent.name));
        } else {
          if (BINARY_EXT_RE.test(ent.name) || EXCLUDED_FILE_RE.test(ent.name)) continue;
          if (filesScanned++ >= MAX_SEARCH_FILES_SCANNED) { truncated = true; return; }
          const full = path.join(dir, ent.name);
          const relFromRepo = path.relative(repoRoot, full);
          // Branch-aware, same as resolveSafe -- otherwise search_files
          // would keep showing the seed contents of panel.html/ebys-live.js/
          // ebys-link.js even while a branch is active and those files have
          // already diverged, which would send Cricket hunting for text at
          // line numbers that do not match what read_file/apply_patch (both
          // branch-aware via resolveSafe) actually see.
          const effectiveFull = branchAwareFull(relFromRepo, full);
          let text;
          try {
            text = fs.readFileSync(effectiveFull, "utf8");
          } catch (e) {
            continue; // unreadable / not text
          }
          // See stripCommentsForModel's own comment (above) -- search only
          // over what Cricket would actually be shown, so a hit is always
          // real code, never a history comment that happens to mention the
          // same word.
          const lines = stripCommentsForModel(text, path.extname(ent.name)).split("\n");
          let hitsThisFile = 0;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().indexOf(needle) === -1) continue;
            matches.push({
              file: relFromRepo,
              line: i + 1,
              text: lines[i].trim().slice(0, 200),
            });
            hitsThisFile++;
            if (matches.length >= MAX_SEARCH_MATCHES) { truncated = true; return; }
            if (hitsThisFile >= 5) break; // one very hot file shouldn't eat the whole cap
          }
        }
      }
    })(startFull);
    return { ok: true, query, matches, truncated };
  }

  // ── TOOL: read_file ───────────────────────────────────────────────────
  function toolReadFile(args) {
    // Wrong-directory guesses for a KNOWN_FILES entry (panel.html,
    // base.html, ...) are already redirected inside resolveSafe itself
    // (see its own comment) -- this can still fail for a genuinely
    // unknown/nonexistent path, just no longer for that one reason.
    const { full, rel } = resolveSafe(args && args.path);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw new Error(`no such file: ${rel}`);
    }
    const text = fs.readFileSync(full, "utf8");
    // See stripCommentsForModel's own comment (above toolListFiles) --
    // this is what Cricket actually sees; the real `text` above (with
    // every comment intact) is what apply_patch/undo_change/git_diff
    // work against, completely separately.
    const modelText = stripCommentsForModel(text, path.extname(rel));
    const lines = modelText.split("\n");
    const offset = Math.max(0, (args && args.offset) | 0);
    const limit = Math.min(
      (args && args.limit) > 0 ? args.limit | 0 : MAX_READ_LINES_DEFAULT,
      MAX_READ_LINES_DEFAULT
    );
    let slice = lines.slice(offset, offset + limit).join("\n");
    let truncatedChars = false;
    if (slice.length > MAX_READ_CHARS) {
      slice = slice.slice(0, MAX_READ_CHARS);
      truncatedChars = true;
    }
    return {
      ok: true,
      path: rel,
      totalLines: lines.length,
      offset,
      returnedLines: Math.min(limit, Math.max(0, lines.length - offset)),
      truncatedChars,
      content: slice,
      hint: lines.length > offset + limit
        ? `${lines.length - offset - limit} more line(s) below — call read_file again with a higher offset, or search_files first to find the exact spot`
        : null,
    };
  }

  // ── TOOL: apply_patch ─────────────────────────────────────────────────
  function toolApplyPatch(args) {
    const { full, rel } = resolveSafe(args && args.path);
    const oldStr = args && args.old_str;
    const newStr = args && args.new_str;
    if (typeof oldStr !== "string" || !oldStr.length) throw new Error("old_str is required and must be non-empty");
    if (typeof newStr !== "string") throw new Error("new_str is required (use an empty string to delete old_str)");
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`no such file: ${rel}`);
    const stat = fs.statSync(full);
    if (stat.size > 4 * 1024 * 1024) throw new Error(`${rel} is too large to patch through this tool (${stat.size} bytes) — this tool is for small, targeted edits`);

    const content = fs.readFileSync(full, "utf8");
    let count = 0, idx = -1;
    {
      let from = 0;
      while (true) {
        const at = content.indexOf(oldStr, from);
        if (at === -1) break;
        count++;
        if (idx === -1) idx = at;
        from = at + oldStr.length;
        if (count > 1) break; // no need to keep counting past "not unique"
      }
    }
    if (count === 0) {
      throw new Error("old_str was not found in the file — re-read the file (it may have changed) and match it exactly, including whitespace/indentation");
    }
    if (count > 1) {
      throw new Error(`old_str is not unique in this file (found ${count}+ times) — include more surrounding context so it matches exactly once`);
    }

    const description = (args && args.description) || "edit-interface";
    const bakPath = `${full}.bak-${timestamp()}-${slugify(description)}`;
    fs.copyFileSync(full, bakPath);

    const updated = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
    fs.writeFileSync(full, updated, "utf8");

    return {
      ok: true,
      path: rel,
      backup: path.relative(repoRoot, bakPath),
      bytesBefore: content.length,
      bytesAfter: updated.length,
    };
  }

  // ── TOOL: git_diff ────────────────────────────────────────────────────
  function toolGitDiff(args) {
    const target = (args && args.path) || ".";
    let rel = ".";
    if (target !== ".") ({ rel } = resolveSafe(target));
    try {
      // A file/directory git has never seen (untracked -- `git status`'s
      // `??`) diffs as empty against `git diff`, which reads as "no
      // change" even right after a real edit. Checked explicitly so that
      // case says so instead of silently looking like nothing happened --
      // this repo's own src/gui/ is exactly this case today (a mature,
      // long-lived directory that was never `git add`-ed), which is the
      // whole reason undo_change uses the .bak-file convention instead of
      // git in the first place.
      const status = execFileSync("git", ["-C", repoRoot, "status", "--porcelain", "--", rel], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      if (status && /^\?\?/.test(status.trim())) {
        return {
          ok: true,
          path: rel,
          diff: "",
          untracked: true,
          note: `${rel} is not tracked by git yet, so "git diff" has nothing to compare against — this does NOT mean nothing changed. Rely on undo_change (the .bak file apply_patch just made) for rollback here, not git.`,
        };
      }
      const out = execFileSync("git", ["-C", repoRoot, "diff", "--", rel], {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      });
      const truncated = out.length > MAX_GIT_DIFF_CHARS;
      return { ok: true, path: rel, diff: truncated ? out.slice(0, MAX_GIT_DIFF_CHARS) : out, truncated };
    } catch (e) {
      return { ok: false, error: "git diff failed: " + e.message };
    }
  }

  // ── TOOL: undo_change ─────────────────────────────────────────────────
  function toolUndoChange(args) {
    const { full, rel } = resolveSafe(args && args.path);
    const dir = path.dirname(full);
    const base = path.basename(full);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      throw new Error(`cannot list ${path.dirname(rel)}: ${e.message}`);
    }
    const prefix = base + ".bak-";
    // Sorted by filename, not filesystem mtime: the timestamp() format
    // above is zero-padded and lexicographically sortable, so string order
    // == chronological order regardless of the filesystem's mtime
    // resolution (some filesystems round to whole seconds, which mtime-
    // based sorting would get wrong for two backups made moments apart).
    const candidates = names
      .filter((n) => n.indexOf(prefix) === 0)
      .sort()
      .reverse()
      .map((n) => ({ name: n }));
    if (!candidates.length) {
      throw new Error(`no backup found for ${rel} — nothing to undo (backups are only made by apply_patch)`);
    }
    const chosen = candidates[0];
    const chosenFull = path.join(dir, chosen.name);

    // Read the content to restore INTO MEMORY before writing anything.
    // Deliberately not fs.copyFileSync(chosenFull, full) as the last step
    // (which would be simpler) -- this file own name could, in principle,
    // collide with the pre-undo backup name generated just below (two
    // undo_change calls close enough together to land on the same
    // timestamp), and if that backup write happened first via a plain
    // file-to-file copy, it would overwrite chosenFull with today current
    // content BEFORE that content was ever read, silently losing exactly
    // the version this tool exists to protect. Capturing the bytes here
    // removes that race entirely, regardless of what uniquePath() below
    // does or does not need to disambiguate.
    const restoreContent = fs.readFileSync(chosenFull);

    // Back up the CURRENT (about-to-be-overwritten) content, same
    // convention as apply_patch (which already uses uniquePath() for its
    // own backups), so undoing an undo is always possible too. uniquePath()
    // guards the same-millisecond collision case above.
    let preUndoBak = null;
    if (fs.existsSync(full)) {
      preUndoBak = uniquePath(`${full}.bak-${timestamp()}-pre-undo`);
      fs.writeFileSync(preUndoBak, fs.readFileSync(full));
    }

    fs.writeFileSync(full, restoreContent);

    return {
      ok: true,
      path: rel,
      restoredFrom: path.relative(repoRoot, chosenFull),
      savedCurrentAs: preUndoBak ? path.relative(repoRoot, preUndoBak) : null,
    };
  }

  // ── TOOL: reload_ui ───────────────────────────────────────────────────
  function toolReloadUi() {
    broadcast({ t: "reloadUI" });
    return { ok: true, note: "told every connected panel to reload" };
  }

  // ── TOOL: run_check ───────────────────────────────────────────────────
  function toolRunCheck(args) {
    const { full, rel } = resolveSafe(args && args.path);
    if (!fs.existsSync(full)) throw new Error(`no such file: ${rel}`);
    const ext = path.extname(full).toLowerCase();
    if (ext === ".js") {
      try {
        execFileSync(process.execPath, ["--check", full], { encoding: "utf8" });
        return { ok: true, path: rel, check: "node --check", result: "passed" };
      } catch (e) {
        return { ok: false, path: rel, check: "node --check", error: (e.stderr || e.message || "").toString().slice(0, 2000) };
      }
    }
    if (ext === ".html") {
      const text = fs.readFileSync(full, "utf8");
      const openScript = (text.match(/<script[\s>]/gi) || []).length;
      const closeScript = (text.match(/<\/script>/gi) || []).length;
      const openStyle = (text.match(/<style[\s>]/gi) || []).length;
      const closeStyle = (text.match(/<\/style>/gi) || []).length;
      const balanced = openScript === closeScript && openStyle === closeStyle;
      return {
        ok: balanced,
        path: rel,
        check: "tag-balance (script/style only — not a real HTML parser)",
        detail: { openScript, closeScript, openStyle, closeStyle },
      };
    }
    return { ok: true, path: rel, check: "none", note: `no check available for ${ext || "this file type"} — skipping` };
  }

  const TOOLS = {
    list_files: toolListFiles,
    search_files: toolSearchFiles,
    read_file: toolReadFile,
    apply_patch: toolApplyPatch,
    git_diff: toolGitDiff,
    undo_change: toolUndoChange,
    reload_ui: toolReloadUi,
    run_check: toolRunCheck,
  };

  // ── SYSTEM PROMPT ─────────────────────────────────────────────────────
  const SYSTEM_PROMPT = `You are Cricket, in EDIT INTERFACE mode inside Gnumbat's own web control panel.

The user is not asking you to control the music instrument right now — they are asking you to change the panel's OWN code (its HTML/CSS/JS), in plain language, without knowing file names or selectors. You have to find where in the code to make the change and make it yourself.

Repo layout you need for this:
${REPO_LAYOUT_TEXT}
All paths you use in tools are relative to the repo root. Even if you get one of these paths slightly wrong, a wrong directory for one of these exact filenames is corrected for you automatically -- but starting from the real path above still saves you a wasted step.

You have exactly these tools. To use one, respond with NOTHING but a single fenced block, exactly like this, with real values:
\`\`\`tool
{"tool": "read_file", "path": "src/gui/panel.html", "offset": 0, "limit": 200}
\`\`\`
- list_files {dir?} — list files under dir (default ".").
- search_files {query, dir?} — plain substring search (case-insensitive) across text files. \`query\` must be a SHORT fragment you expect to find VERBATIM in the source right now (a CSS class like ".webBarCopyright", a bit of visible copy, an id, a function name) — never glue the text you're looking for together with the change you want to make (e.g. searching for "copyright text 200px to the right" will never match anything; that pixel value doesn't exist in the file yet). If a search already gave you a result, don't re-run it with slightly different wording — read_file the match's line instead, or move on with what you have.
- read_file {path, offset?, limit?} — read up to 200 lines at a time. Files are often thousands of lines long — search_files first to find the right spot, then read_file that region.
- apply_patch {path, old_str, new_str, description} — replace old_str with new_str. old_str must match the file EXACTLY (including whitespace/indentation) and must occur exactly once — copy it verbatim from a read_file/search_files result, don't retype it from memory. Keep old_str/new_str as small as does the job; never pass a whole file's contents as one of them.
- git_diff {path?} — show the current uncommitted diff for a file (or the whole repo).
- undo_change {path} — revert a file to just before your last apply_patch on it.
- run_check {path} — sanity-check a file you just edited (syntax check for .js, tag-balance for .html) before telling the user it's done.
- reload_ui {} — tell the open panel to reload so the user can see the change. Call this after any change you want the user to actually see, once you're confident the file is valid.

FINDING A VISUAL/LAYOUT ELEMENT: this codebase's look-and-feel lives in CSS (position, transform, spacing, color), not the HTML text. A two-step search finds it fast and avoids wasted turns: (1) search_files for a short piece of the element's visible text or a nearby distinctive attribute to find the HTML tag and read its class="..." there; (2) search_files for that class name (with a leading "." and opening brace, e.g. ".webBarCopyright{") to jump straight to its CSS rule. Edit the CSS rule for position/spacing/color changes, not the HTML text.

Rules:
1. Inspect before you patch: search_files and/or read_file the relevant area before calling apply_patch, even if you think you already know where it is. Never guess exact text to match.
2. Make the smallest change that satisfies the request. Prefer one or two small apply_patch calls over a rewrite.
3. One tool call per turn — wait for its result before deciding the next step.
4. After a change that affects what's on screen, call run_check and then reload_ui before your final answer.
5. If asked to undo, call undo_change on the file(s) you changed, then reload_ui.
6. Never touch .git, node_modules, data/, any *.bak-* file directly, or anything outside the repo — your tools already refuse these, but don't try either.
7. When you are done (or if the request is unclear enough that you should ask rather than guess), respond in plain prose with NO fenced \`\`\`tool block. That prose is shown to the user as your final answer for this request.
8. Never emit both a \`\`\`tool block and prose in the same reply — a tool call reply contains ONLY the fenced block.
9. NEVER say a change is "done", "fixed", or similar, and never promise to make one, unless you have already called apply_patch (or undo_change) successfully earlier in THIS conversation. Saying it is done without having called the tool is worse than being slow — the user sees a false "done" and the file never changed. If the request needs a file changed and you have not yet called apply_patch, your reply must be a \`\`\`tool block, not prose, even if you are confident about what the change should be.
10. Never repeat a tool call with the same tool AND the same arguments you've already made earlier in this conversation — its result is already above in the history, re-read it instead of asking again. If a search found nothing useful, change your approach (a shorter or different query, a different file, or list_files to see what's actually there) rather than retrying the same one.
11. You have a limited number of tool calls for this request. Budget them: 1-2 searches to locate the spot, 1 read_file to see enough context, 1 apply_patch, then run_check + reload_ui. If you're several calls in and still haven't found the right spot, say so honestly in a final prose reply (per rule 9, only after you've actually tried) rather than continuing to search at random.
12. If the request asks you to match, copy, or make one element the SAME as another ("make A's height the same as B's", "align A with B", "same width as", etc.), you must read_file (or search_files then read_file) the SOURCE element's own CSS rule and see its ACTUAL current value with your own eyes in a tool result before you write anything. Never invent, estimate, round, or reuse a number from a similar-looking rule elsewhere — a value you have not actually just read is a guess, and this kind of request has exactly one correct answer: whatever the source element's real value already is. If the source and target are in different files (see Repo layout above — a request can name one element "-- panel.html" and the other "-- base.html"), read_file BOTH files before touching either.`;

  // ── OLLAMA CALL ───────────────────────────────────────────────────────
  function callOllamaEdit(messages) {
    return new Promise((resolve, reject) => {
      // UPDATE -- user pasted aider's own context-window report for this
      // same model (ollama/qwen2.5-coder:7b): a hard 32,768-token ceiling,
      // with a single file here (panel.html, ~259k tokens whole) already
      // dwarfing it -- read_file's own paging (MAX_READ_LINES_DEFAULT
      // above) already keeps us well under that per call, but nothing
      // here was ever telling OLLAMA to actually GRANT the model's real
      // window; without an explicit options.num_ctx, Ollama silently
      // falls back to its own default (commonly far smaller than what a
      // model can actually do), which would truncate history mid-task on
      // exactly the kind of multi-file, multi-read request (base.html +
      // panel.html together) that's been timing out/hallucinating values.
      // Matches the model's real ceiling explicitly instead of hoping.
      // keep_alive -- without this, Ollama unloads the model from memory
      // 5 minutes (its own default) after the last request. Any edit
      // request that comes in after a >5min gap then pays a full cold
      // model-load penalty (can be many seconds for a 7B model) before
      // generation even starts, on top of the normal per-step generation
      // time. "30m" keeps it resident through normal gaps between edit
      // requests; -1 would never unload it at all, but 30m already covers
      // realistic idle time without permanently pinning the model in RAM
      // if the panel is left open unused overnight.
      const body = JSON.stringify({ model: ollamaModel, messages, stream: false, options: { num_ctx: 32768 }, keep_alive: "30m" });
      const req = http.request(
        {
          hostname: ollamaHost,
          port: ollamaPort,
          path: "/api/chat",
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
          timeout: ollamaTimeoutMs,
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              const reply = json.message && json.message.content;
              if (!reply) { reject(new Error("no response from Ollama — check --ollama-model (" + ollamaModel + ")")); return; }
              resolve(reply);
            } catch (e) {
              reject(new Error("parse error from Ollama: " + e.message));
            }
          });
        }
      );
      req.on("timeout", () => { req.destroy(); reject(new Error("Ollama timed out after " + Math.round(ollamaTimeoutMs / 1000) + "s — model may be overloaded, or this step needed more context than usual (e.g. reading a large file like base.html)")); });
      req.on("error", () => { reject(new Error("Ollama unreachable — is it running? (" + ollamaHost + ":" + ollamaPort + ")")); });
      req.write(body);
      req.end();
    });
  }

  // Extracts a ```tool fenced block. Returns:
  //   null                     — no fenced block at all (reply is a final answer)
  //   { call: {...} }          — parsed successfully
  //   { parseErr: "message" }  — a fenced block was present but invalid
  // Confirmed happening in practice (user screenshot): a reply like
  // "I have not called apply_patch yet. I need to inspect the text
  // first." followed by an UNFENCED {"tool": "read_file", ...} JSON
  // object -- correct intent, correct JSON, but no ``` fence around it.
  // The old fenced-only regex found nothing, so the whole reply
  // (the explanation plus the tool call it never ran) fell through to
  // editReply as a "final answer" and nothing ever happened.
  // extractBareToolJson() is the fallback for exactly that case: a
  // small local model narrating in prose and then just writing the
  // JSON object unfenced. String-aware (tracks quotes/escapes) so
  // braces inside an old_str/new_str value (routine for CSS/JS text)
  // do not throw off the balance count.
  function extractBareToolJson(reply) {
    if (!reply) return null;
    const keyIdx = reply.indexOf('"tool"');
    if (keyIdx === -1) return null;
    const start = reply.lastIndexOf("{", keyIdx);
    if (start === -1) return null;
    let depth = 0, inString = false, escape = false;
    for (let i = start; i < reply.length; i++) {
      const c = reply[i];
      if (inString) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return reply.slice(start, i + 1);
      }
    }
    return null; // unbalanced -- likely truncated, let JSON.parse below fail with a clear error instead
  }

  function extractToolCall(reply) {
    const m = /```(?:tool|json)?\s*\n?([\s\S]*?)```/i.exec(reply || "");
    let raw;
    if (m) {
      raw = m[1].trim();
    } else {
      raw = extractBareToolJson(reply);
      if (raw === null) return null; // truly no tool call in this reply -- a final answer
    }
    try {
      const call = JSON.parse(raw);
      if (!call || typeof call.tool !== "string") return { parseErr: "the tool call must be a JSON object with a \"tool\" field" };
      return { call };
    } catch (e) {
      return { parseErr: "the tool call JSON was not valid: " + e.message };
    }
  }

  function summarizeStep(call, result) {
    const okPart = result && result.ok === false ? "failed" : "ok";
    if (call.tool === "read_file") return `read_file ${call.path} (${okPart})`;
    if (call.tool === "search_files") return `search_files "${call.query}" (${okPart})`;
    if (call.tool === "list_files") return `list_files ${call.dir || "."} (${okPart})`;
    if (call.tool === "apply_patch") return `apply_patch ${call.path} — ${call.description || ""} (${okPart})`;
    if (call.tool === "undo_change") return `undo_change ${call.path} (${okPart})`;
    if (call.tool === "git_diff") return `git_diff ${call.path || "."} (${okPart})`;
    if (call.tool === "run_check") return `run_check ${call.path} (${okPart})`;
    if (call.tool === "reload_ui") return `reload_ui (${okPart})`;
    return `${call.tool} (${okPart})`;
  }

  // One shared conversation, same "one instrument, one operator" simplicity
  // gui_hub_bridge.js's own console chatHistory already uses — this hub
  // serves one local panel/user, not a multi-tenant service.
  let editHistory = [{ role: "system", content: SYSTEM_PROMPT }];
  let editThinking = false;

  // Corrective nudge for the failure mode this was added to fix: a small
  // local model replying "done"/"sure, I'll do that" in plain prose on
  // the very first turn without ever calling apply_patch (or undo_change)
  // -- confirmed happening in practice (user: "i see the thinking, i see
  // the done message, but nothing changed" -- zero .bak files and zero
  // "edit-agent:" log lines proved no tool had actually run). Given once
  // per request, not once globally, and only fires if no file-mutating
  // tool has succeeded yet this request.
  const NUDGE_TEXT = "Before you answer: have you actually called apply_patch (or undo_change) yet in this conversation to make this specific change, or are you only describing/promising it? If the user's request needs a file changed and you have not yet called apply_patch, do NOT say it is done -- emit a \`\`\`tool block now (read_file/search_files first if you still need the exact text to match) instead of prose. If this request genuinely needs no file change, you may give the same answer again as plain prose.";

  // Second failure mode observed in practice (user screenshot): the
  // model correctly found the right CSS rule via search_files/read_file
  // with several tool calls still to go, then kept re-reading/searching
  // instead of ever committing to apply_patch, and ran out of budget --
  // "(stopped after 14 steps ...)" with zero .bak files. URGENCY_AT is
  // how many calls from the end this forcing nudge kicks in: once, and
  // only if nothing has been changed yet, it tells the model plainly to
  // stop exploring and act on what it already has.
  const URGENCY_AT = 3;
  function urgencyText(remaining) {
    return "You have only " + remaining + " tool call(s) left before this request times out, and you have not changed any file yet. Stop searching or re-reading now -- use the exact text you already saw in an earlier read_file/search_files result above and call apply_patch with it immediately. A failed apply_patch (old_str not found) still tells you exactly what to fix on your very next call, which is far better than running out having never tried.";
  }

  function trimHistory() {
    if (editHistory.length <= MAX_HISTORY_MESSAGES + 1) return;
    editHistory = [editHistory[0]].concat(editHistory.slice(-MAX_HISTORY_MESSAGES));
  }

  async function handleEditChat(text, replyTo) {
    if (editThinking) {
      replyTo({ t: "editError", msg: "still working on the last request — one at a time" });
      return;
    }
    editThinking = true;
    replyTo({ t: "editThinking" });
    // UPDATE -- user: "its so long... its not normal, it has the path
    // directly [already found what it needed]" on a request that then
    // went on to search "inferior corners" and re-read panel.html --
    // completely unrelated to the base.html height-matching task it was
    // actually given. Root cause: editHistory was declared ONCE at module
    // scope and NEVER reset between separate user requests -- every
    // request you've ever typed in edit mode, across the entire life of
    // the server process, piled into one ever-growing conversation, only
    // pruned by trimHistory()'s trailing-N-message window (see
    // MAX_HISTORY_MESSAGES's own comment). "inferior corners" was a
    // completely different, much earlier edit (the #editModeFrame border-
    // radius one) -- still sitting inside that trailing window, bleeding
    // into a request that had nothing to do with it. Each request is its
    // own task with its own correct answer; there's no real benefit to
    // remembering unrelated past tasks, only the cost of confusing a
    // small model (and burning context budget -- see callOllamaEdit's own
    // num_ctx comment) with irrelevant history. Fresh system-prompt-only
    // history per request fixes both at once.
    editHistory = [editHistory[0]];
    editHistory.push({ role: "user", content: text });
    let madeFileChange = false;
    let nudgedOnce = false;
    let urgencyNudged = false;

    try {
      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        const remaining = MAX_TOOL_ITERATIONS - i;
        if (!madeFileChange && !urgencyNudged && remaining <= URGENCY_AT) {
          urgencyNudged = true;
          broadcast({ t: "editStep", tool: "_urgency", args: {}, ok: true, summary: "running low on steps -- pushing cricket to commit to a change now" });
          editHistory.push({ role: "user", content: urgencyText(remaining) });
        }
        trimHistory();
        let reply;
        try {
          reply = await callOllamaEdit(editHistory);
        } catch (e) {
          replyTo({ t: "editError", msg: e.message });
          editThinking = false;
          return;
        }
        editHistory.push({ role: "assistant", content: reply });

        const parsed = extractToolCall(reply);
        if (parsed === null) {
          if (!madeFileChange && !nudgedOnce) {
            nudgedOnce = true;
            broadcast({ t: "editStep", tool: "_nudge", args: {}, ok: true, summary: "cricket answered without changing anything yet -- double-checking" });
            editHistory.push({ role: "user", content: NUDGE_TEXT });
            continue;
          }
          replyTo({ t: "editReply", text: reply.trim() });
          editThinking = false;
          return;
        }
        if (parsed.parseErr) {
          editHistory.push({ role: "user", content: "TOOL ERROR: " + parsed.parseErr });
          continue;
        }

        const call = parsed.call;
        const tool = TOOLS[call.tool];
        let result;
        if (!tool) {
          result = { ok: false, error: `unknown tool "${call.tool}" — available tools: ${Object.keys(TOOLS).join(", ")}` };
        } else {
          try {
            result = tool(call);
          } catch (e) {
            result = { ok: false, error: e.message };
          }
        }
        post("edit-agent: " + summarizeStep(call, result));
        broadcast({ t: "editStep", tool: call.tool, args: call, ok: result.ok !== false, summary: summarizeStep(call, result) });
        if ((call.tool === "apply_patch" || call.tool === "undo_change") && result && result.ok !== false) {
          madeFileChange = true;
        }

        let resultJson = JSON.stringify(result);
        if (resultJson.length > MAX_TOOL_RESULT_CHARS) {
          resultJson = resultJson.slice(0, MAX_TOOL_RESULT_CHARS) + '..."(truncated)"';
        }
        editHistory.push({ role: "user", content: `TOOL RESULT for ${call.tool}:\n${resultJson}` });
      }
      replyTo({ t: "editReply", text: `(stopped after ${MAX_TOOL_ITERATIONS} steps to avoid a runaway loop — tell me to continue if more is needed, or ":undo" the last change if something's wrong)` });
    } finally {
      editThinking = false;
    }
  }

  // ── EDIT-MODE COMMITS ("branches network") ────────────────────────────
  // user: "When editing a page with edit mode, the system must ask the user
  // to commit and name that branch. So when entering edit mode, a new tab
  // must be created next to ^E. Create ^R to commit changes into a new
  // branch." / "The branches created from editing the website would appear
  // on the network tab."
  //
  // Model (deliberately git-like, and deliberately NOT the older
  // createBranch()/activeBranchDir redirect above -- that one hides edits
  // in a copy the running page never serves, which defeats a live-preview
  // edit mode): Cricket keeps editing the real files in place, so the panel
  // reloads and shows each change. A COMMIT snapshots the current contents
  // of the frontend files into src/gui/branches/<id>/ and records a named
  // branch whose parent is whatever the working copy was on before (the
  // seed, "Gnumbat AGPL 3.0", until the first commit). The seed's own
  // snapshot is taken the first time edit mode is entered, i.e. before the
  // first edit of a session, so it always exists to diff against and
  // restore from. "Dirty" = the live files no longer hash the same as the
  // snapshot of the branch the working copy is on.
  // Metadata lives in src/gui/branches/branches.json; snapshots are plain
  // file copies, same "simple and obviously correct" reasoning the .bak
  // files already use. This is a snapshot list, not a merge engine --
  // mergeBranch() above is untouched and still the only merge path.
  const BRANCH_FILES = BRANCHABLE_RELPATHS.concat(["src/backend/event-crawler/frontend/base.html"]);
  const BRANCH_ROOT = path.join(repoRoot, "src/gui/branches");
  const BRANCH_MANIFEST = path.join(BRANCH_ROOT, "branches.json");
  const SEED_ID = "gnumbat-agpl-3.0";
  const SEED_NAME = "Gnumbat AGPL 3.0";

  function fileHash(full) {
    try { return crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex"); }
    catch (e) { return null; }
  }
  function currentHashes() {
    const h = {};
    for (const rel of BRANCH_FILES) h[rel] = fileHash(path.join(repoRoot, rel));
    return h;
  }
  function loadBranchManifest() {
    try {
      const m = JSON.parse(fs.readFileSync(BRANCH_MANIFEST, "utf8"));
      if (m && m.seed && Array.isArray(m.branches)) return m;
    } catch (e) { /* first run, or unreadable -> start clean */ }
    return { seed: { id: SEED_ID, name: SEED_NAME, hashes: null }, branches: [], head: SEED_ID };
  }
  function saveBranchManifest(m) {
    fs.mkdirSync(BRANCH_ROOT, { recursive: true });
    fs.writeFileSync(BRANCH_MANIFEST + ".tmp", JSON.stringify(m, null, 2));
    fs.renameSync(BRANCH_MANIFEST + ".tmp", BRANCH_MANIFEST);
  }
  function copySnapshot(dirName) {
    const dir = path.join(BRANCH_ROOT, dirName);
    fs.mkdirSync(dir, { recursive: true });
    for (const rel of BRANCH_FILES) {
      const src = path.join(repoRoot, rel);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, path.basename(rel)));
    }
  }
  function headHashes(m) {
    if (m.head === m.seed.id) return m.seed.hashes;
    const os = (m.otherSeeds || []).find((s) => s.id === m.head);
    if (os) return os.hashes;
    const b = m.branches.find((x) => x.id === m.head);
    return b ? b.hashes : m.seed.hashes;
  }
  function changedFiles(m) {
    const base = headHashes(m);
    if (!base) return [];
    const cur = currentHashes();
    return BRANCH_FILES.filter((rel) => (base[rel] || null) !== (cur[rel] || null));
  }
  // Called when the panel enters edit mode: makes sure the seed snapshot
  // exists (taken BEFORE this session's first edit), then reports state.
  function editBegin() {
    const m = loadBranchManifest();
    if (!m.seed.hashes) {
      copySnapshot(SEED_ID);
      m.seed.hashes = currentHashes();
      m.seed.createdAt = new Date().toISOString();
      saveBranchManifest(m);
    }
    return editStateFrame();
  }
  function editStateFrame() {
    const m = loadBranchManifest();
    const files = changedFiles(m);
    const head = m.head === m.seed.id ? m.seed : (m.branches.find((x) => x.id === m.head) || m.seed);
    return { t: "editState", dirty: files.length > 0, changed: files, head: head.id, headName: head.name };
  }
  function branchesFrame() {
    const m = loadBranchManifest();
    return {
      t: "branches",
      seed: { id: m.seed.id, name: m.seed.name },
      // SEVERAL SEEDS -- user: "there might other seeds in the system if
      // friends create other services in this system. such as a booking page
      // for sound systems." branches.json may carry extra seeds in
      // "otherSeeds" ([{id, name, hashes, createdAt}], snapshot folder
      // branches/<id>/ like any branch); each one roots its own tree on the
      // network page. Gnumbat AGPL 3.0 stays the first.
      seeds: [{ id: m.seed.id, name: m.seed.name }].concat((m.otherSeeds || []).map((s) => ({ id: s.id, name: s.name }))),
      branches: m.branches.map((b) => ({ id: b.id, name: b.name, parent: b.parent, createdAt: b.createdAt })),
      head: m.head,
    };
  }
  // Throws (message shown to the user) when there is nothing to commit or
  // the name is unusable; otherwise snapshots and records the new branch.
  function commitBranch(rawName) {
    const name = String(rawName == null ? "" : rawName).replace(/\s+/g, " ").trim();
    if (!name) throw new Error("a branch needs a name");
    if (name.length > 60) throw new Error("branch name is too long (60 characters max)");
    const m = loadBranchManifest();
    if (!m.seed.hashes) throw new Error("no baseline yet -- enter edit mode (^E) and make a change first");
    const files = changedFiles(m);
    if (!files.length) throw new Error("nothing to commit -- no edits since " + (m.head === m.seed.id ? "the seed" : "the last commit"));
    if (m.branches.some((b) => b.name.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === m.seed.name.toLowerCase()) {
      throw new Error('a branch called "' + name + '" already exists -- pick another name');
    }
    let id = slugify(name);
    if (id === SEED_ID || m.branches.some((b) => b.id === id) || fs.existsSync(path.join(BRANCH_ROOT, id))) {
      let i = 2;
      while (m.branches.some((b) => b.id === id + "-" + i) || fs.existsSync(path.join(BRANCH_ROOT, id + "-" + i))) i++;
      id = id + "-" + i;
    }
    copySnapshot(id);
    const branch = { id, name, parent: m.head, createdAt: new Date().toISOString(), hashes: currentHashes(), files };
    m.branches.push(branch);
    m.head = id;
    saveBranchManifest(m);
    post("edit-mode commit -> branch '" + name + "' (" + id + "), " + files.length + " file(s), parent " + branch.parent);
    return { id, name, parent: branch.parent, files };
  }

  // ENTER A BRANCH -- network page (^N): "when you enter a branch, you enter
  // its system." Restores that branch's snapshot (or the seed's) over the
  // working files and makes it the head. Refuses while there are edits that
  // aren't committed yet, so nothing is ever overwritten without a snapshot.
  function enterBranch(rawId) {
    const id = String(rawId == null ? "" : rawId);
    const m = loadBranchManifest();
    const isSeed = id === m.seed.id || (m.otherSeeds || []).some((s) => s.id === id);
    const b = id === m.seed.id ? m.seed : ((m.otherSeeds || []).find((s) => s.id === id) || m.branches.find((x) => x.id === id));
    if (!b) throw new Error("no seed or branch with that id");
    if (id === m.head) return { id, name: b.name, already: true };
    if (!b.hashes) throw new Error((isSeed ? '"' + b.name + '" has' : "this branch has") + " no snapshot yet -- enter edit mode (^E) once to take it");
    const dirty = changedFiles(m);
    if (dirty.length) throw new Error("there are edits that aren't committed (" + dirty.map((f) => path.basename(f)).join(", ") + ") -- commit them with ^R first");
    const dir = path.join(BRANCH_ROOT, id);
    for (const rel of BRANCH_FILES) {
      const src = path.join(dir, path.basename(rel));
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(repoRoot, rel));
    }
    m.head = id;
    saveBranchManifest(m);
    post("network -> entered branch '" + b.name + "' (" + id + ")");
    return { id, name: b.name };
  }

  return {
    handleEditChat, TOOLS, resolveSafe, getCurrentBranch, createBranch, mergeBranch,
    editBegin, editStateFrame, branchesFrame, commitBranch, enterBranch,
  };
}

module.exports = { createEditAgent };
