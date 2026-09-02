"""Measured end-to-end benchmark of the grounded answer path.

    python -m backend.tests.bench_llm

Runs the full visitor path - retrieval, rerank, gate, generation,
citation validation - against the locally installed Qwen, and reports RAM
around it. Every number is measured on this machine; nothing is estimated.
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

from ..app.core import config, db
from ..llm import QwenProvider
from ..retrieval import pipeline

QUESTIONS = [
    ("factual", "What did Ambedkar say about caste being a division of labourers?"),
    ("paraphrased", "Why did he think fixing people's jobs by birth harms an economy?"),
    ("multi-source", "How did Ambedkar argue for political safeguards for the "
                     "Depressed Classes at the Round Table Conference?"),
    ("date-specific", "What was debated in the Constituent Assembly on 15 June 1949?"),
    ("unsupported", "What did Ambedkar say about the Bombay Metro Rail project?"),
]


def available_gb() -> float:
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory"],
            capture_output=True, text=True, timeout=30)
        return int(out.stdout.strip()) / 1024 / 1024
    except Exception:
        return float("nan")


def main() -> int:
    provider = QwenProvider()
    health = provider.health()
    print(f"provider        : {provider.name()}")
    print(f"installed models: {provider.installed_models()}")
    print(f"health          : available={health.available} loaded={health.loaded} "
          f"({health.detail})")
    if not health.available:
        print("\nQwen unavailable - the pipeline will use the extractive fallback.")
        return 1

    ram_before = available_gb()
    print(f"RAM available before : {ram_before:.2f} GB")

    if not health.loaded:
        print("\nmodel not resident; loading (a cold load measured ~296s here)...")
        t0 = time.perf_counter()
        provider.generate("warm", [{"quote": "warm", "citation": "warm",
                                    "documentId": "d", "page": 1,
                                    "charStart": 0, "charEnd": 1}])
        print(f"cold load + first call: {time.perf_counter() - t0:.1f}s")

    ram_loaded = available_gb()
    print(f"RAM available with model resident: {ram_loaded:.2f} GB "
          f"(delta {ram_before - ram_loaded:+.2f} GB)")

    rows = []
    print(f"\n{'KIND':<14}{'GATE':>6}{'GROUNDED':>10}{'RETR ms':>9}{'GEN ms':>9}"
          f"{'TOTAL ms':>10}{'TOK':>5}{'TOK/S':>7}")
    print("-" * 74)

    with db.connect(readonly=True) as conn:
        for kind, q in QUESTIONS:
            r = pipeline.answer(conn, q)
            t = r.timings
            retr = t.total_ms - t.generate_ms
            g = r.generation or {}
            rows.append({
                "kind": kind, "question": q,
                "gate": bool(r.decision and r.decision.passed),
                "grounded": r.grounded, "fallback": r.fallback,
                "degraded": r.degraded,
                "retrieval_ms": round(retr, 1),
                "generate_ms": round(t.generate_ms, 1),
                "total_ms": round(t.total_ms, 1),
                "tokens": g.get("output_tokens", 0),
                "tokens_per_sec": g.get("tokens_per_sec"),
                "citations": r.citations.get("cited") if r.citations else None,
                "answer": r.answer,
                "evidence": [e["citation"] for e in r.evidence],
            })
            print(f"{kind:<14}{'PASS' if rows[-1]['gate'] else 'FAIL':>6}"
                  f"{str(r.grounded):>10}{retr:9.0f}{t.generate_ms:9.0f}"
                  f"{t.total_ms:10.0f}{g.get('output_tokens', 0):5d}"
                  f"{(g.get('tokens_per_sec') or 0):7.1f}")

    print("\n" + "=" * 74)
    for row in rows:
        print(f"\n[{row['kind']}] {row['question']}")
        print(f"  gate={row['gate']} grounded={row['grounded']} "
              f"fallback={row['fallback']}"
              + (f" degraded={row['degraded']}" if row["degraded"] else ""))
        print(f"  answer  : {row['answer'][:260]}")
        if row["citations"]:
            print(f"  cited   : {row['citations']}")
        for c in row["evidence"][:2]:
            print(f"  source  : {c}")

    ram_after = available_gb()
    print(f"\nRAM available after: {ram_after:.2f} GB")

    out = Path(config.ARCHIVE_DIR) / "bench_llm.json"
    out.write_text(json.dumps(
        {"provider": provider.name(),
         "ram_gb": {"before": ram_before, "loaded": ram_loaded, "after": ram_after},
         "rows": rows}, indent=1), encoding="utf-8")
    print("written:", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
