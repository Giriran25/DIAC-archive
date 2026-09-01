"""Embed the canonical archive and build the FAISS index.

    python -m backend.ingest.build_index
    python -m backend.ingest.build_index --rebuild

Only `chunk_kind = 'body'` chunks are embedded. Tables of contents and
statistical appendices are withheld from retrieval for the reasons
established in Phase 1, and embedding them would waste time and let them
back in through the dense half.

Writes `chunks.faiss_id` so the SQLite row, the FTS5 rowid and the FAISS
vector id are provably the same integer.
"""

from __future__ import annotations

import argparse
import time

import numpy as np

from ..app.core import config, db
from ..retrieval import embedder as emb
from ..retrieval import vector


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build the DAIC ARCHIVE vector index")
    ap.add_argument("--model", default=None, help="override the embedding model")
    ap.add_argument("--rebuild", action="store_true", help="ignore any existing index")
    ap.add_argument("--limit", type=int, default=None, help="embed only N chunks (smoke test)")
    args = ap.parse_args(argv)

    if not config.DB_PATH.exists():
        print("archive database not found - run: python -m backend.ingest.build")
        return 2

    with db.connect(readonly=True) as conn:
        rows = conn.execute(
            """SELECT c.id, c.text
                 FROM chunks c
                 JOIN documents d ON d.id = c.document_id
                WHERE c.chunk_kind = 'body'
                  AND c.verification_status = 'approved'
                  AND d.verification_status = 'approved'
                ORDER BY c.id"""
        ).fetchall()

    if args.limit:
        rows = rows[: args.limit]
    if not rows:
        print("no approved body chunks to embed")
        return 1

    ids = [int(r["id"]) for r in rows]
    texts = [r["text"] for r in rows]
    total_chars = sum(len(t) for t in texts)

    print(f"chunks to embed : {len(ids):,}  ({total_chars:,} chars)")
    print(f"model           : {args.model or config.EMBED_MODEL}")

    load_start = time.perf_counter()
    embedder = emb.get_embedder(args.model)
    print(f"model loaded    : {embedder.load_seconds:.1f}s  dim={embedder.dim}  "
          f"query_prefix={embedder.prefixes.query[:34]!r}")

    started = time.perf_counter()
    vectors = embedder.encode_passages(texts, show_progress=True)
    elapsed = time.perf_counter() - started

    print(f"\nembedded        : {len(vectors):,} vectors  dim={vectors.shape[1]}")
    print(f"time            : {elapsed:.1f}s  "
          f"({len(ids)/elapsed:.1f} chunks/s, {total_chars/elapsed/1000:.1f}k chars/s)")

    # Unit length is what makes IndexFlatIP a cosine index. Verify rather
    # than trust: a silently unnormalised vector degrades every result.
    norms = np.linalg.norm(vectors, axis=1)
    print(f"L2 norms        : min={norms.min():.4f} max={norms.max():.4f} "
          f"(must be ~1.0)")
    if not np.allclose(norms, 1.0, atol=1e-3):
        print("ERROR: embeddings are not unit length; refusing to build the index")
        return 1

    index = vector.build(vectors, ids, dim=embedder.dim)
    path = vector.save(index)
    print(f"faiss index     : {index.size:,} vectors -> {path}")

    with db.connect() as conn:
        conn.executemany(
            "UPDATE chunks SET faiss_id = ? WHERE id = ?", [(i, i) for i in ids]
        )
        db.log(
            conn, "index", None,
            f"vector index model={embedder.model_name} dim={embedder.dim} "
            f"vectors={index.size} seconds={elapsed:.1f}",
            actor="ingest",
        )
        conn.commit()

    print(f"total wall time : {time.perf_counter() - load_start:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
