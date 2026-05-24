#!/usr/bin/env python3
"""Bridge between the Matchwerk Next.js app and python-jobspy.

Reads a single JSON object from argv[1] with this shape:
  {
    "job_titles": ["Product Designer", "Senior Product Designer"],
    "location":   "Berlin, Germany",   # or "Germany" for nationwide
    "is_remote":  false,
    "results_wanted": 25,
    "hours_old":  168,                 # 7 days
    "sites":      ["indeed", "linkedin", "glassdoor"]
  }

Writes a JSON array of jobs to stdout.
On error, exits non-zero with the message on stderr.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Any

try:
    from jobspy import scrape_jobs
except ImportError as exc:  # pragma: no cover - install-time guidance
    sys.stderr.write(
        "python-jobspy not installed in this venv. "
        "Run: .venv-jobspy/bin/pip install python-jobspy\n"
    )
    sys.stderr.write(f"{exc}\n")
    sys.exit(2)


def _coerce(value: Any) -> Any:
    """JSON-safe pandas value: NaN/NaT -> None, datetimes -> ISO strings."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    return value


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: jobspy_bridge.py '<json>'\n")
        return 2
    try:
        params = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"invalid JSON argument: {exc}\n")
        return 2

    titles = [t for t in params.get("job_titles", []) if t and t.strip()]
    if not titles:
        json.dump([], sys.stdout)
        return 0

    location = (params.get("location") or "Germany").strip()
    is_remote = bool(params.get("is_remote", False))
    results_wanted = int(params.get("results_wanted", 25))
    hours_old = int(params.get("hours_old", 168))
    sites = params.get("sites") or ["indeed", "linkedin", "glassdoor"]

    # Per-title quota so multiple titles each get fair share.
    per_title = max(5, results_wanted // max(1, len(titles)))

    rows: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for title in titles:
        try:
            df = scrape_jobs(
                site_name=sites,
                search_term=title,
                location=location,
                results_wanted=per_title,
                hours_old=hours_old,
                country_indeed="germany",
                is_remote=is_remote,
                description_format="markdown",
                linkedin_fetch_description=False,
                verbose=0,
            )
        except Exception as exc:  # noqa: BLE001 — bubble up adapter-side
            sys.stderr.write(f"[jobspy] '{title}': {exc}\n")
            continue

        if df is None or len(df) == 0:
            continue

        for record in df.to_dict(orient="records"):
            ext_id = str(record.get("id") or record.get("job_url") or "")
            if not ext_id or ext_id in seen_ids:
                continue
            seen_ids.add(ext_id)
            rows.append({k: _coerce(v) for k, v in record.items()})

    json.dump(rows, sys.stdout, default=str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
