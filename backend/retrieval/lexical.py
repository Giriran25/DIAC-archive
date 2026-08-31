"""Lexical retrieval over SQLite FTS5 - the keyword half of hybrid search.

FAISS supplies the semantic half in Phase 2; the two are fused by
reciprocal rank. Kept deliberately separate so either can be tested,
tuned, or replaced on its own.

FTS5 scoring is BM25, computed by SQLite over the whole indexed corpus
rather than the hand-rolled implementation the browser engine used. That
matters at 961 chunks and will matter more at 2,350.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass

# FTS5 treats these as query syntax. User text is not a query language, so
# every token is quoted and the operators are never passed through.
_TOKEN = re.compile(r"[^\W\d_]+|\d+", re.UNICODE)

# Very common words carry no discriminating power and, with 961 chunks,
# dominate an OR query. Mirrors the stopword list already used by the
# frontend engine so both halves behave alike.
STOPWORDS = frozenset("""
a about an and any are as at be been but by can did do does for from had has
have he her his how i in is it its me my of on or our say said says she should
so some such than that the their them then there these they this to was we
were what when where which who why will with would you your tell give show
explain please
""".split())


@dataclass
class LexicalHit:
    chunk_id: int
    uid: str
    score: float          # higher is better
    rank: int             # 1-based


def build_match_query(question: str, *, mode: str = "or") -> str | None:
    """Turn free text into a safe FTS5 MATCH expression.

    Every token is double-quoted, so punctuation, stray quotes and FTS5
    operators in user input cannot alter the query's structure.
    """
    tokens = [t.lower() for t in _TOKEN.findall(question or "")]
    terms = [t for t in tokens if len(t) > 2 and t not in STOPWORDS]
    if not terms:
        # Fall back to any token at all rather than refusing outright -
        # the evidence gate, not the tokenizer, decides what is answerable.
        terms = [t for t in tokens if t]
    if not terms:
        return None

    seen: list[str] = []
    for t in terms:
        if t not in seen:
            seen.append(t)

    joiner = " OR " if mode == "or" else " AND "
    return joiner.join(f'"{t}"' for t in seen)


def search(
    conn: sqlite3.Connection,
    question: str,
    *,
    limit: int = 10,
    doc_type: str | None = None,
    language: str | None = None,
    approved_only: bool = True,
    body_only: bool = True,
) -> list[LexicalHit]:
    """Rank chunks by BM25. Returns [] when the query has no usable terms."""
    match = build_match_query(question)
    if not match:
        return []

    where = ["chunks_fts MATCH ?"]
    params: list[object] = [match]

    # Tables of contents and volume listings match almost any query and
    # would outrank the passage that actually answers it.
    if body_only:
        where.append("c.chunk_kind = 'body'")

    if approved_only:
        where.append("c.verification_status = 'approved'")
        where.append("d.verification_status = 'approved'")
    if doc_type:
        where.append("d.doc_type = ?")
        params.append(doc_type)
    if language:
        where.append("c.language = ?")
        params.append(language)

    params.append(limit)

    sql = f"""
        SELECT c.id AS chunk_id,
               c.uid AS uid,
               -bm25(chunks_fts) AS score
          FROM chunks_fts
          JOIN chunks    c ON c.id = chunks_fts.rowid
          JOIN documents d ON d.id = c.document_id
         WHERE {' AND '.join(where)}
         ORDER BY score DESC
         LIMIT ?
    """
    rows = conn.execute(sql, params).fetchall()
    return [
        LexicalHit(chunk_id=r["chunk_id"], uid=r["uid"], score=float(r["score"]), rank=i + 1)
        for i, r in enumerate(rows)
    ]


def hydrate(conn: sqlite3.Connection, chunk_ids: list[int]) -> dict[int, sqlite3.Row]:
    """Fetch full chunk + document rows for a set of ids, preserving nothing
    about order (the caller already knows the ranking)."""
    if not chunk_ids:
        return {}
    placeholders = ",".join("?" * len(chunk_ids))
    sql = f"""
        SELECT c.*,
               d.title       AS doc_title,
               d.volume      AS doc_volume,
               d.doc_type    AS doc_type,
               d.date_text   AS doc_date,
               d.author      AS doc_author,
               d.source      AS doc_source,
               d.file_path   AS doc_path,
               d.extraction_method AS extraction_method
          FROM chunks c
          JOIN documents d ON d.id = c.document_id
         WHERE c.id IN ({placeholders})
    """
    return {row["id"]: row for row in conn.execute(sql, chunk_ids).fetchall()}
