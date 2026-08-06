function visWidth(s){return s.length;}
const _C = 40;
const _r = (sig, desc) => sig.length >= _C ? sig + "  " + desc : sig.padEnd(_C) + desc;
const CMD_SECTIONS = [
  { title: 'view', rows: [
    _r(':showState',                               'print state'),
    _r(':showCommands',                            'toggle this panel'),
    _r(':resetPeaks',                              'clear peak-hold markers'),
  ]},
  { title: 'cricket / memory', rows: [
    _r(':language',                                'toggle language panel'),
    _r(':chat',                                    'maximize/un-maximize chat'),
    _r(':memory',                                  'report memory saturation'),
    _r(':memory clear',                            'wipe chat memory (2-step)'),
  ]},
  { title: 'playback', rows: [
    ':start  ·  :stop',
    _r(':applyNow',                                'reroll all 4 stems now'),
    _r(':next [vocals|melody|bass|drums]',         'force next slice'),
    _r(':selectSegment vocals|melody|bass|drums',  'queue next slice'),
    _r(':loop <stem> <bars>',                      'loop stem N bars'),
    _r(':unloop <stem>',                           'release loop'),
    _r(':unloopAll',                               'release all loops'),
    _r(':lockSource <leader> <follower...>',       'follower(s) copy leader source'),
    _r(':lockSource all [leader]',                 'lock all to one leader'),
    _r(':unlockSource <stem|all>',                 'release source lock'),
    _r(':setStemSource <stem|all> <name>',         'pin stem to source (match)'),
    _r(':setStemSource <stem|all> clear',          'release pin'),
  ]},
  { title: 'index', rows: [
    _r(':buildIndex',                              'rebuild slice index'),
    _r(':loadIndex',                               'load cached index'),
    _r(':saveIndex',                               'save index to cache'),
    _r(':nextTrack / :prevTrack',                  'browse track bank'),
    _r(':reloadDownbeats',                         'reload downbeats.json'),
    _r(':info',                                    'dump state to console'),
    _r(':reset',                                   'clear index + stop'),
    _r(':resetMemory',                             'wipe analysis JSON (2-step)'),
    _r(':restartWatcher',                          'restart watch_demucs'),
    _r(':switchSession [name] / :logout',          'switch or leave session'),
    _r(':bakeloop <bars>',                           'set checkpoint window'),
    _r(':bake start [bars] <prompt>',                'open bake bracket'),
    _r(':bake show',                                 'show current bracket'),
    _r(':bake edit <n> <command...>',                'replace bracket line n'),
    _r(':bake remove <n>',                           'drop bracket line n'),
    _r(':bake sequence name:bars [name:bars ...]',   'open sequence bracket'),
    _r(':bake end [name]',                           'queue bracket close'),
    _r(':bake abort',                                'discard bracket now'),
    _r(':bakeState list',                            'list saved states'),
    _r(':bakeState show <name>',                     'show saved state'),
    _r(':bakeState apply <name>',                    'apply saved state live'),
    _r(':bakeState drop <name>',                     'delete saved state'),
  ]},
  { title: 'train (training + review)', rows: [
    '{grey-fg}  ^C chat  ·  ^T train  ·  ^R training/review  ·  ^B next bake  ·  ^L log out{/grey-fg}',
    _r(':train',                                     'toggle the training screen (^T)'),
    _r(':train training',                            'sub-menu: live bake bracket'),
    _r(':train review',                              'sub-menu: browse past bakes'),
    _r(':train source bakes|states',                 'review: switch data source'),
    _r(':train next / :train prev',                  'review: browse sessions'),
    _r(':train play / :train stop',                  'review: play/stop this session\'s audio'),
    _r(':train approve',                             'review: keep this bake for training'),
    _r(':train exclude',                             'review: drop this bake from training'),
    _r(':train edit <n> <command...>',               'review: replace final_cmds line n'),
    _r(':train remove <n>',                          'review: drop final_cmds line n'),
    _r(':train add <command...>',                    'review: append a final_cmds line'),
    _r(':scoreLyr <-1..1> [overallSection]',         'score current combo'),
    _r(':scoreTrs <-1..1> [stem]',                   'score last cut'),
    _r(':tag <label> [stem]',                        'tag current bar-range'),
    _r(':listSections [track]',                      'list structure tags'),
    _r(':trainBias',                                 'fit bias models'),
    _r(':reloadBias',                                'reload learned bias'),
    _r(':setLearnedWeight <stem|all> <transition|vertical> <0-5>', 'scale learned model use'),
    _r(':resetAll',                                '⚠ wipe everything (Y/N)'),
    _r(':analyzeAll',                              'run genre + beat analysis'),
    _r(':tagBeats',                                'run beat tagger only'),
    _r(':setMMT <bars>',                           'momentum window size'),
  ]},
  { title: 'trigger pads', rows: [
    _r(':triggerMode <stem|all> 0|1',              '0=auto  1=manual fire'),
    _r(':trigger [stem]',                          'fire next slice'),
    '{grey-fg}  C-1/C-2/C-3/C-4{/grey-fg}   fire vocals/melody/bass/drums',
  ]},
  { title: 'slicing', rows: [
    _r(':chunkMode [stem] 0|1',                    '0=full file  1=bar chunks'),
    _r(':skip <stem>',                             'jump to new file'),
    _r(':setSegmentBars [stem] 0.5|1|2|4|8|16|32', 'bars/slice, sets chunkMode 1'),
    _r(':returnToBase [stem|all]',                 'snap back to base mix'),
    _r(':setStayProb [stem] 0.0–1.0',             '0=jump  1=loop'),
    _r(':setSrcWeights <bpm> <cohesion> [key]',    'source-track prob weights'),
    _r(':setQuantize 0|1',                         'bar-locked cuts'),
    _r(':setMaxSlices N',                          'cap slices/stem'),
    _r(':setWindow hann|hamming|blackman|triangle|rect', 'FFT window, pitch shifter'),
  ]},
  { title: 'tempo', rows: [
    '{grey-fg}  pitch/BPM affect audio live; rest waits for next slice{/grey-fg}',
    _r(':setFallbackBPM 40–280',                   'fallback tempo, live'),
    _r(':setGlobalBPM 40–280',                     'BPM override, live'),
  ]},
  { title: 'matching', rows: [
    _r(':setWeight <stem|all> C|S|E|F|P|H|T 0–5',  'descriptor weight'),
    _r(':setMatchProb <stem|all> 0–1',             'transition tightness'),
    _r(':setDirPref <stem|all> C|S|E|F|P|H|T|D -1–1', 'direction bias'),
    _r(':setDirWeight <stem|all> 0–5',             'direction bias strength'),
    _r(':wmdScope all|vocals|melody|bass|drums',   'which stem header shows'),
    _r(':setTrackWeight vocals|melody|bass|drums', 'stem influence 0–1'),
    _r(':followStem <stem> <dim> <target> <w> …', 'that dim follows another stem'),
    _r(':followStem <stem> all <target> <w> …',   'every dim follows another stem'),
    _r(':followStem <stem> <dim> self',            'reset just that dimension'),
    _r(':followStem <stem> self',                  'reset every dimension'),
    _r(':setEntropy 0–1',                          'order↔chaos macro'),
  ]},
  { title: 'audio', rows: [
    _r(':fader <stem|all> <0–1>',                 'channel level'),
    _r(':trim <stem|all> <dB>',                   'input gain'),
    _r(':mute <stem|all> 0|1',                    '0=unmute  1=mute'),
    _r(':solo <stem|all> 0|1',                    '0=off  1=on'),
    _r(':master <0–1>',                           'master gain'),
    _r(':eqLow <stem|all> <dB>',                  'low shelf gain'),
    _r(':eqMid <stem|all> <dB>',                  'mid bell gain'),
    _r(':eqMidFreq <stem|all> <Hz>',              'mid bell center'),
    _r(':eqHigh <stem|all> <dB>',                 'high shelf gain'),
  ]},
  { title: 'spatial', rows: [
    _r(':width <stem|all|master> <0–1>',          'stereo width'),
    _r(':joystick <stem|all> <x> <y>',            '2D pan'),
    _r(':masterJoystick <x> <y>',                 '2D pan (master)'),
    _r(':pan <stem|all> 0–360',                    'quad rotation angle'),
    _r(':analysisMode on|off',                    'auto width from analysis'),
  ]},
  { title: 'FX & outputs', rows: [
    _r(':fx <stem> <0–1>',                        'FX send/return level'),
    _r(':fxSwitch <1|2> <0|1>',                   '0=stem  1=live input'),
    _r(':monoSend <stem|all> on|off',             'mono sum for FX send'),
    _r(':boothGain <0–1>',                        'monitor level'),
    _r(':recGain <0–1>',                          'recording level'),
    _r(':record start [name]',                    'start recording'),
    _r(':record stop',                            'stop recording'),
    _r(':pitchShift <stem> <semitones>',          'pitch shift'),
    _r(':formantShift <stem> <semitones>',        'formant shift, independent of pitch'),
    _r(':setShiftBand <stem> <loHz> <hiHz>',       'shared pitch+formant band limit'),
    _r(':setPitchBand <stem> <loHz> <hiHz>',       'pitch-only band override'),
    _r(':setFormantBand <stem> <loHz> <hiHz>',     'formant-only band override'),
    _r(':clearPitchBand <stem>',                   'drop pitch band override'),
    _r(':clearFormantBand <stem>',                 'drop formant band override'),
    _r(':clearShiftBand <stem>',                   'reset shared band, clear overrides'),
  ]},
  { title: 'filters', rows: [
    _r(':setGenreFilter <genre>',                  'restrict to genre'),
    _r(':clearGenreFilter',                        'remove genre filter'),
    _r(':listGenres',                              'list genre tags'),
    _r(':setKeyFilter <key>',                      'restrict to key'),
    _r(':clearKeyFilter',                          'remove key filter'),
  ]},
  { title: 'query', rows: [
    _r(':dumpDescriptors [stem]',                  'dump slice descriptors'),
    _r(':selectRange [stem] C:lo,hi W:lo,hi E:lo,hi F:lo,hi P:lo,hi', 'pick slice in range'),
    _r(':nextNearest <stem> <C> <E> <F> <P>',      'jump to closest slice'),
  ]},
  { title: 'link (multi-deck sync)', rows: [
    _r(':link on | off',                           'legacy UDP peer sync'),
    _r(':link status',                             'show connected decks'),
    _r(':link mode avoid|mirror|complement|off',   'how decks react'),
    _r(':link arm',                                'arm missile switch'),
    _r(':link fire',                               'fire armed switch'),
    _r(':link abort',                              'disarm without firing'),
    _r(':link token <hex>',                        'set session token'),
  ]},
  { title: 'tipping session (payouts — NOT your login session)', rows: [
    _r(':tipOpen <djId> <venue> web|venue [deck]', 'open tipping session'),
    _r(':tipClose',                                'close tipping session'),
    _r(':tip',                                     'dry-run split %'),
    _r(':tip <username> <amount>',                 'simulate incoming tip'),
    _r('  ↳ login session?',                       'use :switchSession/:logout'),
  ]},
];
function plainWidth(line) { return visWidth(line.replace(/\{[^}]+\}
function padVisible(line, width) {
  return line + ' '.repeat(Math.max(0, width - plainWidth(line)));
}
function sectionContentWidth(sec) {
  return sec.rows.reduce((m, r) => Math.max(m, plainWidth(r)), sec.title.length + 4);
}
function packCmdColumns(numCols) {
  const cols = Array.from({ length: numCols }, () => ({ sections: [], rowCount: 0 }));
  // Column WIDTH is a max() over its sections, not a sum — so what actually
  // blows the width budget is two wide sections landing in the SAME column,
  // not wide sections existing at all. Placing widest-first (while every
  // column's rowCount is still 0 or low) spreads those few outlier-width
  // sections — the ones with a long command signature or long description,
  // like formantShift's — across different columns before height-balancing
  // takes over for the rest. Packing in original order instead (as this
  // used to) reliably let two wide sections collide in one column, which
  // silently forced the whole layout down to fewer columns than the
  // terminal actually had room for.
  const byWidthDesc = CMD_SECTIONS
    .map((sec, idx) => ({ sec, idx }))
    .sort((a, b) => sectionContentWidth(b.sec) - sectionContentWidth(a.sec));
  byWidthDesc.forEach(({ sec }) => {
    const weight = sec.rows.length + 2; // +1 header row, +1 blank spacer after
    let target = cols[0];
    for (const c of cols) if (c.rowCount < target.rowCount) target = c;
    target.sections.push(sec);
    target.rowCount += weight;
  });
  // Restore original top-to-bottom reading order within each column —
  // widest-first was only for the placement DECISION above.
  cols.forEach(c => c.sections.sort((a, b) => CMD_SECTIONS.indexOf(a) - CMD_SECTIONS.indexOf(b)));
  return cols;
}
function renderCmdColumnLines(col, colWidth) {
  const lines = [];
  col.sections.forEach((sec, i) => {
    if (i > 0) lines.push('');
    const dashes = Math.max(0, colWidth - (sec.title.length + 4));
    lines.push('── ' + sec.title + ' ' + '─'.repeat(dashes));
    sec.rows.forEach(r => lines.push(padVisible(r, colWidth)));
  });
  return lines;
}
const CMD_COL_GAP = 3;
const CMD_MAX_COLS = 4;
function buildCmdColumns(width) {
  let cols, colWidths;
  for (let n = CMD_MAX_COLS; n >= 1; n--) {
    const candidateCols = packCmdColumns(n);
    const candidateWidths = candidateCols.map(c =>
      c.sections.reduce((m, sec) => Math.max(m, sectionContentWidth(sec)), 0));
    const totalW = candidateWidths.reduce((a, b) => a + b, 0) + CMD_COL_GAP * (n - 1);
    if (totalW <= width || n === 1) { cols = candidateCols; colWidths = candidateWidths; break; }
  }

  const colLines = cols.map((c, i) => renderCmdColumnLines(c, colWidths[i]));
  const maxRows  = Math.max(0, ...colLines.map(l => l.length));
  const lastCol  = colLines.length - 1;
  const merged = [];
  for (let r = 0; r < maxRows; r++) {
    const parts = colLines.map((lines, c) => {
      const line = lines[r] || '';
      return c === lastCol ? line : padVisible(line, colWidths[c]);
    });
    merged.push(parts.join(' '.repeat(CMD_COL_GAP)));
  }

  return ['', 'command list', '', ...merged].map(l => `{grey-fg}${l}{/grey-fg}`).join('\n');
}
module.exports = { buildCmdColumns, packCmdColumns, sectionContentWidth, CMD_SECTIONS, CMD_MAX_COLS };
