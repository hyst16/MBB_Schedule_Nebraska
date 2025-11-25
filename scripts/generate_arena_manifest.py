#!/usr/bin/env python3
import json, re
from pathlib import Path

DATA = Path("data")
INP = DATA/"mbb_schedule_normalized.json"
OUT = DATA/"arena_manifest.json"

slug = lambda s: re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", (s or "").lower())).strip("-")

# Include opponent name alongside arena name (not in filename), per request
def main():
    rows = json.loads(INP.read_text("utf-8")).get("items", []) if INP.exists() else []
    want = {}
    for r in rows:
        key = r.get("arena_key") or slug(r.get("arena")) or "unknown"
        display = r.get("arena") or "Unknown Arena"
        opponent = r.get("opponent") or "TBA"
        city = r.get("city") or ""
        want[key] = {
            "arena_key": key,
            "display": display,
            "opponent": opponent,
            "city": city,
            "filename": f"{key}.jpg",
            "path": f"docs/images/arenas/{key}.jpg",
        }
    OUT.write_text(json.dumps({"arenas": sorted(want.values(), key=lambda x: x["arena_key"])}, indent=2), encoding="utf-8")
    print(f"wrote {OUT}")

if __name__ == "__main__":
    main()
