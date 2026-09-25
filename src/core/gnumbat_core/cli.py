"""``python -m gnumbat_core`` — headless interface to the same core the plugin uses."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .jsonio import read_json
from .settings import default_library_root, load_settings


def _lib(args):
    from .library import Library

    return Library(args.library or load_settings().get("library_root") or default_library_root())


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="gnumbat", description="Gnumbat core CLI")
    ap.add_argument("-l", "--library", help="library folder (default: settings.library_root)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="create a library")
    b = sub.add_parser("bake", help="create a Bake from a WAV file")
    b.add_argument("wav")
    b.add_argument("-n", "--notation", default="")
    b.add_argument("-p", "--profile", help="notation profile id (default freeform)")
    b.add_argument("--submit", action="store_true", help="queue decomposition+analysis")
    b.add_argument("--decompose", default="auto", help="auto|skip|demucs|testsplit")
    w = sub.add_parser("worker", help="run the job worker")
    w.add_argument("--once", action="store_true", help="drain the queue and exit")
    sub.add_parser("status", help="worker + queue + Bake state counts")
    ls = sub.add_parser("list", help="list Bakes")
    ls.add_argument("-t", "--text")
    ls.add_argument("-f", "--filter", help="filter JSON (see docs)")
    sub.add_parser("catalog", help="which filterable fields exist in this library")
    mp = sub.add_parser("map", help="compute the Bake Map for a feature set")
    mp.add_argument("--space", default="spectral")
    mp.add_argument("--method", default="tsne")
    ds = sub.add_parser("dataset", help="datasets")
    dss = ds.add_subparsers(dest="dcmd", required=True)
    dc = dss.add_parser("create"); dc.add_argument("name"); dc.add_argument("-f", "--filter"); dc.add_argument("--all", action="store_true")
    dv = dss.add_parser("version"); dv.add_argument("dataset_id"); dv.add_argument("--allow-test", action="store_true")
    de = dss.add_parser("export"); de.add_argument("dataset_version_id"); de.add_argument("out"); de.add_argument("--no-stems", action="store_true")
    dvf = dss.add_parser("verify"); dvf.add_argument("out")
    dm = sub.add_parser("demo", help="fill a library with synthetic test fixtures")
    dm.add_argument("-n", type=int, default=40)
    sub.add_parser("adopt", help="attach stems the instrument pipeline (watch_demucs.py) finished for handed-off Bakes")
    sub.add_parser("validate", help="verify every Bake")
    args = ap.parse_args(argv)

    if args.cmd == "init":
        from .library import Library

        root = Path(args.library or default_library_root())
        Library.init(root)
        print(f"library ready: {root}")
        return 0
    lib = _lib(args)
    if args.cmd == "bake":
        prof = lib.get_profile(args.profile)
        bid = lib.create_bake(source_wav=args.wav, raw_notation=args.notation, profile=prof, submit=args.submit,
                              process_params={"decompose": args.decompose})
        print(bid)
    elif args.cmd == "worker":
        from .worker import Worker

        return Worker(lib, load_settings()).run(once=args.once)
    elif args.cmd == "status":
        from .jobs import JobQueue
        from collections import Counter

        wj = lib.root / "worker.json"
        print("worker:", json.dumps(read_json(wj)) if wj.exists() else "not running")
        print("jobs:", JobQueue(lib).counts())
        print("bakes:", dict(Counter(v["state"] for v in lib.views())))
    elif args.cmd == "list":
        q = json.loads(args.filter) if args.filter else ({"text": args.text} if args.text else None)
        for v in lib.query(q):
            print(f"{v['id']}  {v['state']:<11} {v['duration_s']:>6.1f}s  {v['notation']!r}  tags={v['tags']}")
    elif args.cmd == "catalog":
        from .filters import field_catalog

        for path, e in sorted(field_catalog(lib.views()).items()):
            if not path.startswith("analysis/summary/"):
                print(f"{path:<28} {','.join(e['types']):<14} n={e['count']:<4} range={e['min']}..{e['max']}  {[v['value'] for v in e['values'][:4]]}")
    elif args.cmd == "map":
        from .mapproj import project_map

        d = project_map(lib, args.space, args.method)
        print(f"{d['method']['name']} map, {len(d['points'])} points, trustworthiness={d['quality']['trustworthiness']}")
    elif args.cmd == "dataset":
        from . import dataset as D

        if args.dcmd == "create":
            q = json.loads(args.filter) if args.filter else None
            print(D.create_dataset(lib, args.name, bake_ids=[] if q else [v["id"] for v in lib.views()], filter_query=q))
        elif args.dcmd == "version":
            dv = D.create_version(lib, args.dataset_id, allow_test=args.allow_test)
            print(dv["dataset_version_id"], f"({len(dv['items'])} Bakes, {dv['analysis_profile']['extractor']})")
        elif args.dcmd == "export":
            print(D.export_version(lib, args.dataset_version_id, args.out, include_stems=not args.no_stems))
        elif args.dcmd == "verify":
            p = D.verify_export(args.out)
            print("OK" if not p else "\n".join(p))
            return 1 if p else 0
    elif args.cmd == "demo":
        from .demo import generate_demo

        ids_ = generate_demo(lib, args.n, submit=True)
        print(f"created {len(ids_)} demo Bakes and queued them; run `gnumbat worker --once`")
    elif args.cmd == "adopt":
        from .worker import Worker

        n = Worker(lib, load_settings()).scan_handoffs()
        print(f"queued {n} adoption job(s)" + ("; run `gnumbat worker --once` to process them" if n else ""))
        return 0
    elif args.cmd == "validate":
        bad = 0
        for bid in lib.list_bake_ids():
            p = lib.verify_bake(bid)
            if p:
                bad += 1
                print(bid, *p, sep="\n  ")
        print("all Bakes valid" if not bad else f"{bad} Bake(s) with problems")
        return 1 if bad else 0
    return 0
