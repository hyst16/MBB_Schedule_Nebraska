#!/usr/bin/env python3
"""
Huskers VB schedule scraper (Playwright, sync).
- Grabs the list on https://huskers.com/sports/men's basketball/schedule
- Handles lazy-loaded images (logos + TV badges)
- Extracts ranks for Nebraska and the opponent
- Emits a raw JSON blob that a separate normalizer will consume
"""

import json, re
from pathlib import Path
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

# ------------------- Config -------------------

SOURCE_URL = "https://huskers.com/sports/mens-basketball/schedule"
OUT = Path("data/mbb_raw.json")
OUT.parent.mkdir(parents=True, exist_ok=True)

# ------------------- Helpers -------------------

def clean(s):
    """Collapse whitespace; return the string unchanged if it's not a str."""
    return " ".join(s.split()) if isinstance(s, str) else s

def safe_text(locator, timeout=1200):
    """
    Return the innerText of the FIRST matched element or None.
    - Guarded for 'no matches'
    - Timeout won't crash the run
    """
    try:
        if not locator or locator.count() == 0:
            return None
        return locator.first.inner_text(timeout=timeout).strip()
    except PWTimeout:
        return None

def safe_attr(locator, name, timeout=1200):
    """
    Return an attribute value of the FIRST matched element or None.
    """
    try:
        if not locator or locator.count() == 0:
            return None
        return locator.first.get_attribute(name, timeout=timeout)
    except PWTimeout:
        return None

def get_img_src(locator):
    """
    Try REALLY hard to get a real image URL (not a data: URI).
    We:
      1) read el.currentSrc OR el.src OR data-src via page.evaluate
      2) fall back to reading attributes directly
    """
    if not locator or locator.count() == 0:
        return None
    img = locator.first
    try:
        # JS read: currentSrc (after lazy-load) or src or data-src
        current = img.evaluate("(el) => el.currentSrc || el.src || el.getAttribute('data-src') || ''")
        if current and not current.startswith("data:image"):
            return current

        # Fallbacks
        src = safe_attr(locator, "src")
        if src and not src.startswith("data:image"):
            return src

        data_src = safe_attr(locator, "data-src")
        if data_src and not data_src.startswith("data:image"):
            return data_src
    except PWTimeout:
        pass
    return None

# ------------------- Per-Event Parse -------------------

