"""Phase 2 evaluation and gate calibration.

    python -m backend.tests.evaluate
    python -m backend.tests.evaluate --no-rerank
    python -m backend.tests.evaluate --tune

Reports retrieval quality, gate behaviour and per-stage latency against
the provisional smoke set.

Every number here comes from a run on this machine. The QUALITY numbers
are provisional - the questions were written by the implementer, so they
show the pipeline works, not how well it works. Replace the set with P4's
independent one before quoting quality as an evaluation result. The
LATENCY numbers are real measurements and do not carry that caveat.
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

from ..app.core import config, db
from ..retrieval import gate, pipeline

EVAL = Path(__file__).parent / "eval" / "provisional_smoke_set.json"


def load():
    d = json.loads(EVAL.read_text(encoding="utf-8"))
    return d["answerable"], d["unanswerable"]


def matches(ev: dict, item: dict) -> bool:
    if ev["documentId"] not in item["docs"]:
        return False
    if not item.get("sections"):
        return True
    return ev.get("section") in item["sections"]


def citation_ok(ev: dict) -> bool:
    """A citation is correct only if it can actually be followed."""
    if not ev.get("citation") or not ev.get("documentId"):
        return False
    if ev.get("pdfPage") is None:
        return False
    if ev.get("charStart") is None or ev.get("charEnd") is None:
        return False
    # It must name a page: either a printed page or an explicit PDF page.
    return ("p. " in ev["citation"]) or ("pp. " in ev["citation"])


def run(use_reranker: bool, evidence_k: int = 5) -> dict:
    answerable, unanswerable = load()
    rows = []

    with db.connect(readonly=True) as conn:
        # Warm once so the first question does not carry model load time.
        pipeline.search(conn, "warm up", use_reranker=use_reranker, evidence_k=evidence_k)

        for item in answerable:
            r = pipeline.search(conn, item["q"], use_reranker=use_reranker,
                                evidence_k=evidence_k, apply_gate=False)
            ev = r.evidence
            rows.append({
                "id": item["id"], "class": item["class"], "kind": "answerable",
                "top1": bool(ev) and matches(ev[0], item),
                "recall5": any(matches(e, item) for e in ev[:5]),
                "citation_ok": all(citation_ok(e) for e in ev) if ev else False,
                "score": ev[0]["scores"]["rerank"] if ev else None,
                "coverage": gate.coverage_of(item["q"], [
                    {"text": e["quote"]} for e in ev
                ]) if ev else 0.0,
                "t": r.timings.as_dict(),
            })

        for item in unanswerable:
            r = pipeline.search(conn, item["q"], use_reranker=use_reranker,
                                evidence_k=evidence_k, apply_gate=True)
            ungated = pipeline.search(conn, item["q"], use_reranker=use_reranker,
                                      evidence_k=evidence_k, apply_gate=False)
            ev = ungated.evidence
            rows.append({
                "id": item["id"], "class": item["class"], "kind": "unanswerable",
                "refused": not r.decision.passed,
                "reason": r.decision.reason,
                "score": ev[0]["scores"]["rerank"] if ev else None,
                "coverage": gate.coverage_of(item["q"], [
                    {"text": e["quote"]} for e in ev
                ]) if ev else 0.0,
                "t": r.timings.as_dict(),
            })

    ans = [r for r in rows if r["kind"] == "answerable"]
    una = [r for r in rows if r["kind"] == "unanswerable"]
    return {
        "reranker": use_reranker,
        "n_answerable": len(ans),
        "n_unanswerable": len(una),
        "top1": sum(r["top1"] for r in ans),
        "recall5": sum(r["recall5"] for r in ans),
        "citation_ok": sum(r["citation_ok"] for r in ans),
        "refused": sum(r["refused"] for r in una),
        "rows": rows,
    }


def latency_table(rows: list[dict]) -> dict:
    stages = ["embed_ms", "dense_ms", "lexical_ms", "fusion_ms",
              "hydrate_ms", "rerank_ms", "gate_ms", "answer_ms", "total_ms"]
    out = {}
    for s in stages:
        vals = [r["t"][s] for r in rows if r["t"].get(s) is not None]
        if vals:
            out[s] = {
                "median": round(statistics.median(vals), 2),
                "p90": round(sorted(vals)[max(0, int(len(vals) * 0.9) - 1)], 2),
                "max": round(max(vals), 2),
            }
    return out


def tune(result: dict) -> None:
    """Sweep the relevance floor and report the trade-off.

    A gate has two ways to fail: refusing a question it could have
    answered, and answering one it should have refused. The second is far
    worse for this product - an unsupported answer is the failure the whole
    archive exists to prevent - so the sweep is reported in full rather
    than collapsed into one 'best' number.
    """
    ans = [r for r in result["rows"] if r["kind"] == "answerable" and r["score"] is not None]
    una = [r for r in result["rows"] if r["kind"] == "unanswerable" and r["score"] is not None]
    if not ans or not una:
        print("not enough scored rows to tune")
        return

    scores = sorted({round(r["score"], 3) for r in ans + una})
    print(f"\n{'FLOOR':>9}{'ANSWERED':>11}{'FALSE REFUSE':>15}{'REFUSED BAD':>14}{'LEAKED':>9}")
    print("-" * 60)
    cov = gate.COVERAGE_FLOOR
    for floor in scores:
        answered = sum(1 for r in ans if r["score"] >= floor and r["coverage"] >= cov)
        false_ref = len(ans) - answered
        refused_bad = sum(1 for r in una if not (r["score"] >= floor and r["coverage"] >= cov))
        leaked = len(una) - refused_bad
        flag = "  <-- current" if abs(floor - gate.RELEVANCE_FLOOR) < 0.05 else ""
        print(f"{floor:9.3f}{answered:>6}/{len(ans):<4}{false_ref:>10}   "
              f"{refused_bad:>7}/{len(una):<5}{leaked:>7}{flag}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-rerank", action="store_true")
    ap.add_argument("--both", action="store_true", help="run with and without the reranker")
    ap.add_argument("--tune", action="store_true", help="sweep the gate relevance floor")
    ap.add_argument("-k", type=int, default=5)
    args = ap.parse_args(argv)

    print("PROVISIONAL SMOKE SET - quality numbers are not a final evaluation.")
    print(f"corpus: {config.DB_PATH.name}   evidence_k={args.k}\n")

    configs = [True, False] if args.both else [not args.no_rerank]
    results = []
    for use in configs:
        label = "WITH reranker" if use else "WITHOUT reranker (RRF only)"
        t0 = time.perf_counter()
        res = run(use, evidence_k=args.k)
        res["wall_s"] = time.perf_counter() - t0
        results.append(res)

        n, m = res["n_answerable"], res["n_unanswerable"]
        print(f"=== {label} ===")
        print(f"  Top-1 accuracy      {res['top1']}/{n}   ({res['top1']/n:.0%})")
        print(f"  Recall@5            {res['recall5']}/{n}   ({res['recall5']/n:.0%})")
        print(f"  Citation correct    {res['citation_ok']}/{n}   ({res['citation_ok']/n:.0%})")
        print(f"  Refused unanswerable {res['refused']}/{m}   ({res['refused']/m:.0%})")

        lat = latency_table(res["rows"])
        print(f"\n  {'STAGE':<14}{'MEDIAN ms':>11}{'P90 ms':>10}{'MAX ms':>10}")
        for stage, v in lat.items():
            print(f"  {stage:<14}{v['median']:>11.1f}{v['p90']:>10.1f}{v['max']:>10.1f}")
        res["latency"] = lat
        print()

        if args.tune:
            tune(res)
            print()

    out = Path(config.ARCHIVE_DIR) / "evaluation.json"
    out.write_text(json.dumps(results, indent=1), encoding="utf-8")
    print("written:", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
