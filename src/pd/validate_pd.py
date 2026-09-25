#!/usr/bin/env python3
"""validate_pd.py - structural check for Pd patch files.

    python3 src/pd/validate_pd.py src/pd/*.pd

CONVERSION_NOTES.md refers to a validate_pd.py several times ("0 structural
errors"), but no such file is in the repo - it was evidently a scratch script
that never got committed, so none of those claims can be re-checked today.
This is that check, written to stay.

What it catches - all of it silent-failure territory in Pd, which loads a
malformed patch partially and only complains in the console:

  * #X connect referring to an object index that does not exist. Pd drops the
    connection and prints one line at load; the patch then looks fine and does
    nothing.
  * #N canvas / #X restore imbalance, which swallows every object after it.
  * connect referencing a comment or an array-graph as if it had inlets.
  * unescaped $ or ; inside object and message boxes - the format's sharpest
    edge, and the one most likely to bite when a patch is generated rather
    than drawn by hand.

What it deliberately does not do: verify that an object actually exists in
Pd or in the installed externals. That needs Pd, and if Pd is available you
would rather just open the patch.
"""

import sys
import re
import glob

# Lines that create something occupying an index in the parent canvas's
# object list. Pd counts objects, messages, comments, and graphs alike.
INDEXED = ("#X obj", "#X msg", "#X text", "#X floatatom", "#X symbolatom",
           "#X listbox", "#X scalar")

# ...of those, the ones that have no inlets or outlets and so can never be a
# legal endpoint of a connection.
NO_PORTS = ("#X text",)

# Object names that exist in Max (or in a Pd external library) but NOT in
# vanilla Pd. Each one loads as "... couldn't create" and leaves a hole in the
# patch. Value is the vanilla replacement, or what to install.
#
# This list came out of the first real Pd console output (2026-08-08), which
# showed the conversion had carried Max object names straight across. Add to it
# whenever the console names another one.
# Names local to this repo (peakamp~, regexp_stub, stem_*, bridge_*) resolve
# as abstractions and must NOT be listed here.
NOT_VANILLA = {
    "prepend":  "Max/cyclone -> [list prepend X] into [list trim]",
    "round":    "not vanilla -> [expr round($f1)]",
    "gate":     "Max/cyclone -> vanilla [spigot] or [route]",
    "zl":       "Max/cyclone -> the [list] family",
    "sprintf":  "Max/cyclone -> vanilla [makefilename] or [list]",
    "regexp":   "Max/cyclone -> no vanilla equivalent; see regexp_stub.pd",
    "universal": "Max only",
}


def unescape_lines(raw):
    """Pd wraps long lines. A logical statement ends at an unescaped ';'."""
    stmts, buf = [], ""
    for line in raw.split("\n"):
        buf = line if not buf else buf + " " + line
        # A ';' preceded by a backslash is literal content, not a terminator.
        if re.search(r"(?<!\\);\s*$", buf):
            stmts.append(buf)
            buf = ""
    if buf.strip():
        stmts.append(buf)
    return stmts


