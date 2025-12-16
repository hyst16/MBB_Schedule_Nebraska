#!/usr/bin/env python3
"""
Normalize the raw men's basketball scrape into a compact, UI-friendly JSON.

Key behaviors:
- Keep opponent title as plain text (no "#N " prefix).
- Preserve nu_rank / opp_rank as numbers for pill rendering.
- Parse dates robustly (prefer ISO from scraper; fallback to visible month/day).
- Handle fall–spring seasons that span two calendar years.
- Skip "Opening Night Presented by SCHEELS" (NU vs NU scrimmage).
- Skip generic Big Ten Tournament placeholders ("Big Ten First Round", etc.).
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

MONTH_IDX = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

def slug(s: str) -> str:
    """Lowercase, dash-separated key."""
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-")

def detect_season_start_year(scraped: datetime) -> int:
    """
    For fall–spring sports:
    - If we scraped in Jan–Mar, assume the season started the previous year.
    - Otherwise, assume it started in the current year.
    """
    if scraped.month <= 3:
        return scraped.year - 1
    return scraped.year

def parse_date_from_text(label: str, season_start_year: int) -> str | None:
    """
    Accepts 'AUG 22', 'Sep 5', 'Sept. 5', 'September 5' (case-insensitive).
    Returns 'YYYY-MM-DD' or None.
    Uses season_start_year for Aug–Dec and season_start_year+1 for Jan–Jul.
    """
    if not label:
        return None
    m = re.match(r"\s*([A-Za-z.]+)\s+(\d{1,2})\s*$", label)
    if not m:
        return None
    mon_token = m.group(1).replace(".", "")
    mon_key = mon_token[:3].lower()
    mon = MONTH_IDX.get(mon_key)
    if not mon:
        return None
    day = int(m.group(2))

    year = season_start_year
    if mon < 8:  # Jan–Jul are in the following calendar year
        year = season_start_year + 1

    return f"{year:04d}-{mon:02d}-{day:02d}"

def normalize(items: list, scraped_at: str):
    """Convert raw items to a simple, sorted list suitable for the UI."""
    try:
        scraped = datetime.fromisoformat((scraped_at or "").replace("Z", "+00:00")).astimezone(CENTRAL)
    except Exception:
        scraped = datetime.now(CENTRAL)

    season_start_year = detect_season_start_year(scraped)

    rows = []
    for it in items:
        # --- Opponent / filters (Opening Night + Big Ten placeholders) ---
        raw_opp = (it.get("opponent_name") or "").strip()
        if not raw_opp:
            continue

        opp_lower = raw_opp.lower()

        # Drop the NU vs NU scrimmage
        if "opening night presented by scheels" in opp_lower:
            continue

        # Drop generic Big Ten Tournament placeholders (First Round, Second Round, etc.)
        if opp_lower.startswith("big ten "):
            continue

        # --- DATE: prefer ISO, else parse visible month/day text ---
        date_iso = it.get("date")
        if not date_iso:
            date_iso = parse_date_from_text(it.get("date_text"), season_start_year)
        if not date_iso:
            continue

        han = it.get("venue_type") or "N"

        city  = (it.get("city") or "").strip() or None
        arena = (it.get("arena") or "").strip() or None
        if arena:
            arena = re.sub(r"\s*presented by\b.*$", "", arena, flags=re.I).strip()
        arena_key = slug(arena or "unknown")

        # --- Result / status ---
        res = it.get("result")
        # If scraper already had status, trust "final" vs not; otherwise infer from result.
        status = it.get("status") or ("final" if res else "scheduled")
        if status not in ("final", "scheduled", "tbd"):
            status = "scheduled" if not res else "final"

        result_str = None
        result_css = None
        if res:
            result_str = f"{res.get('outcome')} {res.get('sets')}"
            result_css = {"W": "W", "L": "L", "T": "T"}.get(res.get("outcome"))

        opp = raw_opp or "TBA"
        opp_rank = it.get("opp_rank")
        nu_rank  = it.get("nu_rank")

        title = opp  # plain opponent name, no rank prefix

        rows.append({
            "date": date_iso,
            "time_local": it.get("time_local"),
            "home_away": han,
            "nu_rank": nu_rank,
            "opponent": opp,
            "opp_rank": opp_rank,
            "title": title,
            "arena": arena,
            "city": city,
            "arena_key": arena_key,
            "nu_logo": it.get("nebraska_logo_url"),
            "opp_logo": it.get("opponent_logo_url"),
            "tv_logo": it.get("tv_network_logo_url"),
            "tv": it.get("networks") or [],
            "status": status,
            "result": result_str,
            "result_css": result_css,
            "notes": None,
            "links": it.get("links") or [],
        })

    # Sort by date then time (null times sorted last)
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
