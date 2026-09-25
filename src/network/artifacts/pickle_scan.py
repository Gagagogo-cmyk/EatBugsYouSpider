#!/usr/bin/env python3
"""
pickle_scan.py -- static, non-executing scan for dangerous opcodes inside a
pickle stream: a raw .pkl/.pickle file, or a zip-wrapped .pt/.pth/.ckpt/.bin
(PyTorch's default torch.save format is a zip archive containing one or
more pickled entries, typically 'data.pkl' or '<name>/data.pkl').

This is the real implementation behind quarantine.js's scan() hook for any
artifact that could carry a pickle payload -- see docs/platform/
ARTIFACT_NETWORK.md, "Security model." It is called on a file BEFORE that
file is ever trusted or activated, from any source (server, known node, or
swarm peer) -- signing/hashing proves who published a file and that it
hasn't been altered in transit; it says nothing about whether the
publisher's own bytes were malicious to begin with. This is the check for
that second, different question, at least for pickle's specific and
well-known code-execution vector.

It NEVER calls pickle.load()/torch.load() -- those execute arbitrary code
by design (that's what pickle's GLOBAL+REDUCE mechanism is *for*). This
only disassembles the opcode stream via pickletools.genops(), which is
pure parsing with no side effects, and inspects which (module, name) pairs
a GLOBAL/STACK_GLOBAL opcode references. Any reference not on the explicit
SAFE_GLOBALS allowlist below fails the file closed. This is deliberately
an allowlist (default-deny), not a blocklist of known-bad names, because
an automated gate with no human in the loop has to fail safe on a global
it doesn't recognize, not assume it's fine. Extending SAFE_GLOBALS is a
deliberate, reviewed decision, not something to do to silence a failure.

Usage: python3 pickle_scan.py <path> [--type raw|zip|auto]
Prints one JSON object to stdout: {"clean": bool, "findings": [...], "scanned": [...]}
"""
import sys
import json
import pickletools
import zipfile
import argparse

SAFE_GLOBALS = {
    ('collections', 'OrderedDict'),
    ('collections', 'defaultdict'),
    ('builtins', 'dict'),
    ('builtins', 'list'),
    ('builtins', 'tuple'),
    ('builtins', 'set'),
    ('builtins', 'frozenset'),
    ('builtins', 'bytearray'),
    ('builtins', 'complex'),
    ('builtins', 'slice'),
    ('__builtin__', 'dict'),
    ('__builtin__', 'list'),
    ('__builtin__', 'tuple'),
    ('__builtin__', 'set'),
    # numpy reconstruction helpers
    ('numpy', 'ndarray'),
    ('numpy', 'dtype'),
    ('numpy.core.multiarray', '_reconstruct'),
    ('numpy.core.multiarray', 'scalar'),
    ('numpy.core.numeric', '_frombuffer'),
    ('numpy._core.multiarray', '_reconstruct'),
    ('numpy._core.multiarray', 'scalar'),
    # torch reconstruction helpers (the realistic shape of an actual
    # torch.save checkpoint's data.pkl)
    ('torch', 'Tensor'),
    ('torch', 'Size'),
    ('torch', 'device'),
    ('torch._utils', '_rebuild_tensor'),
    ('torch._utils', '_rebuild_tensor_v2'),
    ('torch._utils', '_rebuild_parameter'),
    ('torch.serialization', '_get_layout'),
    ('torch.storage', '_load_from_bytes'),
}

# String-literal-push opcodes pickletools can decode straight to a python
# str -- used to resolve STACK_GLOBAL's two operands, which (unlike
# GLOBAL's own inline argument) are read off the stack rather than encoded
# in the opcode itself.
STRING_PUSH_OPS = {
    'SHORT_BINUNICODE', 'BINUNICODE', 'BINUNICODE8', 'UNICODE',
    'SHORT_BINSTRING', 'BINSTRING'
}

MAX_OPS = 2_000_000  # sanity cap so a crafted pathological stream can't hang the scanner