def check(path):
    errors = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        stmts = unescape_lines(fh.read())

    # A stack of canvases: each frame is [object_count, kinds, canvas_line_no].
    stack = []
    for n, s in enumerate(stmts, 1):
        s = s.strip()

        if s.startswith("#N canvas"):
            stack.append([0, [], n])
            continue

        if not stack:
            continue  # trailing junk after the outermost restore
        frame = stack[-1]

        if s.startswith("#X restore"):
            # A subpatch closes and itself occupies one index in its parent.
            stack.pop()
            if not stack:
                errors.append("line %d: #X restore with no open canvas" % n)
                continue
            stack[-1][0] += 1
            stack[-1][1].append("#X obj")  # a subpatch has inlets/outlets
            continue

        if s.startswith("#X array"):
            # Inside a graph subpatch; the graph itself is indexed at #X restore.
            continue

        if s.startswith("#X connect"):
            parts = s.rstrip(";").split()
            try:
                src, _so, dst, _di = (int(parts[2]), int(parts[3]),
                                      int(parts[4]), int(parts[5]))
            except (IndexError, ValueError):
                errors.append("line %d: malformed connect: %s" % (n, s))
                continue
            count = frame[0]
            for label, idx in (("source", src), ("target", dst)):
                if idx >= count:
                    errors.append(
                        "line %d: connect %s index %d but this canvas has only "
                        "%d objects (0-%d)" % (n, label, idx, count, count - 1))
                elif frame[1][idx] in NO_PORTS:
                    errors.append(
                        "line %d: connect %s index %d is a comment - it has no "
                        "inlets or outlets" % (n, label, idx))
            continue

        for kind in INDEXED:
            if s.startswith(kind):
                frame[0] += 1
                frame[1].append(kind)
                # $ and ; inside a box must be escaped or Pd mis-parses the
                # file. Skip the statement-terminating ';' at the end.
                body = s[len(kind):].rstrip(";")
                # BARE $1 / $0 in a box. In the .pd FILE format the backslash
                # is what carries a dollar through to the box; Pd writes \$1
                # when saving a box whose text is $1. A bare $ is substituted
                # by binbuf_read at file-parse time instead, against arguments
                # the canvas does not have - so [value $0-cid] in twelve
                # instances of an abstraction resolves to the SAME name in all
                # twelve, rather than one per instance.
                #
                # This is settled by the vendored timeStretch~ library, which
                # is unmodified upstream GPL code that demonstrably runs (it is
                # the karma~ replacement currently producing audio in this
                # patch): 137 escaped \$n in object boxes, zero bare ones.
                # CONVERSION_NOTES.md's 2026-08-03 entry concluded the opposite
                # and "fixed" cycle_slot.pd by stripping the backslashes - see
                # the correction filed against it.
                #
                # Known false positives, all legitimate bare $: expr's own
                # $f1/$s1/$i1 inlet syntax, and a regex anchor such as
                # [regexp_stub [^/]+$]. Both are reported, because a rule that
                # guesses is worse than one you check by eye.
                if re.search(r"(?<!\\)\$[0-9]", body):
                    errors.append(
                        "line %d: BARE $ in a box - Pd substitutes this at "
                        "file-parse time, not per instance; write \\$1 unless "
                        "this is a regex anchor. expr's $f1/$s1 are $ + a LETTER, "
                        "which binbuf never substitutes - those are fine bare: %s"
                        % (n, s[:70]))

                # An unescaped ';' inside a box TERMINATES THE STATEMENT there.
                # Pd then parses the remainder of the text as further objects,
                # which is where console lines like "only: no such object" and
                # "that's: no such object" come from - those are words out of
                # a comment being instantiated. Restored after the first
                # real console output showed exactly this happening.
                if re.search(r"(?<!\\);", body):
                    errors.append(
                        "line %d: unescaped ; inside a box - everything after "
                        "it is parsed as new objects: %s" % (n, s[:70]))

                # Objects that do not exist in vanilla Pd. Every one of these
                # is a Max name that came through the conversion untranslated,
                # and each produces "... couldn't create" plus a dead branch.
                m = re.match(r"#X obj\s+-?\d+\s+-?\d+\s+([^\s;]+)", s)
                if m and m.group(1) in NOT_VANILLA:
                    errors.append(
                        "line %d: [%s] is not a vanilla Pd object (%s): %s"
                        % (n, m.group(1), NOT_VANILLA[m.group(1)], s[:60]))
                break

    # The outermost canvas is the file itself and is never closed with a
    # #X restore - only subpatches are. So one frame left on the stack is
    # correct; two or more means a subpatch swallowed the rest of the file.
    if len(stack) > 1:
        errors.append("%d subpatch canvas(es) never closed with #X restore "
                      "(first opened at statement %d) - every object after it "
                      "is being parsed into the wrong canvas"
                      % (len(stack) - 1, stack[1][2]))
    return errors


def main(argv):
    paths = []
    for a in argv or ["src/pd/*.pd"]:
        paths.extend(sorted(glob.glob(a)))
    if not paths:
        print("no files matched")
        return 1

    total = 0
    for p in paths:
        errs = check(p)
        total += len(errs)
        if errs:
            print("%s" % p)
            for e in errs:
                print("    %s" % e)
    print("\n%d file(s) checked, %d structural error(s)" % (len(paths), total))
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
