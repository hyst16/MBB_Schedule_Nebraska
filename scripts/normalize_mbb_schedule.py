#!/usr/bin/env python3
"""
Normalize the raw men's basketball scrape into a compact, UI-friendly JSON.

Key behaviors:
- Keep opponent title as plain text (no "#N " prefix).
- Preserve nu_rank / opp_rank as numbers for pill rendering.
- Parse dates robustly (prefer ISO from scraper; fallback to visible month/day).
- Filter out games not in the current season.
- Sort chronologically.
"""
import json
import re
from pathlib import Path
from datetime import datetime
from dateutil import tz

DATA = Path("data")
RAW  = DATA / "mbb_raw.json"
OUT  = DATA / "mbb_schedule_normalized.json"

CENTRAL = tz.gettz("America/Chicago")

# Canonical 3-letter month mapping (case-insensitive; allows "Sept."/"September")
MONTH_IDX = {
    "jan":1, "feb":2, "mar":3, "apr":4, "may":5, "jun":6,
    "jul":7, "aug":8, "sep":9, "oct":10, "nov":11, "dec":12,
}

def slug(s: str) -> str:
    """Lowercase, dash-separated key."""
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-")

def parse_date_from_text(label: str, season_year: int) -> str | None:
    """
    Accepts 'AUG 22', 'Sep 5', 'Sept. 5', 'September 5' (case-insensitive).
    Returns 'YYYY-MM-DD' or None.
    """
    if not label:
        return None
    m = re.match(r"\s*([A-Za-z.]+)\s+(\d{1,2})\s*$", label)
    if not m:
        return None
    mon_token = m.group(1).replace(".", "")
    mon_key = mon_token[:3].lower()   # AUG -> aug, Sept -> sep, September -> sep
    mon = MONTH_IDX.get(mon_key)
    if not mon:
        return None
    day = int(m.group(2))
    return f"{season_year:04d}-{mon:02d}-{day:02d}"

def normalize(items: list, scraped_at: str):
    """Convert raw items to a simple, sorted list suitable for the UI."""
    try:
        season_year = datetime.fromisoformat((scraped_at or "").replace("Z", "+00:00")).year
    except Exception:
        season_year = datetime.now(CENTRAL).year

    rows = []
    for it in items:
        # --- DATE: prefer ISO, else parse visible month/day text ---
        date_iso = it.get("date") or parse_date_from_text(it.get("date_text"), season_year)
        if not date_iso:
            continue  # skip if we still couldn't get a date

        # --- Keep only rows from the current season ---
        if not str(date_iso).startswith(f"{season_year}-"):
            continue

        han = it.get("venue_type") or "N"

        city  = (it.get("city") or "").strip() or None
        arena = (it.get("arena") or "").strip() or None
        if arena:
            # Trim any sponsor suffixes after "presented by ..."
            arena = re.sub(r"\s*presented by\b.*$", "", arena, flags=re.I).strip()
        arena_key = slug(arena or "unknown")

        # --- Result / status ---
        res = it.get("result")
        status = "final" if res else "scheduled"
        result_str = None
        result_css = None
        if res:
            # Example: {"outcome": "W", "sets": "3-1"} -> "W 3-1"
            result_str = f"{res.get('outcome')} {res.get('sets')}"
            result_css = {"W": "W", "L": "L", "T": "T"}.get(res.get("outcome"))

        opp = it.get("opponent_name") or "TBA"
        opp_rank = it.get("opp_rank")
        nu_rank  = it.get("nu_rank")

        # IMPORTANT: title is plain text — no "#N " prefix here
        title = opp

        rows.append({
            "date": date_iso,
            "time_local": it.get("time_local"),
            "home_away": han,
            "nu_rank": nu_rank,
            "opponent": opp,
            "opp_rank": opp_rank,
            "title": title,                   # plain, no rank prefix
            "arena": arena,
            "city": city,
            "arena_key": arena_key,
            "nu_logo": it.get("nebraska_logo_url"),
            "opp_logo": it.get("opponent_logo_url"),
            "tv_logo": it.get("tv_network_logo_url"),
            "tv": it.get("networks") or [],   # rarely used; logos preferred
            "status": status,
            "result": result_str,
            "result_css": result_css,
            "notes": None,
            "links": it.get("links") or [],
        })

    # Sorted by date then time (null times sorted last)
    rows.sort(key=lambda x: (x.get("date") or "9999-12-31", x.get("time_local") or "23:59"))
    return rows

def main():
    raw = json.loads(RAW.read_text("utf-8")) if RAW.exists() else {}
    items = raw.get("items", [])
    scraped_at = raw.get("scraped_at") or ""
    normalized = {"items": normalize(items, scraped_at)}
    OUT.write_text(json.dumps(normalized, indent=2), encoding="utf-8")
    print(f"wrote {OUT}")

if __name__ == "__main__":
    main()
