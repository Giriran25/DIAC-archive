"""Measured reranker bake-off on this laptop.

    python -m backend.tests.bench_rerankers

Retrieval up to and including fusion is model-independent, so it runs
once and the fused candidates are cached. Each reranker then scores the
same candidates, which makes the latency and quality comparison fair and
keeps the whole run quick.

Reports, per model: load time, per-query rerank latency, and hit rate
against the provisional smoke set. Nothing here is estimated.
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

from ..app.core import config, db
from ..retrieval import embedder as emb
from ..retrieval import fusion, lexical, vector
from ..retrieval import rerank as rr

CANDIDATES = [
    "cross-encoder/ms-marco-MiniLM-L-6-v2",
    "cross-encoder/ms-marco-MiniLM-L-12-v2",
    "BAAI/bge-reranker-base",
]

EVAL = Path(__file__).parent / "eval" / "provisional_smoke_set.json"


def load_questions():
    data = json.loads(EVAL.read_text(encoding="utf-8"))
    return data["answerable"], data["unanswerable"]


def matches(row, item) -> bool:
    """Section-level label match: right document, and right section when
    the label names sections."""
    if row["document_id"] not in item["docs"]:
        return False
    if not item.get("sections"):
        return True
    return row["section"] in item["sections"]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=CANDIDATES)
    ap.add_argument("--evidence-k", type=int, default=5)
    args = ap.parse_args(argv)

    answerable, _ = load_questions()
    index = vector.load()
    if index is None:
        print("No FAISS index - run: python -m backend.ingest.build_index")
        return 2

    print(f"corpus     : {index.size:,} vectors, model {index.model_name}")
    print(f"questions  : {len(answerable)} answerable (provisional set)")
    print(f"shape      : dense {config.RETRIEVE_DENSE_K} + lexical "
          f"{config.RETRIEVE_LEXICAL_K} -> fuse {config.FUSION_K} -> top {args.evidence_k}\n")

    # ---- stage 1: fusion, once ----------------------------------------
    embedder = emb.get_embedder()
    cached = []
    with db.connect(readonly=True) as conn:
        t0 = time.perf_counter()
        for item in answerable:
            q = item["q"]
            qvec = embedder.encode_query(q)
            dense = index.search(qvec, config.RETRIEVE_DENSE_K)
            lex = lexical.search(conn, q, limit=config.RETRIEVE_LEXICAL_K)
            fused = fusion.reciprocal_rank_fusion(dense, lex, limit=config.FUSION_K)
            rows = lexical.hydrate(conn, [f.chunk_id for f in fused])
            cached.append((item, fused, rows))
        print(f"fusion for all questions: {(time.perf_counter()-t0):.1f}s "
              f"(shared by every model)\n")

    # baseline: how good is fusion alone, before any reranking?
    base_top1 = sum(
        1 for item, fused, rows in cached
        if fused and fused[0].chunk_id in rows and matches(rows[fused[0].chunk_id], item)
    )
    base_r5 = sum(
        1 for item, fused, rows in cached
        if any(f.chunk_id in rows and matches(rows[f.chunk_id], item) for f in fused[:5])
    )
    n = len(cached)
    print(f"{'MODEL':<42}{'LOAD':>7}{'MED ms':>9}{'P90 ms':>9}{'TOP-1':>8}{'REC@5':>8}")
    print("-" * 83)
    print(f"{'(no reranker - RRF fusion only)':<42}{'-':>7}{'-':>9}{'-':>9}"
          f"{base_top1}/{n:<5}{base_r5}/{n:<5}")

    results = []
    for name in args.models:
        try:
            t0 = time.perf_counter()
            reranker = rr.Reranker(name)
            load_s = time.perf_counter() - t0
        except Exception as exc:
            print(f"{name:<42}  FAILED TO LOAD: {str(exc)[:40]}")
            continue

        lat, top1, rec5 = [], 0, 0
        for item, fused, rows in cached:
            texts = {cid: r["text"] for cid, r in rows.items()}
            t0 = time.perf_counter()
            top = reranker.rerank(item["q"], fused, texts, top_k=args.evidence_k)
            lat.append((time.perf_counter() - t0) * 1000)
            if top and top[0].chunk_id in rows and matches(rows[top[0].chunk_id], item):
                top1 += 1
            if any(h.chunk_id in rows and matches(rows[h.chunk_id], item) for h in top[:5]):
                rec5 += 1

        med = statistics.median(lat)
        p90 = sorted(lat)[int(len(lat) * 0.9) - 1]
        print(f"{name:<42}{load_s:6.1f}s{med:9.0f}{p90:9.0f}{top1}/{n:<5}{rec5}/{n:<5}")
        results.append({"model": name, "load_s": load_s, "median_ms": med,
                        "p90_ms": p90, "top1": top1, "recall5": rec5, "n": n})

        # Release before loading the next one - RAM is tight on this laptop.
        del reranker
        import gc
        gc.collect()

    print("\ncandidates reranked per query:", config.FUSION_K)
    out = Path(config.ARCHIVE_DIR) / "bench_rerankers.json"
    out.write_text(json.dumps(
        {"baseline": {"top1": base_top1, "recall5": base_r5, "n": n},
         "fusion_k": config.FUSION_K, "results": results}, indent=1), encoding="utf-8")
    print("written:", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
