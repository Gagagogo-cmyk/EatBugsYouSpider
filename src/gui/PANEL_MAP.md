# panel.html — structural map

Auto-generated index of `gui/panel.html` (Gnumbat plugin panel GUI). Purpose:
let an assistant find "where is X" by line number via grep on this file
instead of reading all of panel.html.

**This file goes stale the moment panel.html is edited** (line numbers shift).
Regenerate it after any nontrivial edit rather than trusting old numbers —
treat line numbers here as "approximate, verify with grep -n before editing".
Last regenerated after the 2026-09-15 session's fifth round of fixes.
Rounds so far, in order: (1) model-select rework (Integrate/Replant/
Upvote/Downvote removed, Signals column split, arbitrary-depth branching,
click-the-arrow voting); (2) reentrant-blur bug in model/bake rename fixed,
edit mode no longer force-opens chat, edit frame thinner, top-bar active
tab bolder, vote arrows back to ↑/↓, #posterize3 whitelists literal red for
the DJ dot; (3) the ACTUAL fix for "add one or two branches/seeds and the
system glitches" — two more bugs found by empirically running the page in
a real browser (not just reading the code): a Ctrl+N/^B event-propagation
leak to an unrelated global "toggle city modal" listener (needed capture
phase, not just stopPropagation — see §5e), and the rename `<input>`'s own
keydown handler swallowing Ctrl+N/^B unless Enter was pressed first (now
chains directly into the next create instead); (4) `#editModeFrame` border-
radius on its bottom two corners, thinned to 3px; (5) edit mode now locks
pointer-events to ONLY the chat/console box (Cricket's own UI) — everything
else on the page is unclickable while editing; the chat/console demarcator
line + "chat"/"console" title are gone in both open and closed states;
`#djPanel` moved from a floating overlay on G-ANS's top-right corner to a
normal flow section directly BELOW it, gained a live search box, and lost
the browse-all/discover-in-place feature entirely (search replaces it);
the active-tab pill's text ([CRKT]/M-RLCF when selected) is literal black
now, not grey; `#editModeFrame`'s corner radius went 10px → 20px; and the
last few incidental (non-selection-state) white backgrounds in the file —
`.webInput` (username/password fields), `.webBar .chip b` (dead CSS, no
matching element currently renders), `.npThumb` (now-playing placeholder)
— are black now too. Deliberately-white SELECTION-state backgrounds
(`.siteTab.on`, `.arr-lane-added .lbl`, `.brow.sel`, etc.) were left alone
— each has its own explicit "make this one white" UPDATE comment from an
earlier round, so flipping them would silently undo a separate, still-
current request rather than fix an oversight.

## What panel.html is

A single-file HTML/CSS/JS GUI ("LIVE" build) for a DAW-style audio plugin
panel (codename Gnumbat / EBYS). It's wired to the instrument at runtime via
two sibling files loaded at the top/bottom of `<body>`:
- `ebys-link.js` (transport layer, loaded line ~6959, before the main `<script>`)
- `ebys-live.js` (paints live telemetry over the seeded mock state, loaded
  at the very end, line ~15971)

Written as one continuously-edited mockup: the huge inline `<style>` and
`<script>` blocks carry extensive prose comments recording *why* things are
the way they are, including ~117 dated "UPDATE — user: '...'" comments that
form a running changelog of user-requested tweaks (see §6). These comments
are often more valuable than the code itself when deciding how to safely
change something — grep for a feature name first and read the surrounding
comment before editing.

## 1. File layout (top-level line ranges)

| Lines | Content |
|---|---|
| 1-5 | `<!doctype>`, `<html>`, `<head>`, `<title>` |
| 6-5549 | `<style>` … `</style>` — all CSS (~5500 lines), including the `#posterize3` SVG `<filter>` definition (~L5616, inside `<body>`'s own inline `<svg>`, not `<head>` — see §1 note) |
| 5551-6958 | `<body>` markup (static HTML skeleton; most dynamic UI is JS-rendered into empty containers) |
| 6974 | `<script src="ebys-link.js">` |
| 6975-15855 | main inline `<script>` — nearly all app logic |
| 15855-15924 | small inline `<script>` — Safari cursor-refresh "kick" |
| 15924-16029 | small inline `<script>` — click-feedback cursor override |
| 16030 | `<script src="ebys-live.js">`, `</body>` |

Note: the `#posterize3` `<filter>` SVG lives in `<body>` (an inline
`<svg width="0" height="0">`), not `<head>` — it's referenced by
`.plugin{filter:url(#posterize3)}` (CSS, ~L468) and is the single filter
every visible pixel in `.plugin` renders through: saturate(0) + 3-band
discrete quantize (black/grey/white) by default, PLUS (as of the
2026-09-15 session) a small whitelist chain that lets literal red survive
instead of being crushed to grey — see that `<filter>`'s own UPDATE
comment for the mechanism, and §5e below for what uses it.

Sibling files in `gui/`: `ebys-link.js`, `ebys-live.js`, `gui_hub_bridge.js`,
`edit_agent.js`, `arrangement-view.html`. There are also MANY
`panel.html.bak-*` timestamped snapshots in this folder from past sessions
(and a `_to_delete/` subfolder) — never confuse these with the live
`panel.html`, and don't index them.

## 2. CSS custom properties (theme variables)

Three `:root{}` blocks in cascade order (base palette ~L56, a small
`--stemLaneW/--stemLaneGap` override ~L1717, a later bevel/palette override
~L4000). Search `var(--` for consumers, `--tokenName:` for declarations.

Also note: `.plugin,.plugin *{font-size:var(--fs)!important;font-weight:400!important}`
(~L296) is a blanket "no bold anywhere" reset with `!important` — any
future bold/weight exception (like `.siteTab.on`, see §3) must also use
`!important` plus at least as much selector specificity, or it will
silently be overridden and have no visible effect.

## 3. CSS selector index (~719 rules, style block lines 6-5549)

Flat list of every rule-opening line (`selector{`), in file order. Grep the
line range in panel.html to see the declarations — this is not the rule
bodies.

```
56: :root{
255: *{
270: html,body{
293: html{
294: body{
296: .plugin,.plugin *{
312: .disconnected{
316: .disconnected.hide{
462: .plugin{
515: .webBar{
543: .webBarLeft {
576: .siteTab{
577: .siteTab:hover{
587: *{
594: .siteTab.on{
614: #omgmView{
621: #omscView{
645: #modelSelectView{
661: .modelSelectBody{
704: .brow.modelListRow,.modelListHead{
706: .modelListRow>span.modelVotes{
707: .modelVotes .voteUp,.modelVotes .voteDown{
708: .modelVotes .voteDown{
709: .modelVotes .voteUp:hover,.modelVotes .voteDown:hover{
715: .modelCreatedBy{
731: .modelLineageBadge{
732: .modelLineageBadge.current{
733: .modelLineageBadge.historical{
737: .modelListRow{
738: .modelListRow>span{
739: .modelListRow>span.modelState{
752: #modelList .modelListRow,.modelListHead{
759: .modelListHead{
779: #modelRenBox{
784: #bakeRenameInput{
811: #modelTree{
812: .treeEmpty{
818: .treeSvg{
823: .treeLines path{
832: .treeLines2 path{
849: .treeNode rect{
850: .treeNode text{
851: .treeNode:hover rect{
852: .treeNode:hover text{
853: .treeNode.sel rect{
854: .treeNode.sel text{
864: .treeNode.multiSel rect{
875: #omscFrame{
891: trick those three elements use, needs #omscView{
934: #friendsPanel{
942: .friendsPanelTitle{
952: .friendsPanelPending{
963: .friendsPanelRow2{
965: .friendsPanelUser{
980: .friendsPanelRow2 .fpActions{
981: .friendsPanelRow2 .fpActions span{
982: .friendsPanelRow2 .fpActions span:hover{
998: #friendInfoModal{
1000: .friendInfoBody{
1002: .friendInfoHead{
1004: .friendInfoClose{
1005: .friendInfoClose:hover{
1006: .friendInfoRow{
1007: .friendInfoLabel{
1008: .friendsPanelSentTag{
1009: .friendsPanelEmpty{
1015: see *{
1052: .webInput{
1062: .webInput::placeholder{
1077: .webBarRight{
1083: .webBarCopyright{
1084: .webBar .chip{
1085: .webBar .chip:hover{
1094: .webBar .chip b{
1124: .states{
1126: .states .grp{
1135: .states .mid-grp{
1136: .states .r{
1144: #modelSelectView .states .r{
1145: .states .on{
1146: #roomChip {
1149: .states .off{
1158: .rd{
1160: .rd.on{
1161: .rd.off{
1171: .djRow .rd.on{
1192: .head{
1235: .corpusPanel{
1243: .corpusDrop{
1246: .corpusDrop.dragover{
1247: .corpusList{
1248: .corpusItem{
1250: .corpusEmpty{
1252: .sect-h{
1253: .sect-h .z{
1257: .sect-h .t{
1258: .sect-h .n{
1259: .rt2{
1261: .views{
1262: .views .v{
1263: .views .v.on{
1264: .hide{
1281: #editModeFrame{
1283: .pb .ln{
1284: .pb .k{
1285: .pb .v{
1302: .stemHeadBar{
1311: .stemHeadCell{
1313: .stemHeadCell .k,.stemHeadCell .v{
1323: .stemHeadCell .trackNav{
1324: .stemHeadCell .tnBtn{
1325: .stemHeadCell .tnBtn:hover{
1334: .stemHeadCell .trackNav.navSel{
1360: .stemAssign{
1369: .stemAssign .k{
1370: .stemAssign .v{
1371: .stemAssign.sel{
1372: .stemAssign.sel .k,.stemAssign.sel .v{
1379: .stemAssign.armed{
1389: .trackNav{
1391: .tnBtn{
1392: .tnBtn:hover{
1393: .tnCount{
1394: .brow.newbake{
1395: .brow.newbake:hover{
1396: .lufs{
1398: .lufs i{
1399: .conf{
1403: .cd{
1405: .cd.on{
1426: .blist{
1427: .blist::-webkit-scrollbar{
1434: .blist::-webkit-scrollbar-thumb{
1436: .blist::-webkit-scrollbar-track{
1437: *::-webkit-scrollbar{
1486: *::-webkit-scrollbar-thumb{
1488: *::-webkit-scrollbar-track{
1489: *::-webkit-scrollbar-corner{
1508: .blist.navSel{
1513: .bopts{
1520: .bopts .lbl,.bopts .mode{
1521: .bopts .mode span{
1522: .bopts .lb{
1527: .brow{
1529: .brow:hover{
1537: .brow:hover .indentCol{
1538: .brow.sel{
1587: .brow.sel .indentCol{
1595: .indentCol{
1601: #modelList .brow.modelListRow{
1609: #blist .brow.bakeListRow{
1610: .brow .browMain{
1614: .brow .m{
1616: .brow.sel .m{
1617: .brow .m .bkScale{
1618: .bkScore{
1619: .brow.sel .bkScore{
1623: .brow.sel .bkScale .cd{
1624: .brow.sel .bkScale .cd.on{
1637: .bdet{
1639: .bdet .span2{
1640: .bdet .lbl2{
1641: .bdet .lbl2:first-child{
1689: .stemPanels{
1692: .stemPanels.lib{
1693: .stemPanels>.stemPanel{
1748: :root{
1749: .stemHeadBar{
1750: .stemPanelsBody{
1751: .stemBodyCell{
1761: .bakeTsne{
1780: .bakeTsne .lbl{
1782: .bakeTsne .lbl.tl{
1783: .bakeTsne .lbl.tr{
1794: .stemPanels .ln{
1806: .rcp2{
1810: .diff{
1812: .diff .rh2{
1813: .diff .rh2 span{
1814: .diff .c1{
1815: .diff .c2,.diff .c3{
1816: .diff .c4{
1821: .score-row{
1823: .score-row .lb{
1825: .scale{
1826: .scale .cd{
1827: .scale .cd:hover{
1828: .score-row .val2{
1837: .bc-map{
1838: .plot-box{
1839: .axes{
1843: .dot{
1847: .dot.live{
1848: .axes{
1894: #bands,.conv,.touched,.rule,.head,.states,.zoneF,#modelSelectView,#friendsPanel,#djPanel,#djVideoPopup{
1953: .band{
1980: #bands{
1983: #bands .band:last-child{
1992: .prog{
1997: .prog .wv{
1998: .prog .wv svg{
2010: .wv .w-axis,.hist .w-axis{
2011: .wv .w-un,.hist .w-un{
2012: .wv .w-un2,.hist .w-un2{
2013: .wv .w-sel,.hist .w-sel{
2014: .wv .w-sel2,.hist .w-sel2{
2015: .wv .w-play,.wv .w-play2,.hist .w-play,.hist .w-play2{
2016: .wv .w-edge,.hist .w-edge{
2017: .prog .stem{
2018: .prog .t{
2031: .brow2>div{
2086: .plot-box{
2087: .infolines,.bc-ent .mcol{
2089: .wd{
2094: .wd::before{
2104: .meters{
2105: .bc-ent .mcol{
2113: .spx{
2114: .spx .fld{
2126: .bc1{
2127: .bc1 .hdr{
2128: .bc-map{
2133: .bc-map .hdr{
2139: .bc2{
2148: .bc-ent{
2149: .bc-ent .hdr{
2150: .bc3{
2151: .bc4{
2165: .brow2{
2310: .hdr{
2314: .hdr .n{
2315: .hdr.rt{
2318: .hdr.rt.src{
2322: .bc4{
2327: .mode{
2328: .mode .on{
2329: .mode .sep2{
2346: .infolines{
2363: .infolines>div{
2380: .infolines>.sp{
2381: .infolines .val{
2382: .lbl{
2383: .val{
2387: .brow2>.col-spx{
2393: .col-spx .spx{
2397: .spx-body{
2399: .spx{
2419: .spx .sc{
2441: .spx .sc span{
2442: .spx .fld,.fld{
2448: .spx .fld{
2456: .spx .bar{
2460: .spx .bar.clip{
2463: .spx .fz{
2466: .sld{
2467: .sld .ln{
2468: .sld .kn{
2492: .wd{
2499: .wd .k,.wd .wv2{
2503: .wd .k{
2504: .wd .wv2,.wd .wv2.chg{
2550: .hist{
2552: .hist svg{
2556: .wd .rv{
2561: .wdh{
2562: .wdh-m{
2571: .meters{
2572: .mcol{
2591: .bc-ent .vfad{
2592: .bc-ent .mcol{
2597: .bc-ent .mcol .sym{
2599: .meth{
2602: .meters{
2603: .bc-ent .mcol .ml,.bc-ent .mcol .mv{
2611: .mpair{
2632: .vmtr{
2634: .vmtr i{
2635: .vmtr b{
2644: .vfad{
2647: .vfad .ln{
2650: .vfad .kn{
2653: .vfad .kn i{
2654: .vfad .kn:hover{
2655: .vfad.sm{
2656: .vfad.sm .ln{
2660: .vfad.sm .kn{
2662: .vfad.sm .kn i{
2663: .ml{
2666: .ml.sym{
2667: .mv{
2720: .plugin:has(#omscView:not(.hide)) .memBox{
2721: .roomCountBox{
2722: .plugin:has(#omscView:not(.hide)) .roomCountBox{
2723: .convOverlay{
2726: .touched{
2752: .memBox{
2754: .memBox .mem{
2760: chat is open, .conv::before is hidden (.conv.chatOpen::before{
2778: .conv.chatOpen .touched{
2779: .conv.chatOpen .memBox{
2795: .roomCountBox{
2797: .rcbGap{
2807: .conv.chatOpen .roomCountBox{
2816: .omscHead{
2817: .plugin:has(#omscView:not(.hide)) .omscHead{
2818: .conv.chatOpen .omscHead{
2819: .omscHead{
2823: .omscMemRow{
2824: .omscMemRow .mem{
2825: .omscModeRow{
2833: .modeBtn{
2837: .modeBtn.on{
2838: .modeGlyphChat{
2839: .modeGlyphEdit{
2845: #editModeGroup{
2851: .plugin:has(#omscView:not(.hide)) .conv:not(.chatOpen) .log{
3008: .nowPlayingBar{
3010: .nowPlayingBar .npTop{
3011: .nowPlayingBar .npThumb{
3012: .nowPlayingBar .npMeta{
3013: .nowPlayingBar .npTitle{
3017: .nowPlayingBar .npArtistLine{
3018: .nowPlayingBar .npScrub{
3019: .nowPlayingBar .npTime{
3020: .nowPlayingBar .npWave{
3021: .nowPlayingBar .npWave svg{
3022: .nowPlayingBar .npCtl{
3023: .nowPlayingBar .npBtn{
3024: .nowPlayingBar .npBtn:hover{
3028: .nowPlayingBar .npPlayBtn.on{
3044: #djPanel{
3046: .djPanelHead{
3048: .djBrowseToggle{
3049: .djBrowseToggle:hover{
3050: .djOnAir{
3051: .djList{
3052: .djRow{
3053: .djRow:hover{
3054: .djRow:hover .djName{
3055: .djName{
3059: .djTuned{
3060: .djFollowBtn{
3061: .djFollowBtn:hover{
3062: .djEmpty{
3067: #djDiscover{
3068: #djDiscoverSearch{
3070: #djDiscoverSearch::placeholder{
3071: .djGenreTags{
3072: .djGenreTag{
3074: .djGenreTag:hover,.djGenreTag.active{
3075: #djDiscover .djList{
3090: #djVideoPopup{
3093: .djVideoHead{
3096: .djVideoHead span[id]{
3097: .djVideoBtns{
3098: .djVideoBtns span{
3099: .djVideoBtns span:hover{
3100: .djVideoBody{
3101: .djVideoBody video{
3102: .djVideoPlaceholder{
3104: .djVideoResize{
3108: #djVideoPopup.min{
3109: #djVideoPopup.min .djVideoBody,#djVideoPopup.min .djVideoResize{
3148: .conv{
3175: .conv:not(.chatOpen){
3178: .plugin:has(.conv.chatOpen) #modelSelectView{
3185: .plugin:has(#omscView:not(.hide)) #cmdHint{
3186: .chatHeader,.cmdStatus{
3265: .conv::before{
3267: .conv.chatOpen::before{
3276: .consoleLabelClosed{
3279: .conv.chatOpen .consoleLabelClosed{
3317: .chatHeader{
3320: .chatHeader .chatRule{
3356: .chatHeader .chatDash{
3374: .cmdStatus{
3420: .chatRef{
3449: .cmdListLabel{
3461: .langGrid{
3463: .langEntry{
3465: .langEntry:hover{
3466: .langEntry .code{
3470: .langEntry.sel{
3471: .langEntry.sel .code{
3476: .langEntry::before{
3477: .langEntry.sel::before{
3478: .chatCols{
3494: .chatCol{
3570: .secFrame{
3613: .chatSec .secHead{
3707: .chatSec .secHead::before{
3709: .chatSec .secHead::after{
3718: .chatSec .secBody{
3719: .chatSec .r{
3721: .chatSec .r .cmd{
3722: .chatSec .r .dsc{
3723: .chatSec .r.note{
3735: .log{
3741: .pipelineStatus{
3757: #omscView:not(.hide) ~ .conv #pipelineStatus{
3795: .conv:not(.chatOpen) .log{
3803: #friendsArea{
3806: .plugin:has(#omscView:not(.hide)) .conv.chatOpen #friendsArea{
3807: .plugin:has(#omscView:not(.hide)) .conv.chatOpen .log{
3812: #cmdSearchPanel{
3815: .plugin:has(#omscView.hide) .conv.chatOpen.cmdPanelOpen #cmdSearchPanel{
3816: .plugin:has(#omscView.hide) .conv.chatOpen.cmdPanelOpen .log{
3817: #cmdSearchInput{
3819: #cmdSearchInput::placeholder{
3820: .cmdSearchSec{
3821: .cmdSearchSecTitle{
3822: .cmdSearchSecTitle:hover{
3823: .cmdSearchSecBody{
3824: .cmdSearchSec.open .cmdSearchSecBody{
3825: .cmdSearchRow{
3826: .cmdSearchRow b{
3827: .cmdSearchRow span{
3828: .cmdSearchNote{
3829: .cmdSearchEmpty{
3835: #friendsAreaSearch{
3837: #friendsAreaSearch::placeholder{
3838: .friendsAreaStatus{
3839: .friendsAreaLabel{
3840: .friendsAreaList{
3841: .friendsAreaRow{
3842: .friendsAreaRow:hover{
3843: .friendsAreaEmpty{
3844: .friendStatusDot{
3850: .friendStatusDot.online{
3877: .convSpacer{
3923: .log.capped{
3936: .log .l{
3938: .log .pre{
3939: .log .cmdtxt{
3940: .log .restxt{
3941: .log .restxt b{
3947: .log .dmHeader .restxt{
3948: .log .dmBack{
3949: .log .dmBack:hover{
3968: .cline{
3969: .cline .mirror{
3986: @keyframes clineCurBlink{
3987: .cline .cur{
3989: .cline:focus-within .cur{
3990: .cline input{
4006: .zoneF{
4007: .fg{
4008: .chip{
4009: .chip:hover{
4010: .chip b{
4011: .chip.on{
4031: :root{
4068: body{
4079: .plugin{
4084: .head{
4087: .band{
4089: .zoneF{
4115: .rule{
4116: .bdet>div+div:not(.span2)::before{
4146: .plot-box{
4150: .mpair{
4154: .lufs{
4156: .cd{
4157: .vfad .ln{
4163: .vfad .kn{
4166: .vfad .kn:hover{
4167: .cd.on{
4169: .head{
4175: .lib .lbl2{
4176: .libn{
4179: .libbox{
4180: .libbox::-webkit-scrollbar{
4187: .libbox::-webkit-scrollbar-thumb{
4189: .libbox::-webkit-scrollbar-track{
4191: .lrow{
4194: .lrow:hover{
4195: .lrow .lname{
4196: .lrow .lgen{
4197: .lrow .lbpm{
4203: .lsrow{
4205: .st{
4206: .st:hover{
4207: .st.prop{
4208: .st.pin{
4209: .st .sn{
4221: #bands.arr-mode{
4222: .arr-toolbar{
4223: .arr-toolbar select{
4224: .arr-toolbar button{
4225: .arr-toolbar button:hover{
4226: .arr-toolbar .sep{
4227: .arr-toolbar .spacer{
4239: row language already used elsewhere in this file (.brow.sel{
4243: .arrDropWrap{
4249: .arrDropBtn{
4251: .arr-toolbar .arrDropBtn{
4260: .arrDropBtn::before,.arrDropBtn::after{
4268: .arrDropBtn::before{
4269: .arrDropBtn::after{
4270: .arrDropMenu{
4284: #arrSnapMenu{
4285: .arrDropMenu[hidden]{
4286: .arrDropMenu .opt{
4287: .arrDropMenu .opt:hover{
4288: .arrDropMenu .opt.sel{
4289: .arr-row{
4290: .arr-row .lbl{
4292: .arr-markers{
4293: .arr-markers .lbl{
4294: .arr-markers .track{
4295: .arr-marker{
4297: .arr-marker::before{
4299: .arr-marker .flag{
4301: .arr-marker:hover .flag{
4302: .arr-axis{
4303: .arr-axis .track{
4304: .arr-axis svg{
4305: .arr-axis .tick{
4306: .arr-axis text{
4307: .arr-lanes{
4335: .arr-lane-group{
4374: .arr-lane-stack{
4394: .arr-lane-stack > .arr-lane{
4395: .arr-lane{
4413: .arr-lane.arr-lane-compressed{
4431: .arr-lane.arr-lane-evensplit{
4450: .arr-lane.arr-lane-added.arr-lane-compressed .lbl{
4464: .arr-lane.arr-lane-compressed .laneCompLine{
4474: .arr-lane.arr-lane-compressed .track{
4480: .arr-lane-group:last-child .arr-lane:last-child{
4481: .arr-lane .lbl{
4482: .arr-lane .lbl b{
4483: .arr-lane .lbl span{
4484: .arr-lane .track{
4485: .arr-lane .track svg{
4486: .arr-playhead{
4488: .arr-minimap{
4489: .arr-minimap .track{
4490: .arr-mmwin{
4502: #bands.arr-mode{
4504: #bands.arr-mode.dragover{
4510: .arr-region{
4511: .arr-region+.arr-region{
4512: .arr-region.dragging{
4513: .arr-region svg{
4518: .arr-lane .lbl .reset{
4519: .arr-lane .lbl .reset:hover{
4525: .arr-toolbar input[type=file]{
4526: #arrUploadStatus{
4537: .arr-clip{
4539: .arr-clip.dragging{
4551: .arr-clip.arr-clip-mirror{
4552: .arr-clip svg{
4553: .arr-clip-missing{
4555: .arr-empty-hint{
4573: .arr-lane.arr-row,.arr-axis.arr-row,.arr-markers.arr-row{
4574: .arr-lane .lblTop{
4575: .arr-lane .lblTop b{
4576: .arr-lane .msBtn{
4578: .arr-lane .msBtn:hover{
4579: .arr-lane .msBtn.on{
4584: .arr-lane.muted{
4593: .arr-grid{
4594: .arr-grid-sub{
4595: .arr-grid-beat{
4596: .arr-grid-bar{
4597: .arr-lane{
4598: #arrTempoReadout{
4612: .arr-grid{
4613: .arr-grid-sub{
4614: .arr-grid-bar{
4615: .arr-lane{
4624: .arr-toolbar input[type=number]{
4626: #arrMeterInput{
4627: .arr-toolbar input[type=number]:focus{
4628: #arrTempoAuto:disabled{
4647: .arr-grid{
4648: .arr-grid-sub{
4649: .arr-grid-bar{
4650: .arr-lane{
4659: .arr-toolbar input[type=number]{
4661: #arrMeterInput{
4662: .arr-toolbar input[type=number]:focus{
4663: #arrTempoAuto:disabled{
4675: .arr-clip{
4676: .arr-clip-head{
4679: .arr-clip.dragging .arr-clip-head{
4680: .arr-clip-body{
4699: .arr-grid{
4700: .arr-grid-sub{
4701: .arr-grid-bar{
4702: .arr-lane{
4729: .plugin{
4733: .arr-lane-group:last-child{
4742: .arr-toolbar input[type=number]{
4744: #arrMeterInput{
4745: .arr-toolbar input[type=number]:focus{
4746: #arrTempoAuto:disabled{
4763: .arr-clip{
4764: .arr-clip-head{
4767: .arr-clip-head .clipHeadText{
4768: .arr-clip.dragging .arr-clip-head{
4769: .arr-clip-body{
4784: .arr-clip-head .clipMute{
4787: .arr-clip-head .clipMute.on{
4788: .arr-clip-head .clipVol{
4789: .arr-clip.clip-muted{
4797: #arrLaneInfo${
4799: .arr-lane .chanNum{
4811: .arr-lane .lblCtrl{
4820: .arr-lane .lblBottomRow{
4821: .arr-lane .lblCtrlRow{
4822: .arr-lane .msBtn.fx{
4823: .arr-lane .laneVol{
4824: .arr-lane .laneRemove{
4825: .arr-lane .laneRemove:hover{
4837: .arrToolGroup{
4838: .arrTool{
4839: .arrTool.on{
4846: .arr-cursor{
4867: .arr-lanes.slicing .arr-clip{
4880: .arr-lanes.ctrlDown .arr-clip{
4881: .arr-clip.scrubbing-content{
4915: .arr-grid-bar{
4916: .arr-grid-sub{
4931: .arr-clip-head{
4940: .arr-clip-titlerow,.arr-clip-ctrlrow{
4942: .arr-clip-ctrlrow{
4950: .arr-clip-head .clipRateText{
4956: .arr-clip-head .clipFileText{
4957: .arr-clip-head .clipDbText{
4965: .clipModes{
4966: .clipModes button{
4969: .clipModes button:hover{
4970: .clipModes button.on{
4984: .knob{
4986: .knob:hover{
4987: .knob:focus{
4988: .knobDial{
4989: .knobDial::after{
4991: .arr-lane .laneVolKnob{
4992: .arr-lane .lanePanKnob{
4993: .arr-clip-ctrlrow .clipVolKnob{
4994: .arr-clip-ctrlrow .clipVolKnob .knobDial::after{
4995: .arr-lane .laneDbText{
4996: .arr-lane .lanePanText{
5014: .arr-clip.clip-muted{
5015: .arr-clip.clip-muted .arr-clip-body{
5016: .arr-lane.muted{
5017: .arr-lane.muted .track{
5027: .descPlot{
5028: .descLine{
5029: .arr-clip-missing{
5046: block used to add `.arr-clip{
5070: .arr-clip-resize{
5071: .arr-lanes.panning{
5072: .arr-lanes.zooming{
5077: .arr-lanes.zooming.zoomOutDrag{
5099: .arr-lanes.zooming .arr-loop-bracket{
5112: .arr-lanes.zooming.zoomOutDrag .arr-loop-bracket{
5113: .arr-lanes.stretching .arr-clip-resize{
5115: .arr-lanes.stretching .arr-clip:hover .arr-clip-resize{
5116: .arr-clip.stretching-live{
5140: .arr-grid-bar{
5145: arrangement_iife_v9.js). Originally a plain `.arr-clip.selected{
5166: .arr-clip.selected::after{
5178: .arr-clip-titlerow .clipVolKnob{
5179: .arr-clip-titlerow .clipVolKnob .knobDial::after{
5180: .arr-clip-ctrlrow{
5185: complaint v8's own `.arr-clip.clip-muted .arr-clip-body{
5224: .arr-clip.clip-muted::after{
5226: .arr-clip.clip-muted .arr-clip-body{
5232: .arr-lane.muted .track{
5259: .arr-lane .lbl{
5276: .arr-lane.arr-lane-added .lbl{
5277: .arr-lane.arr-lane-added .lbl:hover{
5278: .arr-lane.arr-lane-added .lbl .lblCtrl{
5285: .arr-lane.arr-lane-added.lane-label-selected .lbl{
5286: .arr-lane .lbl>.chanNum{
5287: .arr-lane .lblDivider{
5288: .arr-lane .lblRight{
5294: .arr-lane .lblRightMain{
5295: .arr-lane .lblRight .lblTop{
5296: .arr-lane .lblTop b{
5310: .laneExpandBtn{
5314: .laneExpandBtn:hover{
5315: .laneExpandBtn.on{
5316: .arr-lane .msBtn{
5317: .arr-lane .msBtn:hover{
5318: .arr-lane .msBtn.on{
5319: .arr-lane .lbl .laneDbText{
5320: .arr-lane .lbl .lanePanText{
5321: .arr-lane .lbl .knob{
5322: .arr-lane .lbl .knobDial::after{
5336: .arr-lane .laneVu{
5338: .arr-lane .laneVu .vuDb{
5339: .arr-lane .laneVu .mpair{
5340: .arr-lane .laneVu .vmtr{
5342: .arr-lane .laneVu .vmtr i{
5343: .arr-lane .laneVu .vmtr b{
5357: .arr-clip-resize-left,.arr-clip-resize-right{
5358: .arr-clip-resize-left{
5359: .arr-clip-resize-right{
5360: .arr-clip:hover .arr-clip-resize-left{
5361: .arr-clip:hover .arr-clip-resize-right{
5362: .arr-lanes.stretching .arr-clip:hover .arr-clip-resize-right{
5363: .arr-clip.resizing-live{
5399: .arr-toolbar input[type=number]{
5401: .arr-toolbar input[type=number]::-webkit-inner-spin-button{
5402: #arrBpmInput{
5418: #bands.arr-mode{
5419: #bands.arr-mode.dragover{
5431: .arr-grid-bar{
5472: .arr-loop-band-fx{
5488: .arr-loop-dim-fx,.arr-mute-dim-fx{
5490: .arr-loop-dim-fx{
5491: .arr-mute-dim-fx{
5500: .arr-loop-bracket{
5502: .arr-loop-bracket.right{
```

## 4. HTML structure — element `id`s (body markup, lines 5551-6958)

Every element carrying an `id` in the static body markup, in document order.
Most content is rendered into these containers by JS — search the id name
in §5 to find what fills/drives it.

```
5558: <div id="editModeFrame" class="hide"></div>
5563: <div class="disconnected" id="disconnected">waiting for hub — run ./run.sh, then reload this page</div>
5616: <filter id="posterize3" color-interpolation-filters="sRGB">
5756: <span class="siteTab on" id="tabOMSC">[CRKT]</span><span class="siteTab" id="tabOMGM">[M-RLCF 0.1.19]</span>
5772: <input class="webInput" id="usernameField" type="text" placeholder="username" autocomplete="off">
5773: <!-- UPDATE -- id="passwordField" added (had none before) so the
5777: <input class="webInput" id="passwordField" type="password" placeholder="password" autocomplete="off">
5807: <div id="omgmView" class="hide">
5812: <span class="on" id="modelNameChip">[MODEL: CHIRP!]</span>
5828: <div class="head" id="headPlayback">
5841: <span class="v on" id="tabTrain">TRAIN</span><span class="v on" id="tabBake">Bake</span>
5843: <div id="blist" class="blist"></div>
5850: <div class="libbox hide" id="libList"></div>
5854: <div class="bopts hide" id="libOpts">
5856: <span class="mode" id="libmode"><span class="on">[AUTO</span><span class="sep2">|</span><span>MANUAL]</span></span>
5857: <span class="lb" id="libCount"></span>
5876: <div class="lbl2" id="detailsTitle">details &mdash; master track</div>
5895: <div class="stemPanels" id="stemPanels"></div>
5931: <div class="corpusDrop" id="corpusDrop">drag audio files here</div>
5932: <div class="corpusList" id="corpusList"></div>
5937: <div id="bands"></div>
5965: <div id="modelSelectView" class="hide">
6000: <div class="modelListRow modelListHead" id="modelListHead">
6010: <div class="blist" id="modelList"></div>
6011: <div class="modelTree hide" id="modelTree"></div>
6031: <div id="omscView">
6117: <iframe id="omscFrame" src="http://localhost:6969" title="G-ANS — Grassroot-Agentic Node Spiderbot"></iframe>
6130: <div class="nowPlayingBar" id="nowPlayingBar">
6134: <div class="npTitle" id="npSong">--</div>
6137: <div class="npArtistLine" id="npArtist">--</div>
6147: <span class="npTime" id="npTimeL">--:--</span>
6149: <span class="npTime" id="npTimeR">--:--</span>
6152: <span class="npBtn" id="npBack" title="previous song">&lt;&lt;</span>
6153: <span class="npBtn npPlayBtn" id="npPlay" title="play/pause">&#9654;</span>
6154: <span class="npBtn" id="npFwd" title="next song">&gt;&gt;</span>
6164: <div id="djPanel">
6167: <span class="djBrowseToggle" id="djBrowseToggle">[browse all]</span>
6169: <div class="djOnAir" id="djOnAir">no channel tuned</div>
6170: <div class="djList" id="djFollowedList"></div>
6171: <div id="djDiscover" class="hide">
6172: <input type="text" id="djDiscoverSearch" placeholder="search djs" spellcheck="false" autocomplete="off">
6173: <div class="djGenreTags" id="djGenreTags"></div>
6174: <div class="djList" id="djDiscoverList"></div>
6177: <div id="djVideoPopup" class="hide">
6178: <div class="djVideoHead" id="djVideoHead">
6179: <span id="djVideoTitle">[no channel]</span>
6181: <span id="djVideoMin" title="minimize">[_]</span>
6182: <span id="djVideoClose" title="close">[x]</span>
6186: <video id="djVideoEl" muted loop playsinline></video>
6187: <div class="djVideoPlaceholder" id="djVideoPlaceholder"></div>
6189: <div class="djVideoResize" id="djVideoResize"></div>
6208: <div id="friendInfoModal" class="hide">
6211: <span id="friendInfoName"></span>
6212: <span class="friendInfoClose" id="friendInfoClose">[esc]</span>
6214: <div class="friendInfoRow"><span class="friendInfoLabel">next show:</span> <span id="friendInfoNext"></span></div>
6215: <div class="friendInfoRow"><span class="friendInfoLabel">interested in:</span> <span id="friendInfoInterested"></span></div>
6216: <div class="friendInfoRow"><span class="friendInfoLabel">history:</span> <span id="friendInfoHistory"></span></div>
6298: <div class="touched"><span id="co2Counter">CO2: — · —% of avg site</span></div>
6325: <div class="roomCountBox" id="roomCountBox">
6326: <div id="omscCo2Line1">CO2e SESSION — g</div>
6327: <div id="omscCo2Line2">LAST ACTION — g</div>
6329: <div id="roomCount">1 in room</div>
6330: <div id="roomNameLine">[ROOM: —]</div>
6363: <div class="omscHead" id="omscHead">
6366: <button type="button" class="modeBtn on" id="chatModeBtn" title="chat mode" aria-pressed="true"><span class="modeGlyph modeGlyphChat"></span…
6367: <button type="button" class="modeBtn" id="editModeBtn" title="edit interface" aria-pressed="false"><span class="modeGlyph modeGlyphEdit">&#9…
6397: <div class="chatHeader hide" id="chatHeader">
6431: <div class="cmdStatus hide" id="cmdStatus">
6432: <span id="langHint">:language — type to expand</span>
6433: <span id="cmdHint">:commands — type to expand</span>
6442: <div class="chatRef hide" id="langRef"></div>
6459: <div class="pipelineStatus hide" id="pipelineStatus"></div>
6460: <div class="log" id="clog"></div>
6484: <div id="friendsArea">
6485: <input type="text" id="friendsAreaSearch" placeholder="search / add friend" spellcheck="false" autocomplete="off">
6486: <div class="friendsAreaStatus" id="friendsAreaStatus"></div>
6488: <div class="friendsAreaList" id="friendsAreaOnline"></div>
6490: <div class="friendsAreaList" id="friendsAreaOffline"></div>
6506: <div id="friendsPanel">
6508: <div class="friendsPanelPending" id="friendsPanelPending"></div>
6528: <div id="cmdSearchPanel">
6529: <input type="text" id="cmdSearchInput" placeholder="search commands" spellcheck="false" autocomplete="off">
6530: <div id="cmdSearchList"></div>
6545: <div class="convSpacer" id="convSpacer"></div>
6546: <div class="cline" id="cline">
6547: <span class="mirror" id="mirror"></span><span class="cur"></span>
6548: <input id="cin" spellcheck="false" autocomplete="off">
6584: <!-- id="footprintChip" ADDED -- user: "un nouveau tab shortcut... qui
6655: <span class="fg"><span class="chip" id="chatChip"><b>^C</b>chat</span></span><span class="fg hide" id="cmdChipGroup" style="margin-left:6px"…
6656: <!-- id="editModeGroup" ADDED -- EDIT INTERFACE (spec: a global button,
6664: <span class="fg" id="editModeGroup" style="margin-left:6px"><span class="chip" id="editModeChip"><b>^E</b>edit Interface</span></span>
6666: <!-- id="cityModalGroup" ADDED — user: "make sure ^M city is aligned on
6683: Map." Visible label only -- id="cityModalChip"/#cityModalGroup,
6686: <span class="fg" id="cityModalGroup" style="margin-left:auto">
6687: <span class="chip" id="cityModalChip"><b>^N</b>network</span>
6689: <!-- id="startGroup" ADDED — user: "remove start, bake, stem and model
6697: <!-- id="modelSelectGroup" ADDED — user, with a mockup of a terminal
6711: <span class="fg hide" id="modelSelectGroup">
6712: <span class="chip" id="modelNewChip"><b>^N</b>new seed</span>
6713: <span class="chip" id="modelBranchChip" style="margin-left:6px"><b>^B</b>new branch</span>
6736: <span class="chip" id="modelRenameChip"><b>^R</b>rename</span>
6737: <span class="chip" id="modelDeleteChip" style="margin-left:6px"><b>^D</b>delete</span>
6739: <!-- id="modelSelectGroupR" -- second-pass user: "put QUIT and SELECT
6769: <span class="fg hide" id="modelSelectGroupR" style="margin-left:auto">
6779: <span class="chip" id="modelViewToggleChip"><b>^T</b><span id="modelViewToggleLbl">tree view</span></span>
6781: <span class="chip" id="modelEnterChip"><b>Enter</b>select</span>
6783: <span class="fg hide" id="startGroup"><span class="chip" id="startChip"><b>&#9251;</b>start</span></span>
6784: <!-- id="gapAfterModelR" ADDED — FIX, user: "put [enter] Select to the
6786: Root cause: this spacer (and the other two below, id="gap97"/
6787: id="gapAfterBakeStem") were always-visible bare layout spans with
6805: <span id="gapAfterModelR" class="hide" style="width:var(--gap-lg)"></span>
6819: <span id="gap97" class="hide" style="width:97px"></span>
6835: pressing ^B, just no longer as two separate hotkeys. id="bakeNavChip"
6841: drive the one shared arrowTarget. id="stemNavChip" so
6843: id="bakeStemGroup" ADDED — same "remove start, bake, stem and
6858: <span class="fg hide" id="bakeStemGroup"><span class="chip" id="bakeNewChip"><b>^N</b>new</span>
6859: <span class="chip" id="bakeBranchChip" style="margin-left:6px"><b>^B</b>branch</span>
6861: <span class="chip" id="bakeRenameChip"><b>^R</b>rename</span>
6869: <span class="chip" id="bakeDeleteChip" style="margin-left:6px"><b>^D</b>delete</span></span>
6870: <span id="gapAfterBakeStem" class="hide" style="width:var(--gap-lg)"></span>
6925: <span class="fg hide" id="arrShortcutGroup" style="margin-left:auto">
6926: <span class="chip" id="arrStemChip"><b>^U/^I/^O/^P</b>stems: <span id="arrStemLabel">VOCALS</span></span>
6928: <span class="chip" id="arrRenderChip"><b>^&#9166;</b>render</span>
6930: <span class="chip" id="arrNewTrackChip"><b>+</b>new track</span>
6932: <span class="chip" id="arrNextClipChip"><b>^N</b>next clip</span>
6953: id="modelGroup" ADDED — same "remove start, bake, stem and model
6955: <span class="fg hide" id="modelGroup" style="margin-left:auto"><span class="chip" id="modelChip"><b>^L</b>model</span></span>
```

Note: a handful of additional `id="..."` attributes appear only inside JS
template strings (dynamically generated markup) — not listed above.

## 5. JavaScript structure (main inline `<script>`, lines 6975-15855)

### 5a. Feature clusters (rough line ranges, for orientation)

| Lines | Feature area |
|---|---|
| 6960-7057 | Init: disconnected-screen sync, corpus file list, drop-zone wiring, seeded RNG |
| 7058-7496 | Waveform/plot rendering utils, BAKE RECIPE constants, knob drag |
| 7496-8477 | Timeline/scale install (zoom), real-wave sampling, clip selection, snap menu |
| 8477-9541 | Lane/track UI: mute/solo/volume, `buildLaneDom`, add/remove lane, arrangement tool select |
| 9541-10830 | Arrangement view core render pipeline |
| 10830-11300 | Render scheduling/relayout, fit menu, marker drag, fetch real wave/onsets/tempo, upload, render |
| 11300-11388 | `LIB` (library track list) data, `stabilizeHead()` |
| 11388-11687 | View switching (`setView` train/bake), chip visibility, console label text |
| **11687-13100ish** | **Model select feature** (see 5e below) |
| 13100-13166 | `signIn()`, CO2 counter |
| 13166-13803 | **Bake list** (`bakesLive`, `startRenameBake` ~L13499) |
| 13803-14192 | Chat/log data, friends data, DJ list (`renderDjRow`'s `.rd` dot, see 5e) |
| 14192-14414 | Friend requests, DJ panel render/discover, DJ video popup |
| 14414-14737 | Anon id, chat timestamp, chat/log renderers, console command handler |
| 14737-15047 | `REF_SECTIONS` data (help/reference panel) + `sectionHtml` renderer |
| 15047-15277 | Command search panel, `setChatOpen`, `setEditMode` (~L15324) |
| 15277-15369 | `setCmdPanelOpen` |
| 15369-15642 | `LANGUAGES` data + language hint/reference UI |
| 15642-15749 | `setArrowTarget`, stem-nav keyboard shortcuts |
| 15855-15924 | (2nd `<script>`) Safari cursor-refresh interval kick |
| 15924-16029 | (3rd `<script>`) click-feedback cursor override |

### 5b. Top-level state / data constants (75 hits)

```
6967: let arrowTarget=null; // null | 'bake' | 'vcl' | 'mel' | 'bas' | 'drm'
6978: const disconnectedEl=document.getElementById('disconnected');
6990: let corpusFiles=[];
7034: const rng=s=>()=>{s=(s*9301+49297)%233280;return s/233280;};
7035: const TRACK='ESRGDtb923043@$#%_$sdndn-001';
7039: const FREQ=['20','200','1K','5K','20K'];
7040: const DBS=['0','-10','-20','-30','-40','-50'];
7057: const HALF_LABEL_PX=6;
7070: const DIMS=['C','S','E','F','P','H','T','D'];
7071: const DEF_W={C:1.0,S:0.8,E:2.0,F:0.5,P:1.5,H:1.0,T:1.5,D:1.0};   /* defaultWeights() */
7072: const DEF_D={C:0,S:0,E:0,F:0,P:0,H:0,T:0,D:0};                    /* defaultDirPref() */
7079: const BAKE_W={...DEF_W, C:2.0};
7080: const BAKE_D={...DEF_D, C:-1, T:-1};
7087: const STEM_ABBR={vocals:'vcl',melody:'mel',bass:'bas',drums:'drm'};
7088: const ALL_STEMS=['vocals','melody','bass','drums'];
7089: const STEM_ORDER=['vcl','mel','bas','drm'];
7104: const STEM_LABEL={vcl:'vocals',mel:'body',bas:'bass',drm:'drums'};
7105: const scopeOf=list=>list.length===ALL_STEMS.length ? 'all'
7111: const STEMS=[
7141: let waveUid=0;
7239: const DB_FLOOR=-50, CLIP_AT=-1.5;
7240: const CLIP_PCT=(CLIP_AT-DB_FLOOR)/(0-DB_FLOOR);
11300: let armedStem=null;
11313: const LIB=[
11333: let libSel = LIB[0].f;
11369: let headMaxH=0;
11388: let currentView='train';
11687: let modelSelected=false;
11688: let currentModelName='CHIRP!';
11694: let selectedModelId=null;
11702: let modelView='list';
11703: let renamingModel=false;
11714: let multiSelectedIds=new Set();
11734: const MODELS_STORAGE_KEY='gnumbat.models.v1';
11742: let modelIdSeq=1;
11751: let bakeIdSeq=1;
11825: const MODELS=loadModels()||defaultModels();
12275: const TREE_COL_W=180, TREE_ROW_H=28, TREE_NODE_W=150, TREE_NODE_H=18, TREE_PAD=14;
12340: const TREE_NODE_FONT=12, TREE_NAME_MAX=16;
13200: let loggedIn=false;
13258: const GRAMS_PER_MB=0.5;
13263: let CO2_LAST_GRAMS=0;
13330: let bakesLive=[];
13331: let bakeSel=0;
13498: let renamingBake=false;
13751: let npIdx=0, npPlaying=false;
13910: const MAXLOG=2;
13911: let LOG=[
13949: let OMSC_CHAT=[
13979: let DMS={};
13980: let ACTIVE_DM=null;
13994: let LAST_RECEIVED_FROM=null;
14021: const FRIENDS=[];
14027: const FRIEND_ONLINE={};
14040: const FRIEND_SHOWS={
14068: const KNOWN_USERS=['geckosoleil','rollypolly2','KIKI403','deepcuts_mtl'];
14088: let DJS=[
14095: let TUNED_DJ=null; // DJS[].id the radio/video popup is tuned to, if any
14298: let FRIEND_REQUESTS_IN=['rollypolly2','KIKI403'];
14299: let FRIEND_REQUESTS_OUT=[];
14520: const ANON_SYMBOLS='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789%∑-[]£¥∆πΩ$#@&';
14526: const ANON_ID=makeAnonId();
14536: const clog=document.getElementById('clog');
14622: const cin=document.getElementById('cin'), mirror=document.getElementById('mirror');
14843: const REF_SECTIONS = [
15153: let cmdSearchPanelBuilt = false;
15159: const cmdSearchOpenSections = new Set();
15221: let chatOpen=false;
15226: let editMode=false;
15395: let cmdPanelOpen=false;
15431: const LANGUAGES = [
15478: let currentLang = LANGUAGES.find(l=>l.code==='en') || LANGUAGES[0];
15538: let langHintOpen=false;
15539: let langRefBuilt=false;
15706: const STEM_NAV_KEY={u:'vcl',i:'mel',o:'bas',p:'drm'};
```

### 5e. Model-select feature + all 2026-09-15-session fixes — key lines

| Line | What |
|---|---|
| 11840 | `const MODELS=loadModels()\|\|defaultModels();` |
| 12028 | `scanStatusText(m)` — plain-English PickleScan status (Scan column) |
| 12062 / 12069 | `contributorCounts(m)` / `contributorsSorted(m)` — Contributors column count + tooltip |
| 12161 | `modelRowHTML(entry)` — one list row; VOTES uses `&#8593;`/`&#8595;` (↑/↓, NOT triangles — reverted per user request) |
| 12218 | `renderModelList()` — row click clears `multiSelectedIds` (branch-vs-hybridize bug fix), wires vote-arrow clicks |
| 12546 | `updateModelActionChips()` — no-op (Integrate/Replant removed) |
| 12558 | `voteModel(id, direction)` — per-row vote, hub + local fallback |
| 12657 | `newModel()` — ^N / "new seed"; on success (hub or local) auto-opens `startRenameModel(true)` |
| 12703 | `branchModel()` — ^B / "new branch" |
| 12755 | `hybridizeModels(idA, idB)` |
| 12883 | `startRenameModel(startBlank)` — **FIX (round 2)**: `finishWith()` has a `done` guard against the reentrant-blur double-render bug that used to corrupt the list/tree after a couple of branches/seeds. **FIX (round 3)**: both the list-view input (~L12941) and tree-view input (~L12987) keydown handlers now handle Ctrl+N/^B directly (`finish(true)` then `newModel()`/`branchModel()`) instead of only Enter/Escape, so you can hold Ctrl and tap N/B repeatedly to chain arbitrarily-deep branches without ever pressing Enter — previously every keystroke that wasn't Enter/Escape was swallowed by this input's own unconditional `e.stopPropagation()`, so Ctrl+N/^B silently did nothing until you closed the box first |
| 13098 | model-select screen's own Ctrl+N/B/R/D/T `keydown` listener — **FIX (round 3)**: registered with capture:true (3rd `addEventListener` arg) instead of the default bubble phase. Root cause, confirmed by an actual Playwright run: this listener is bound with a bare `addEventListener()` (→ `window`), while the unrelated "toggle city modal" Ctrl+N listener further down the file (~L15680, see below) is bound to `document`. A keydown bubbles target→…→document→window, so the `document` listener ALWAYS fired first, before this listener's `e.stopPropagation()` ever ran — `stopPropagation()` alone (an earlier attempt) could not fix this no matter where it was called from on `window`. Binding this listener on the CAPTURE phase instead makes it run before the bubble phase even starts, so `e.stopPropagation()` here now genuinely cuts the event off before the city-modal listener ever sees it. Verified empirically: 0 `toggle-city-modal` leaks across a chained 5-seed + nested-4-branch-deep sequence, in both list and tree view |
| 13181 | `moveSelectionWithinLevel(dir)` (+ `moveToParentLevel`/`moveToChildLevel` right after) — also clears `multiSelectedIds` now |
| 13558 | `startRenameBake()` — same reentrant-blur `done`-guard fix as `startRenameModel` |
| 15398 | `setEditMode(on)` — no longer force-opens chat (`if(on && !chatOpen) setChatOpen(true)` REMOVED) |
| ~15680 | the unrelated `document.addEventListener('keydown', ...)` "toggle city modal" listener (`#cityModalChip`'s Ctrl+N) that Ctrl+N/^B on the model-select screen used to silently also trigger — untouched itself; the fix (above, L13098) is on the model-select side |

Non-JS pieces from the same session:
- `#editModeFrame` CSS (~L1296 in the style block) — border 6px → 5px
  (round 2) → 3px (round 4). `border-radius:0 0 10px 10px` added in round
  4 (bottom two corners only — "inferior corners" — so it sits flush with
  the host DAW window's own rounded bottom corners without a hard 90°
  corner cutting across that curve; 10px was the user's own pick when
  asked, since nothing in this file defines the host window's actual
  corner radius to copy).
- `.siteTab.on` CSS (~L594) — `font-weight:500!important` (the top-bar
  active-tab bold text; needs `!important`, see §2's note on the global
  `font-weight:400!important` reset).
- `#posterize3` `<filter>` (body, ~L5631) — red-whitelist chain added; see
  §1's note. `.djRow .rd.on{background:#f00}` (~L1171) is the one
  consumer today.

REMOVED entirely in the earlier round of this session (not just hidden):
`toggleIntegrateForSelected()`, `replantSelected()`, `voteSelected()`, the
`#modelIntegrateChip`/`#modelReplantChip`/`#modelUpvoteChip`/
`#modelDownvoteChip` chips and their onclick wiring, `m.integrateFollowingBranches`.

### 5c. Function declarations (218 hits, `function name(...)`)

```
6979: function syncDisconnectedScreen(){
6991: function renderCorpusList(){
7058: function scaleTickTop(i,n){
7123: function signal(seed,n){
7157: function drawWave(seed,sel,ph,cols=278,h=26,live=true,wave=null){
7241: function spectrum(seed,live){
7283: function hist(seed,live){
7321: function parseClock(text){
7338: function clamp(value,lo,hi){return Math.max(lo,Math.min(hi,value));}
7379: function clipArrDuration(clip){return (clip.srcEnd-clip.srcStart)/(clip.rate||1);}
7380: function clipArrEnd(clip){return clip.arrStart+clipArrDuration(clip);}
7387: function fmtRate(rate){
7403: function knobAngle(value){return KNOB_MIN_DEG+clamp(value,0,1)*(KNOB_MAX_DEG-KNOB_MIN_DEG);}
7404: function renderKnobEl(knobEl,value){
7418: function fmtPan(value){
7423: function fmtDb(value){
7431: function installKnobDrag(knobEl,getValue,setValue,resetValue){
7496: function clipDescriptorPlot(stemIndex,clip,cols,height,field){
7796: function scaleOf(event){
7826: function install(element,timelineRange,getAnchorMs){
7919: function installHorizontalScroll(element,timelineRange){
7995: function sampleWaveWindow(real,srcStartMs,srcEndMs,outCols){
8038: function clipWave(stem,clip,stemDurationMs,cols,height,real){
8273: function setSelectedClip(next){
8297: function setSelectedLaneLabel(index){
8308: function clearSelectionForLane(laneIndex){
8361: function closeSnapMenu(){
8365: function onOutsideSnapClick(event){
8368: function openSnapMenu(){
8372: function pickSnap(index){
8379: function rebuildSnapOptions(){
8396: function updateTempoInputs(){
8428: function sendMuteSolo(stemIndex,selector,on){
8442: function sendVolume(stemIndex,value){
8445: function applyMuteSoloVisuals(){
8477: function buildLaneDom(){
9127: function resetLane(index){
9167: function canAddLane(stemIndex){
9174: function addLane(stemIndex){
9215: function toggleLaneExpand(index){
9226: function removeLane(index){
9259: function pickAddTrackType(index){
9297: function clipFilePool(stemIndex){
9300: function stepClipFile(){
9325: function setArrTool(tool){
9330: function updateSlicingClass(){
9541: function fmtClock(ms){
9545: function niceStepMs(targetMs){
9565: function niceBarStep(targetBars){
9574: function barTickStep(barMs){return niceBarStep((range.unitsPerPixel*70)/barMs);}
9593: function renderAxis(){
9659: function extendArrangementIfNeeded(endMs){
9663: function contentEndMs(){
9671: function fitToContent(){
9697: function sliceClipAt(el,laneIndex,clipIndex,clientX){
9742: function deleteClip(laneIndex,clipIndex){
9759: function isSlicing(event){return sliceModeActive;}
9822: function isCtrlGestureReplay(event){
9827: function markCtrlGesture(event){
9852: function installClipInteractions(el,laneIndex,clipIndex){
10076: function renderClipBodyPreview(el,laneIndex,previewClip,widthPx){
10087: function installClipTrimRight(handleEl,laneIndex,clipIndex){
10158: function installClipTrimLeft(handleEl,laneIndex,clipIndex){
10217: function clipHeaderText(stemIndex){
10258: function scheduleClipSettleRefresh(){
10262: function renderLaneClips(laneIndex){
10497: function renderLanes(){
10502: function renderMarkers(){
10516: function renderPlayhead(){
10529: function renderMinimap(){
10552: function pushLines(stepMs,cls,height,into){
10575: function laneOffsetLeft(){
10580: function renderGrid(){
10624: function moveCursorTo(ms){
10634: function renderCursor(){
10648: function zoomAnchorMs(){
10670: function renderLoop(){
10752: function installLoopHandleDrag(bracketEl,which){
10778: function renderMuteDim(){
10806: function renderAll(){renderAxis();renderGrid();renderLanes();renderMarkers();renderPlayhead();renderMinimap();renderCursor();renderLoop();renderMuteDim();}
10830: function tickVuMeters(){
10851: function renderVuMeter(laneIndex,lane){
10870: function scheduleRenderAll(){
10902: function scheduleLaneRelayout(){
10924: function currentFitPercent(){
10930: function zoomToPercent(pct){
10939: function closeFitMenu(){
10943: function onOutsideFitClick(event){
10946: function openFitMenu(){
11020: function installMarkerDrag(el,marker){
11072: function fetchRealWave(index){
11092: function fetchOnsets(index){
11114: function fetchTempo(){
11146: function refreshTrackData(){
11177: function doUpload(file){
11215: function doRender(){
11370: function stabilizeHead(){
11389: function setView(v){
11457: function updateCmdChipVisibility(){
11480: function updateOgtmChatChrome(){
11506: function consoleLabelText(){
11509: function updateConsoleLabel(){
11743: function genModelId(){ return 'm'+(modelIdSeq++); }
11752: function genBakeId(){ return 'bk'+(bakeIdSeq++); }
11753: function defaultModels(){
11769: function migrateModels(list){
11811: function loadModels(){
11822: function saveModels(){
11837: function hubReady(){ return !!(window.Gnumbat && Gnumbat.state==='open'); }
11845: function localIdentity(){
11859: function sendModelsCmd(sel, args, onDone){
11869: function isoDateTime(iso){
11886: function adaptCard(card){
11924: function upsertModelRow(card){
11936: function applyHubModels(cards){
11978: function modelStateText(m){
11996: function pickleGlyph(m){
12013: function scanStatusText(m){
12027: function lineageBadge(m){
12047: function contributorCounts(m){
12054: function contributorsSorted(m){
12059: function below shares, rather than re-writing the same MODELS.filter/
12061: function modelChildren(id){ return MODELS.filter(m=>m.parentId===id); }
12062: function modelById(id){ return MODELS.find(m=>m.id===id); }
12069: function bakeChildren(id){ return bakesLive.filter(b=>b.parentId===id); }
12079: function isHybrid(m){ return m.parentId2!=null; }
12110: function flattenTree(){
12125: function visit(m,depth,prefix,connector,isLast){
12146: function modelRowHTML(entry){
12203: function renderModelList(){
12302: function layoutForest(){
12306: function place(m,depth){
12341: function truncateForTreeNode(name){
12364: function renderModelTree(){
12474: function updateBranchChipLabel(){
12506: function renderCurrentModelView(){
12526: function setChipEnabled(el, enabled){
12531: function updateModelActionChips(){
12543: function voteModel(id, direction){
12567: function updateModelViewToggleLabel(){
12571: function toggleModelView(){
12595: function modelDateStamp(){
12610: function touchModel(m){
12642: function newModel(){
12688: function branchModel(){
12740: function hybridizeModels(idA, idB){
12773: function deleteModel(){
12868: function startRenameModel(startBlank){
12972: function showOgtmContent(){
13014: function selectModel(m){
13048: function logoutModel(){
13101: function moveSelectionWithinLevel(dir){
13125: function moveToParentLevel(){
13132: function moveToChildLevel(){
13215: function signIn(){ loggedIn=true; }
13264: function updateCO2Counter(){
13350: function flattenBakeList(){
13355: function visit(b,depth,prefix,connector,isLast){
13370: function renderBlist(){
13450: function newBake(){
13475: function branchBake(){
13489: function deleteBake(){
13499: function startRenameBake(){
13533: function confDots(pct){
13540: function strHash(s){let h=0;for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;} return Math.abs(h)||1;}
13549: function stemAttrs(trackName, stem){
13609: function bakeTsneHtml(trackName, stem){
13641: function stemPanelHtml(stem, tracks, idx){
13682: function wireStemAssign(){
13698: function stepStemTrack(stem, delta){
13707: function wireTrackNav(){
13717: function renderBakeDetails(){
13752: function npSongList(){
13763: function renderNowPlaying(){
13785: function stepNpSong(delta){
13814: function renderLibDetails(trackFilename){
13838: function assignStem(s,f){
13873: function stemMap(seed,live){
14044: function isFriend(who){ return !!who && FRIENDS.includes(who); }
14096: function djGenres(){ return [...new Set(DJS.map(d=>d.genre))]; }
14097: function renderDjRow(d,withFollowToggle){
14108: function renderDjPanel(){
14127: function renderDjDiscover(){
14150: function tuneToDj(id){
14163: function renderRoomNameLine(){
14173: function openDjVideo(id){
14263: function setFrameInert(inert){
14316: function renderFriendsPanel(){
14351: function acceptFriendRequest(u){
14368: function declineFriendRequest(u){
14382: function sendFriendRequest(raw){
14436: function renderFriendsArea(){
14465: function openFriendInfo(u){
14473: function closeFriendInfo(){
14521: function makeAnonId(){
14532: function chatTimestamp(){
14537: function renderLog(){
14574: function renderOmscChat(){
14591: function clogScrollBottom(){
14609: function renderActiveChat(){
14619: function resetLogCap(){ clog.classList.add('capped'); renderActiveChat(); }
14655: function handleOmscInput(v){
15073: function escapeHtml(s){
15082: function sectionHtml(sec){
15145: function syncStickyOffsets(){
15160: function cmdRowMatches(row, query){
15165: function cmdSearchRowHtml(row){
15170: function renderCmdSearchPanel(){
15199: function initCmdSearchPanel(){
15227: function setChatOpen(on){
15324: function setEditMode(on){
15396: function setCmdPanelOpen(on){
15487: function buildLangRef(){
15505: function selectLanguage(code){
15540: function setLangHintOpen(on){
15689: function setArrowTarget(t){
15936: function b64Of(varName){
15964: function release(){
```

### 5d. Event listener wiring (124 hits)

```
7005: ['dragenter','dragover'].forEach(type=>dropEl.addEventListener(type,event=>{
7009: ['dragleave','dragend'].forEach(type=>dropEl.addEventListener(type,()=>{
7012: dropEl.addEventListener('drop',event=>{
7433: knobEl.addEventListener('pointerdown',event=>{
7444: knobEl.addEventListener('pointermove',onMove);
7445: knobEl.addEventListener('pointerup',onUp);
7447: knobEl.addEventListener('dblclick',event=>{event.stopPropagation();setValue(resetValue);});
7448: knobEl.addEventListener('wheel',event=>{
7852: element.addEventListener('wheel',event=>{
7869: element.addEventListener('gesturestart',event=>{
7875: element.addEventListener('gesturechange',event=>{
7898: element.addEventListener('gestureend',endGesture);
7899: element.addEventListener('gesturecancel',endGesture);
7920: element.addEventListener('wheel',event=>{
8370: document.addEventListener('pointerdown',onOutsideSnapClick);
8378: snapBtn.addEventListener('click',()=>{ if(snapMenu.hidden) openSnapMenu(); else closeSnapMenu(); });
8388: opt.addEventListener('click',()=>{ pickSnap(index); scheduleRenderAll(); closeSnapMenu(); });
8402: bpmInput.addEventListener('change',()=>{
8407: meterInput.addEventListener('change',()=>{
8929: laneEl.addEventListener('click',()=>toggleLaneExpand(index));
9023: muteBtn.addEventListener('click',event=>{
9029: soloBtn.addEventListener('click',event=>{
9043: fxBtn.addEventListener('click',event=>{
9085: lblEl.addEventListener('click',event=>{
9096: expandBtn.addEventListener('click',event=>{
9109: trackEl.addEventListener('pointerdown',event=>{
9350: toolSliceBtn.addEventListener('click',()=>setArrTool('slice'));
9351: toolHandBtn.addEventListener('click',()=>setArrTool('hand'));
9352: toolLoupeBtn.addEventListener('click',()=>setArrTool('loupe'));
9370: lanesEl.addEventListener('pointerdown',event=>{
9397: lanesEl.addEventListener('pointermove',onMove);
9398: lanesEl.addEventListener('pointerup',onUp);
9411: window.addEventListener('keydown',event=>{
9420: window.addEventListener('keydown',event=>{if(event.key==='Control'||event.key==='Meta'){ctrlHeld=true;updateSlicingClass();}});
9421: window.addEventListener('keyup',event=>{if(event.key==='Control'||event.key==='Meta'){ctrlHeld=false;updateSlicingClass();}});
9422: window.addEventListener('blur',()=>{ctrlHeld=false;altHeld=false;updateSlicingClass();});
9429: window.addEventListener('keydown',event=>{if(event.key==='Alt'){altHeld=true;updateSlicingClass();}});
9430: window.addEventListener('keyup',event=>{if(event.key==='Alt'){altHeld=false;updateSlicingClass();}});
9442: window.addEventListener('keydown',event=>{
9456: window.addEventListener('keydown',event=>{
9471: window.addEventListener('keydown',event=>{
9501: window.addEventListener('keydown',event=>{
9512: window.addEventListener('keydown',event=>{
9853: el.addEventListener('pointerdown',event=>{
9955: el.addEventListener('pointermove',onScrubMove);
9956: el.addEventListener('pointerup',onScrubUp);
9991: el.addEventListener('pointermove',onMove);
9992: el.addEventListener('pointerup',onUp);
9994: el.addEventListener('contextmenu',event=>{
10088: handleEl.addEventListener('pointerdown',event=>{
10143: handleEl.addEventListener('pointermove',onMove);
10144: handleEl.addEventListener('pointerup',onUp);
10146: handleEl.addEventListener('contextmenu',event=>event.preventDefault());
10159: handleEl.addEventListener('pointerdown',event=>{
10201: handleEl.addEventListener('pointermove',onMove);
10202: handleEl.addEventListener('pointerup',onUp);
10204: handleEl.addEventListener('contextmenu',event=>event.preventDefault());
10413: el.querySelector('.clipMute').addEventListener('pointerdown',event=>event.stopPropagation());
10414: el.querySelector('.clipMute').addEventListener('click',event=>{
10427: btn.addEventListener('pointerdown',event=>event.stopPropagation());
10428: btn.addEventListener('click',event=>{
10753: bracketEl.addEventListener('pointerdown',event=>{
10764: bracketEl.addEventListener('pointermove',onMove);
10765: bracketEl.addEventListener('pointerup',onUp);
10908: window.addEventListener('resize',scheduleLaneRelayout);
10948: document.addEventListener('pointerdown',onOutsideFitClick);
10950: fitBtn.addEventListener('click',()=>{ if(fitMenu.hidden) openFitMenu(); else closeFitMenu(); });
10955: opt.addEventListener('click',()=>{ zoomToPercent(pct); closeFitMenu(); });
10991: axisTrack.addEventListener('pointerdown',event=>{
10998: axisTrack.addEventListener('pointermove',event=>{
11011: axisTrack.addEventListener('pointerup',event=>{
11021: el.addEventListener('pointerdown',event=>{
11031: el.addEventListener('pointermove',onMove);
11032: el.addEventListener('pointerup',()=>el.removeEventListener('pointermove',onMove),{once:true});
11034: el.addEventListener('contextmenu',event=>{event.preventDefault();markers=markers.filter(candidate=>candidate!==marker);renderMarke…
11036: markersTrack.addEventListener('dblclick',event=>{
11048: mmWin.addEventListener('pointerdown',event=>{
11060: mmWin.addEventListener('pointermove',onMove);
11061: mmWin.addEventListener('pointerup',()=>mmWin.removeEventListener('pointermove',onMove),{once:true});
11063: minimapTrack.addEventListener('dblclick',()=>range.showAll());
11250: addEventListener('keydown',e=>{
11275: ['dragenter','dragover'].forEach(type=>bandsEl.addEventListener(type,event=>{event.preventDefault();bandsEl.classList.add('dragove…
11276: ['dragleave','drop'].forEach(type=>bandsEl.addEventListener(type,event=>{event.preventDefault();bandsEl.classList.remove('dragover…
11277: bandsEl.addEventListener('drop',event=>{
12250: sp.addEventListener('pointerdown',event=>event.stopPropagation());
12251: sp.addEventListener('click',event=>{
12926: input.addEventListener('keydown',e=>{
12935: input.addEventListener('blur',()=>finish(true));
12957: input.addEventListener('keydown',e=>{
12962: input.addEventListener('blur',()=>finish(true));
13061: addEventListener('keydown',e=>{
13144: addEventListener('keydown',e=>{
13216: usernameField.addEventListener('keydown', e=>{ if(e.key==='Enter') signIn(); });
13217: passwordField.addEventListener('keydown', e=>{ if(e.key==='Enter') signIn(); });
13521: input.addEventListener('keydown',e=>{
13526: input.addEventListener('blur',()=>finish(true));
14232: if(searchEl) searchEl.addEventListener('input', renderDjDiscover);
14267: head.addEventListener('mousedown', e=>{
14276: resizeHandle.addEventListener('mousedown', e=>{ resizing=true; setFrameInert(true); e.preventDefault(); e.stopPropagation(); });
14277: window.addEventListener('mousemove', e=>{
14285: window.addEventListener('mouseup', ()=>{ dragging=false; resizing=false; setFrameInert(false); });
14401: `addEventListener('keydown', ...)` handlers elsewhere in this file
14408: document.getElementById('friendsAreaSearch').addEventListener('keydown',e=>{
14423: document.getElementById('friendsAreaSearch').addEventListener('input',()=>{
14476: document.getElementById('friendInfoClose').addEventListener('click',closeFriendInfo);
14477: document.getElementById('friendInfoModal').addEventListener('click',e=>{
14486: document.addEventListener('keydown',e=>{
14502: window.addEventListener('message', ...) (see its own comment, next to
14623: cin.addEventListener('input',()=>{mirror.textContent=cin.value;});
14625: UPDATE — this used to be the body of a `cin.addEventListener('keydown', ...)`
14797: document.querySelector('.conv').addEventListener('click', e=>{
15201: document.getElementById('cmdSearchInput').addEventListener('input', renderCmdSearchPanel);
15570: addEventListener('keydown',e=>{
11265: addEventListener('keydown',e=>{  (arrow-key nav elsewhere; not the model-select one)
12941: input.addEventListener('keydown',e=>{  (model rename, list view — chains ^N/^B, see §5e)
12987: input.addEventListener('keydown',e=>{  (model rename, tree view — chains ^N/^B, see §5e)
13098: addEventListener('keydown',e=>{  (model-select ^N/^B/^R/^D/^T — capture:true, see §5e)
13580: input.addEventListener('keydown',e=>{  (bake rename)
14545: document.addEventListener('keydown',e=>{
15629: addEventListener('keydown',e=>{
15659: addEventListener('keydown',e=>{
15668: addEventListener('keydown',e=>{
15674: addEventListener('keydown',e=>{
15680: document.addEventListener('keydown', e => {  ("toggle city modal" ^N — see §5e note)
15766: addEventListener('keydown',e=>{
15787: addEventListener('keydown',e=>{
15814: addEventListener('keydown',e=>{

Note: several more `window.addEventListener('keydown', ...)` calls exist
earlier in the file (~L9426-9527, arrangement-view zoom/modifier-key
tracking) — not listed individually here, grep `addEventListener('keydown'`
for the full set.
```

## 6. Embedded revision log ("UPDATE — user: ...\" comments)

117 of them, right above the code they explain. Line numbers, in file
order:

```
147,185,197,222,233,415,425,440,506,530,578,674,688,921,935,973,1019,1029,1041,1047,1056,1150,1162,1278,1281,1493,1567,1585,1617,1881,2074,2281,2801,2813,2835,2934,2994,3146,3191,3230,3243,3252,3264,3343,3378,3440,3452,3693,3758,3784,3913,3991,4079,4089,4119,4148,5632,5655,5726,5732,5736,5745,5788,5802,6084,6090,6259,6326,6419,6506,6513,6582,6610,6628,6635,6697,6860,6925,7221,9915,11395,11425,11432,11605,11648,11672,11682,11977,12107,12273,12363,12388,12504,12855,13260,13304,13444,13502,13652,13950,14001,14071,14237,14309,14388,14607,14624,14684,14777,14838,15192,15305,15312,15404,15446,15887,15952,15969
```
(118 now, up from 117 — one new one added, the round-4 `#editModeFrame`
corner-radius comment at L1281. The round-3 fixes used "FIX --" rather
than "UPDATE --" as their comment tag, matching this file's existing
`FIX --` convention elsewhere, so they don't add to this count — find
them by searching `FIX --` instead, or see §5e above.)

### 2026-09-15 session, round 2

- **Fixed** the actual bug behind "add one or two branches/seeds and the
  system glitches, no other commands work": `startRenameModel()` (and
  `startRenameBake()`, same pattern) replace their whole container's
  `innerHTML` on commit while their own rename `<input>` is still
  focused — removing a focused element fires a real, synchronous 'blur'
  event, which re-entered the same commit function a second time mid-
  render and corrupted the list/tree. Both now guard with a `done` flag
  so the commit body only ever runs once. New branches/seeds (which
  auto-open this rename input every time) should no longer break
  anything after repeated use.
- **Edit mode** no longer force-opens chat — `setEditMode(true)` used to
  call `setChatOpen(true)` if chat was closed; removed per "the chat
  must remain closed."
- **`#editModeFrame`** border: 6px → 5px (user asked for "maybe 4-6").
- **`.siteTab.on`** (top-bar active tab): `font-weight:500!important` —
  a little bolder, as asked; needs `!important` to beat the file's
  global `font-weight:400!important` reset.
- **Vote arrows**: reverted from ▲/▼ (`&#9650;`/`&#9660;`) back to ↑/↓
  (`&#8593;`/`&#8595;`) per "i dont like the triangles. i want the
  arrows."
- **`#posterize3` filter**: added a red-whitelist chain (black/grey/
  white/red instead of pure monochrome) so `.djRow .rd.on{background:#f00}`
  actually renders red instead of being crushed to grey by the filter's
  saturate(0) step. Verified empirically with a standalone Playwright
  render before landing it — grey/white dots stayed correct, the red one
  came through clean, no fringing on the app's existing grey palette.

### 2026-09-15 session, round 3

- **Actually fixed** "i still cant create multiple branches and seed...
  I need it fixed so i can create a branch of a branch of a branch of a
  branch" — the round-2 reentrant-blur fix was real but not sufficient.
  Found two more bugs by running the page in an actual browser
  (Playwright) instead of only reading the code:
  1. The model-select screen's own Ctrl+N/^B/^R/^D/^T listener called
     `e.stopPropagation()` but was bound with a bare `addEventListener()`
     (→ `window`, bubble phase), while a second, totally unrelated
     `document.addEventListener('keydown', ...)` listener further down
     the file (the `#cityModalChip` "^N Network" toggle, ~L15680) is
     bound to `document`. Since a keydown bubbles target→…→document→
     window, the document listener always fired FIRST — `stopPropagation()`
     on the window listener came too late every time. Every branch/seed
     created from the model-select screen was silently ALSO posting a
     `gnumbat-toggle-city-modal` message in the background. Fixed by
     registering the model-select listener with `capture:true` instead,
     so it runs before the bubble phase (and hence before the city-modal
     listener) even starts.
  2. The rename `<input>` that auto-opens after every new seed/branch
     had its own keydown handler that called `e.stopPropagation()`
     unconditionally and only reacted to Enter/Escape — so Ctrl+N/^B
     pressed while that box was still open (i.e. without pressing Enter
     first) was silently swallowed, doing nothing. This is the likely
     real explanation for "add one or two, then nothing works": rapid
     Ctrl+N/^B without pausing for Enter looked identical to the app
     just not responding. Fixed by handling Ctrl+N/^B directly inside
     that input's keydown listener: commit whatever's typed so far (the
     round-2 `done` guard makes this safe to call from here), then
     immediately start the next create — letting you chain seeds/branches
     arbitrarily deep with no Enter needed in between.
  - Verified empirically (Playwright): a blank Ctrl+N followed by four
    rapid Ctrl+B presses with zero Enter/typing in between produced a
    clean depth-4 branch chain, in both list view and tree view, with
    zero `toggle-city-modal` leak messages.

### 2026-09-15 session, round 7

- **CRKT/M-RLCF vertical alignment, actually fixed** — user: "give one
  more line of chat memory in the closed chat of the CRKT so when
  switching to M-RLCF, the information stays at the same place. And (in
  CRKT) move CO2 and room/user in room one line up. it needs to be
  aligned with M-RLCF." Measured both tabs directly (Playwright bounding
  rects) rather than guessing: `#clog` (~L4003, `.log.capped`) only had a
  `max-height` cap, no `min-height`, so its REAL rendered height tracked
  actual content instead of staying fixed at the intended 2 rows — OGTM's
  `LOG` seed has 2 entries (cmd+res, fills the full 32px) but OMSC_CHAT's
  seed is a single real welcome line ("Chirp!") and only filled 16px.
  `.conv`/`#omscHead`/`#roomCountBox` all sit in normal flow below/beside
  that box, so CRKT's missing 16px propagated into every one of them
  sitting one full row lower than on M-RLCF — confirmed by measurement:
  `.conv`/`#omscHead`/`#roomCountBox`/`#omscCo2Line1`/`#roomCount` were
  ALL exactly 16px (one row) lower on CRKT than on M-RLCF, one single
  root cause behind both symptoms in the user's message. Fixed by adding
  `min-height:calc(var(--row) * 2)` to `.log.capped`, matching its own
  `max-height` — CRKT's closed chat area now always reads as a full 2
  lines tall (blank space under the one real "Chirp!" line) rather than
  collapsing to 1, which is real reserved layout space, not a second
  fabricated chat line (OMSC_CHAT's own comment explicitly documents an
  earlier "remove the fake chat log" request — padding it with an
  invented second message would have undone that). Re-measured after the
  fix: `.conv`/`omscHead`/`roomCountBox`/`omscCo2Line1`/`roomCount`/
  `clog`/`cline` all now report IDENTICAL top positions on both tabs —
  CO2 and room/user-in-room moved up exactly one row on CRKT, landing
  precisely on M-RLCF's positions, confirmed empirically, not assumed.
- **Search bars narrowed to ~210px** — user: "make the research bar of
  the scraper under 'All'. make it quite short. maybe 210 px wide. do
  the same size research bar above the DJs listing." Two separate bars,
  same target width:
  1. `base.html`'s own `.search-field` (the scraper/crawler page's real
     search box, top of `.page` — where the old "mtl-shows" `<h1>` used
     to sit): was `flex:1` (stretched to the full content-column width).
     Changed to a fixed `flex:0 0 210px;width:210px` — `.search-input`
     inside it keeps its own `flex:1`, so it still fills whatever width
     the box has, just a much narrower one now. Measured: 212px rendered
     (210px + the field's own 1px border each side) — matches "maybe
     210px" as stated.
  2. `panel.html`'s `#djSearch` (added round 5, sits directly above
     `#djFollowedList`): `width:100%` (full `#djPanel` width) → fixed
     `width:210px`, same target size as the scraper's bar. Measured:
     210px exactly (already `box-sizing:border-box`).

### 2026-09-15 session, round 6

- **Branch/seed glitch — still not actually fixed on the user's real,
  hub-connected setup**, second report: "i cant create more than one at
  a time... after refreshing it works one time, and then breaks again."
  Round 3's capture-phase/Ctrl-chaining fix was real and stays in, but
  every round-3 Playwright test ran with `hubReady()===false` (no hub
  attached) — it never touched the async hub round-trip path at all.
  Reading the real backend (`gui_hub_bridge.js`'s `handleModelsCommand`)
  confirmed every mutating command (`newSeed`/`branch`/`hybridize`/
  `rename`/etc.) broadcasts the FULL model list back to every connected
  panel, including the one that just made the change, immediately after
  its own direct reply — a guaranteed second, later, async touch of
  `MODELS` on top of the optimistic one. Two fixes landed this round:
  1. **`renderCurrentModelView()`** (~L12345) now bails out with
     `if(renamingModel) return;` as its first line. Rationale: this
     function is called unconditionally by `Gnumbat.on('models',...)`
     (the broadcast-echo handler) and by `voteModel()`/`deleteModel()`'s
     hub callbacks; if a broadcast echo lands while a rename `<input>` is
     still open/focused, it destroys that input mid-edit, and destroying
     a focused element fires a real synchronous `blur` — re-entering
     `finishWith()`'s own commit logic from inside this function's own
     `innerHTML` teardown (a render nested inside a render). Every
     legitimate call site already has `renamingModel===false` by the time
     it calls this function, so the guard only skips illegitimate
     external renders; `MODELS` itself still gets updated by
     `applyHubModels()`/`upsertModelRow()` regardless — only the visual
     refresh is deferred until `finish()` closes the rename box.
     **Caveat, stated plainly**: a mock-hub Playwright test reproducing
     this exact collision (`probe_hubrace.js`) passes with this guard in
     — but a negative-control run of the same test with the guard
     stripped ALSO passed, so this specific test does not, on its own,
     prove this was the user's actual failure mode. The fix is kept
     because the broadcast-echo race it guards against is real and
     confirmed from the backend source, not hypothetical — it's a
     legitimate defensive fix either way — but it should not be presented
     as "the" proven root cause on the strength of that test alone.
  2. **A separate, more severe bug, found by tracing deeper and
     confirmed with a real crash repro**: `layoutForest()`'s recursive
     `place(m,depth)` (~L12378) had zero protection against a malformed
     row entering `MODELS` (e.g. one with `id===undefined`, from any hub
     reply that doesn't carry a real card). Such a row satisfies BOTH
     `roots=MODELS.filter(m=>m.parentId==null)` (loose equality —
     `undefined==null` is true) AND its own `modelChildren(undefined)`
     lookup as a "child" of ITSELF (`m.parentId===id` when both are
     `undefined`) — infinite recursion, `RangeError: Maximum call stack
     size exceeded`, inside `renderCurrentModelView()`, which runs after
     literally every model action. This matches "everything breaks until
     I refresh" far more completely than DOM corruption alone would.
     Fixed two ways: `place()` now tracks a `visiting` Set and treats an
     already-visiting id as a leaf instead of recursing into it again;
     and `upsertModelRow(card)` (~L12000) now refuses any card without a
     real `card.hash`, `console.warn`s, and returns `null` instead of
     pushing a broken row into `MODELS` at all (its three hub-callback
     call sites in `newModel()`/`branchModel()`/`hybridizeModels()` each
     got a matching `if(!row) return;` right after, so they no longer
     touch `.id` on a `null`). Verified with a proper positive+negative
     control pair: a copy of this file with both guards reverted
     reliably throws the exact `RangeError` above when a malformed row
     (built the same way `adaptCard()` itself would build one) is pushed
     into `MODELS` and rendered; the current, fixed file does not throw,
     and confirms `upsertModelRow({})` returns `null` without touching
     `MODELS` at all. Re-ran the full `probe_hubrace.js` sequential
     seed→branch→branch→seed→delete scenario and the round-3 depth-4
     rapid-Ctrl+B chaining tests afterward — no regressions.
  - **Bottom line for the user**: the stack-overflow fix (2, above) is a
    demonstrated, real crash vector closed with a clean before/after
    repro — independent of whatever originally put a bad row into
    `MODELS`. The render-guard fix (1, above) is a real, justified
    defensive fix for a confirmed backend race, but wasn't pinned down
    as definitively "the" cause via testing. If the glitch still recurs
    after this, the next step is tracing it live against the user's
    actual running hub rather than a mock one.
- **Username/password reverted back to white background, black text**
  per explicit request ("its important it remain black text on white
  background") — undoing round 5's `.webInput` change specifically;
  `background:#fff;color:#000` (and matching placeholder color) restored.

### 2026-09-15 session, round 5

- **Edit mode click-lock** — user: "in edit mode, nothing should be
  clickable anymore, only the chat/console/coding agent." `setEditMode()`
  (~L15377) now toggles `body.editLocking`; CSS (near `#editModeFrame`,
  ~L1321) blanket-disables `pointer-events` on everything, then re-enables
  it on `.conv` (the chat/console box) and its descendants only. Ctrl+E
  still exits even with the mouse locked out — that handler calls
  `editModeChip.click()` programmatically, and `pointer-events:none` only
  blocks real mouse/touch hit-testing, not synthetic `.click()`. Verified
  empirically: a locked tab-click no longer switches tabs, typing into
  `#cin` still works, Ctrl+E still exits.
- **Chat/console demarcator removed** — user: "remove the demarcator line
  of the chat/console and the title itself chat/console." Closed state:
  `.conv::before` (the rule line) and `.consoleLabelClosed` ("chat"/
  "console" text riding on it) deleted outright. Open state: `.chatHeader`
  (~L3377) itself stays (its 25px flow height is load-bearing for other
  layout math elsewhere in the file) but is now empty — `.chatDash`/
  `.chatRule` (the "-- chat --" dashes+label) are gone, CSS and HTML both.
  `updateConsoleLabel()`'s two `querySelector` calls were already
  null-checked, so no JS changes were needed beyond the removal itself.
- **DJs moved under G-ANS + search added** — user: "move the DJs section
  under the G-ANS and add a search bar for the dj list. remove browse all
  since a search is being added." `#djPanel` (~L3111) dropped
  `position:absolute;top:30px;right:10px` for a plain `flex:0 0 auto` flow
  child instead — `#omscView` is a flex column with `#omscFrame` as
  `flex:1 1 auto`, so djPanel now renders as its own section directly
  below the iframe rather than overlapping its corner (verified: djPanel's
  top edge now equals omscFrame's real bottom edge exactly, 0 overlap).
  `#djSearch` (new input, reusing `#djDiscoverSearch`'s old CSS) narrows
  `#djFollowedList` live by name. `.djBrowseToggle`/`#djDiscover`/
  `.djGenreTags` and their JS (`renderDjDiscover()`, `djGenres()`) are
  deleted outright, not hidden — same full-removal convention as
  Integrate/Replant. Net effect: the old "discover NOT-yet-followed DJs"
  feature is gone, replaced by search over the followed list only: if
  discovering/following new DJs from this panel is still wanted, that's a
  separate follow-up ask, not implied by "remove browse all."
- **CRKT header black** — `.siteTab.on` (~L600, the active-tab pill —
  covers both `[CRKT]`/OMSC and M-RLCF/OGTM when selected) text color
  `#7f8386` → `#000`. Background stays white; that's the deliberate
  active/inactive tab indicator, untouched.
- **All-black sweep** — user: "make sure everybackground of [this page]
  is also black. buttons, search bars, network page, etc." Three literal
  `background:#fff` spots fixed: `.webInput` (~L1066, username/password
  fields — background AND text color both changed together, back to the
  `#000`/`#7f8386` pairing this exact box used two rounds ago, since
  black-on-black text would be unreadable); `.webBar .chip b` (~L1116 —
  turned out to be dead CSS already, no `<b>` currently renders inside a
  `.webBar .chip` since an earlier round moved the one chip that used to
  live there out of `.webBar` entirely — changed anyway for consistency,
  but nothing visibly changes); `.nowPlayingBar .npThumb` (~L3074, the
  "now playing" album-art placeholder). Checked `base.html` (the real
  file G-ANS's iframe loads, `src/backend/event-crawler/frontend/`) too —
  already fully converted to black backgrounds in an earlier session
  (its own file header documents this), no violations found on a fresh
  sweep. Left alone: every background that's white as a deliberate
  selection/highlight state (`.siteTab.on`, `.arr-lane-added .lbl`,
  `.brow.sel`, etc.) — each traces back to its own explicit "make this
  white" request, so reversing it would silently undo a different,
  still-current ask rather than fix an oversight.
- **`#editModeFrame` radius** 10px → 20px (user: "make the radius of the
  inferior corners of the edit mode demarcator rectangle 20px"), same
  bottom-two-corners-only shape as round 4.

### 2026-09-15 session, round 4

- **`#editModeFrame`** ("white surround" in edit mode): user wanted it to
  "fit the curve of the inferior corners of the navigator page" and be
  thinner again. Nothing in panel.html defines the host DAW window's own
  corner radius (that curve is native window chrome, outside this page's
  DOM) — asked the user directly rather than guess; they picked 10px.
  Added `border-radius:0 0 10px 10px` (bottom two corners only — "inferior
  corners" specifically, top stays square against the host's title bar)
  and thinned the border 5px → 3px. Verified with a Playwright screenshot
  crop of the actual rendered corner.

## 7. How to use this map

1. Know the feature/element name → `grep -n '<name>' gui/panel.html`
   first; use §3/§4/§5 above only to browse when you don't have an exact
   string yet.
2. Know roughly what you're changing → look it up in §5a's cluster table
   (or §5e for the model-select screen / recent fixes specifically) for a
   line range, then `sed -n 'START,ENDp' gui/panel.html` on just that range.
3. Wondering *why* something is built a certain way → check §6 for a
   nearby UPDATE comment, or read the block comment immediately above
   the code.
4. After editing panel.html, this map's line numbers are stale.
   Regenerate it (re-run the extraction: grep -n for rule-opening `{`
   lines in the style block, `id="` in the body range, `^\s*function `
   and `^(const|let|var) ` at top level in the script range,
   `addEventListener(`, and `UPDATE —|UPDATE --|UPDATE:`) rather than
   hand-patching line numbers.