def scan_pickle_bytes(data, label):
    findings = []
    # Tracks the last two consecutive string-literal pushes, so a
    # STACK_GLOBAL immediately following (module-push, name-push) can be
    # resolved. Reset (not just left stale) on any other opcode, since a
    # real STACK_GLOBAL always directly follows its two pushes in every
    # pickle protocol that emits it -- if something else appeared in
    # between, don't guess.
    pending = []
    op_index = -1
    try:
        for opcode, arg, pos in pickletools.genops(data):
            op_index += 1
            if op_index > MAX_OPS:
                findings.append({'label': label, 'issue': 'opcode stream exceeds scan limit -- refusing to keep parsing', 'pos': pos})
                break

            if opcode.name in STRING_PUSH_OPS and isinstance(arg, str):
                pending.append((op_index, arg))
                pending = pending[-2:]
                continue

            if opcode.name == 'MEMOIZE':
                # Protocol >=4 emits MEMOIZE after almost every push to
                # cache it for later BINGET/memo reuse -- it observes the
                # stack top, it doesn't pop or push a new value, so it must
                # not clear `pending` or STACK_GLOBAL will never see the
                # two string pushes that came just before it.
                continue

            if opcode.name == 'GLOBAL':
                module, name = (None, None)
                if isinstance(arg, str) and '\n' not in arg and ' ' in arg:
                    module, name = arg.split(' ', 1)
                elif isinstance(arg, str):
                    parts = arg.split('\n')
                    if len(parts) >= 2:
                        module, name = parts[0], parts[1]
                if module is None or (module, name) not in SAFE_GLOBALS:
                    findings.append({'label': label, 'issue': f'disallowed global reference: {module}.{name}', 'pos': pos})
                pending = []
                continue

            if opcode.name == 'STACK_GLOBAL':
                # The two operands are the last two string-literal pushes
                # seen, with only MEMOIZE (transparent, see above) allowed
                # in between -- any other opcode already cleared `pending`
                # below, so len == 2 here means exactly "module, then
                # name, nothing else happened."
                resolved = None
                if len(pending) == 2:
                    resolved = (pending[0][1], pending[1][1])
                if resolved is None or resolved not in SAFE_GLOBALS:
                    module, name = resolved if resolved else (None, None)
                    findings.append({'label': label, 'issue': f'disallowed or unresolvable global reference: {module}.{name}', 'pos': pos})
                pending = []
                continue

            if opcode.name in ('INST', 'OBJ'):
                # Older, rarer opcodes that also import+instantiate a class
                # by name. Always fail closed -- not worth the extra
                # resolution logic for a legacy path real ML tooling
                # doesn't emit.
                findings.append({'label': label, 'issue': f'disallowed opcode {opcode.name} (legacy class-instantiation opcode)', 'pos': pos})
                pending = []
                continue

            pending = []
    except Exception as e:
        findings.append({'label': label, 'issue': f'pickle stream failed to parse cleanly: {e}', 'pos': None})
    return findings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('path')
    ap.add_argument('--type', choices=['raw', 'zip', 'auto'], default='auto')
    args = ap.parse_args()

    findings = []
    scanned = []

    is_zip = zipfile.is_zipfile(args.path)
    mode = args.type
    if mode == 'auto':
        mode = 'zip' if is_zip else 'raw'

    if mode == 'zip':
        if not is_zip:
            findings.append({'label': args.path, 'issue': 'expected a zip container (torch.save default format) but this is not a valid zip', 'pos': None})
        else:
            with zipfile.ZipFile(args.path) as zf:
                pickle_entries = [n for n in zf.namelist() if n.endswith('.pkl') or n.endswith('/data.pkl') or n == 'data.pkl']
                if not pickle_entries:
                    findings.append({'label': args.path, 'issue': 'zip container has no recognizable pickle entry (data.pkl) -- not a torch checkpoint shape', 'pos': None})
                for entry in pickle_entries:
                    scanned.append(entry)
                    data = zf.read(entry)
                    findings.extend(scan_pickle_bytes(data, entry))
    else:
        scanned.append(args.path)
        with open(args.path, 'rb') as f:
            data = f.read()
        findings.extend(scan_pickle_bytes(data, args.path))

    print(json.dumps({'clean': len(findings) == 0, 'findings': findings, 'scanned': scanned}))


if __name__ == '__main__':
    main()
