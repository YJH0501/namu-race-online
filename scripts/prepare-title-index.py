"""Offline catalog preparation, not a runtime dependency. Requires duckdb==1.5.5.

Reads the title/text/namespace columns of one pinned, public Parquet snapshot.
Only titles and validation flags are retained; no article text or contributors.
This checks the historical snapshot, NOT current live document availability.
"""
import argparse
import collections
import datetime
import json
from pathlib import Path

import duckdb

REVISION = "5631a9bd17a096bab2cd02ea23adbf2327db0d91"
SOURCE = f"https://huggingface.co/datasets/heegyu/namuwiki/resolve/{REVISION}/namuwiki_20210301.parquet"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".catalog-cache/source-index.json")
    args = parser.parse_args()
    db = duckdb.connect()
    db.execute("INSTALL httpfs; LOAD httpfs")
    db.execute("SET threads=2; SET memory_limit='512MB'; SET http_timeout=60")
    # Filtering is local SQL over the published dataset, not requests to NamuWiki.
    rows = db.execute(r"""
        SELECT title,
          CASE
            WHEN coalesce(namespace, '') <> '' THEN 'namespace'
            WHEN title IS NULL OR length(trim(title)) = 0 OR length(title) > 200 THEN 'title'
            WHEN regexp_matches(coalesce(text,''), '^\s*#(redirect|넘겨주기)\s', 'i') THEN 'redirect'
            WHEN length(trim(coalesce(text,''))) < 80 THEN 'short'
            WHEN NOT regexp_matches(coalesce(text,''), '\[\[[^:\]\[|#\r\n]{1,200}(\||#|\]\])') THEN 'noArticleLink'
            ELSE 'eligible'
          END AS status
        FROM read_parquet(?)
    """, [SOURCE])
    eligible, rejected = [], []
    counts = collections.Counter()
    while batch := rows.fetchmany(4000):
        for title, status in batch:
            counts[status] += 1
            if status == "eligible":
                eligible.append(title)
            elif title:
                rejected.append(title)
        if sum(counts.values()) % 40000 == 0:
            print(f"Indexed {sum(counts.values()):,} rows", flush=True)
    assert sum(counts.values()) == 867024, "Unexpected pinned source row count"
    result = {
        "source": SOURCE,
        "sourcePage": "https://huggingface.co/datasets/heegyu/namuwiki",
        "sourceRevision": REVISION,
        "preparedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "snapshotDateNote": "Filename says 20210301; dataset card says 2022/03/01. Historical, not live-verified.",
        "validation": "snapshot-only",
        "counts": dict(counts),
        "eligible": eligible,
        "rejected": rejected,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(output), "counts": dict(counts)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