def parse_event(ev):
    """
    Extract all the bits from one '.schedule-event-item' block.
    Also guards against non-NU events (some tourneys list games that do not involve NU).
    """
    # Force the row into view to trigger any lazy-loaders
    try:
        ev.scroll_into_view_if_needed(timeout=2000)
    except PWTimeout:
        pass

    # Divider ("vs." or "at") + opponent name
    divider = (safe_text(ev.locator(".schedule-event-item-default__divider")) or "").strip().lower()
    opponent_name = clean(safe_text(ev.locator(".schedule-event-item-default__opponent-name"))) or ""

    # NU + opponent logos (lazy-loaded)
    wrappers = ev.locator(".schedule-event-item-default__images .schedule-event-item-default__image-wrapper")
    ne_logo = get_img_src(wrappers.nth(0).locator("img")) if wrappers.count() >= 1 else None
    opp_logo = get_img_src(wrappers.nth(1).locator("img")) if wrappers.count() >= 2 else None

    # Location string looks like "Lincoln, Neb. / Bob Devaney Sports Center"
    location = clean(safe_text(ev.locator(".schedule-event-item-default__location .schedule-event-location"))) or ""
    city = arena = None
    mloc = re.search(r"(.+?)\s*/\s*(.+)$", location)
    if mloc:
        city = mloc.group(1).strip()
        # Some rows add "presented by ..." after the arena; strip that
        arena = re.sub(r"\s*presented by\b.*$", "", mloc.group(2).strip(), flags=re.I)

    # -------------------- RANKS --------------------
    # 1) Opponent rank occasionally appears as "#N Team" in opponent_name → strip it
    opp_rank = None
    m = re.match(r"#\s*(\d{1,2})\s+(.*)$", opponent_name)
    if m:
        opp_rank = int(m.group(1))
        opponent_name = m.group(2).strip()

    # 2) Try to read ranks located near each logo wrapper
    nu_rank = None
    opp_rank = opp_rank  # may already have come from opponent_name
    
    wrappers = ev.locator(".schedule-event-item-default__images .schedule-event-item-default__image-wrapper")
    if wrappers.count() >= 1:
        left_txt = safe_text(wrappers.nth(0))
        mnu = re.search(r"#\s*(\d{1,2})", left_txt or "")
        if mnu:
            nu_rank = int(mnu.group(1))
    
    if wrappers.count() >= 2:
        right_txt = safe_text(wrappers.nth(1))
        mop = re.search(r"#\s*(\d{1,2})", right_txt or "")
        if mop:
            opp_rank = int(mop.group(1))
    
    # 3) Fallback: if still missing, look anywhere in the strip
    if nu_rank is None or opp_rank is None:
        rank_strip = safe_text(ev.locator(".schedule-event-item-default__images")) or ""
        nums = re.findall(r"#\s*(\d{1,2})", rank_strip)
        if nu_rank is None and len(nums) >= 1:
            nu_rank = int(nums[0])
        if opp_rank is None and len(nums) >= 2:
            opp_rank = int(nums[1])

    # -------------------- Result / Time --------------------
    has_win  = ev.locator(".schedule-event-item-result__win").count() > 0
    has_loss = ev.locator(".schedule-event-item-result__loss").count() > 0
    has_tie  = ev.locator(".schedule-event-item-result__tie").count() > 0
    label    = clean(safe_text(ev.locator(".schedule-event-item-result__label"))) or ""

    status = "tbd"
    result = None
    time_local = None

    if has_win or has_loss or has_tie:
        # Final match → build "W 3-1" style info
        status = "final"
        outcome = "W" if has_win else "L" if has_loss else "T"
        # Often the sets score is the only "x-y" token in label
        score = next((p for p in label.split() if "-" in p or "–" in p), label).replace("–", "-")
        result = {"outcome": outcome, "sets": score}
    else:
        # Upcoming → label is usually a time or TBA-ish
        time_local = label or None
        status = "scheduled" if time_local else "tbd"

    # -------------------- Date --------------------
    # 1) Prefer ISO date if a <time datetime="YYYY-MM-DDTHH:mm..."> exists
    iso_dt = safe_attr(ev.locator(".schedule-event-date time[datetime]"), "datetime") \
          or safe_attr(ev.locator("time[datetime]"), "datetime")
    date_iso = iso_dt.split("T", 1)[0] if iso_dt and "T" in iso_dt else None

    # 2) Keep the visible date text (e.g., "SEP 20") so the normalizer can parse if needed
    date_text = clean(safe_text(ev.locator(".schedule-event-date__label"))) \
             or clean(safe_text(ev.locator(".schedule-event-date__date"))) \
             or None

    # -------------------- Home/Away/Neutral --------------------
    han = "N"  # default neutral (safe)
    if divider.startswith("at"):
        han = "A"
    elif divider.startswith("vs"):
        # If it's "vs" AND the city is Lincoln, that's home; otherwise could still be neutral
        han = "H" if city and "Lincoln" in city else "N"
    else:
        # Some templates expose an explicit "Home/Away/Neutral" label
        vlabel = (safe_text(ev.locator(".schedule-event-venue__type-label")) or "").lower()
        if "home" in vlabel:
            han = "H"
        elif "away" in vlabel:
            han = "A"
        elif "neutral" in vlabel:
            han = "N"

    # -------------------- TV Logo & Links --------------------
    tv_logo = get_img_src(ev.locator(".schedule-event-bottom__link img, .schedule-event-item-links__image"))

    links = []
    a_nodes = ev.locator(".schedule-event-bottom__link")
    for i in range(a_nodes.count()):
        a = a_nodes.nth(i)
        title = safe_text(a.locator(".schedule-event-item-links__title")) or clean(safe_text(a))
        href = safe_attr(a, "href")
        if href:
            if href.startswith("/"):
                href = "https://huskers.com" + href
            links.append({"title": title, "href": href})

    # NU-only guard (occasionally a tournament list will include non-NU matches)
    if not opponent_name:
        return None

    # Return a compact, raw row (normalizer will finalize shapes/fields)
    return {
        "date": date_iso,                   # may be None → normalizer can parse from date_text
        "date_text": date_text,             # e.g. "SEP 20"
        "time_local": time_local,
        "venue_type": han,                  # H/A/N
        "nu_rank": nu_rank,
        "opp_rank": opp_rank,
        "opponent_name": opponent_name,
        "city": city,
        "arena": arena,
        "nebraska_logo_url": ne_logo,
        "opponent_logo_url": opp_logo,
        "tv_network_logo_url": tv_logo,
        "status": status,
        "result": result,                   # {"outcome":"W","sets":"3-1"} or None
        "links": links,
        "divider_text": divider,            # "vs." or "at"
    }

# ------------------- Main scrape -------------------

def scrape_with_playwright():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent="huskers-vb-schedule-scraper/1.0",
            viewport={"width": 1400, "height": 2400},
        )
        page = ctx.new_page()
        page.goto(SOURCE_URL, wait_until="networkidle")
        page.wait_for_timeout(500)  # tiny settle

        # Scroll each event into view to make sure lazy-loaded bits wake up
        events = page.locator(".schedule-event-item")
        for i in range(events.count()):
            try:
                events.nth(i).scroll_into_view_if_needed(timeout=1500)
            except PWTimeout:
                pass
        page.wait_for_timeout(200)

        # Parse each row
        rows = []
        for i in range(events.count()):
            parsed = parse_event(events.nth(i))
            if parsed:
                rows.append(parsed)

        # Write the raw payload
        payload = {
            "source_url": SOURCE_URL,
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "items": rows,
        }
        OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
        ctx.close()
        browser.close()

if __name__ == "__main__":
    scrape_with_playwright()
    print(f"Wrote {OUT}")
