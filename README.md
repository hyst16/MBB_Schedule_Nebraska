# Nebraska Men's Basketball Schedule (static Pages + daily scrape)

This mirrors your football project, tailored for men's basketball (more matches, tighter grid, rankings, arena helper JSON, and no buttons for display use).

## How it works
- **Scraper** hits the Huskers schedule page and parses server-rendered text **with Playwright** so lazy-loaded **team + TV logos** resolve correctly.  
  If a date isn’t present in ISO, it falls back to the visible “AUG 22” style label.
- **Normalizer** outputs `data/mbb_schedule_normalized.json` for the UI (hero + two-column schedule).  
  It also extracts **Nebraska and opponent rankings** (shown as tiny white dots on the logo corners).
- **Arena manifest** builds `data/arena_manifest.json` listing every arena background you’ll need (`images/arenas/<slug>.jpg`) and includes the **opponent + arena** for your reference (not used in filenames).
- **GitHub Actions** run the scraper + normalizer and commit updated JSON back into `data/`.

## One-time setup
1. Create a repo named `MBB_Schedule_Nebraska`.
2. Add the project files (root layout shown below).
3. **Settings → Pages**: Deploy from **`/docs`** on the `main` branch, or serve from the repo root if you prefer.  
   Live URL will be `https://<your-username>.github.io/MBB_Schedule_Nebraska/`
4. Run the workflow once: **Actions → Scrape & Build (Men's Basketball) → Run workflow**.

<pre>
.
├── docs/
│   ├── index.html
│   ├── assets/
│   │   ├── styles.css
│   │   └── app.js
│   ├── data/
│   │   ├── mbb_schedule_normalized.json   # UI reads this
│   │   └── arena_manifest.json           # optional (for hero backgrounds)
│   └── images/
│       └── arenas/                       # &lt;arena_key&gt;.jpg files (optional)
│
├── data/                                 # raw + build artifacts written here by scripts
│   ├── mbb_raw.json
│   ├── mbb_schedule_normalized.json
│   └── arena_manifest.json
│
└── scripts/                              # scraper/normalizer (optional folder name)
    ├── scrape_vb.py
    └── normalize_vb.py
</pre>



> If you’re serving from `/docs`, your GitHub Pages URL will be `.../MBB_Schedule_Nebraska/` and the app will read JSON from `docs/data/`.

## Files you’ll likely touch
- `data/arena_overrides.json` – force a specific arena name → background slug (optional helper).
- `docs/assets/styles.css` – tune column width, spacing, pills (TV chip), rank dots, and fonts.
- `docs/assets/app.js` – rendering order, column split, and URL parameter handling.

## URL parameters (display controls)
Append these to the page URL; combine as needed:

**Views & rotation**
- `view=next` — lock to hero “Next Game” view  
- `view=all` — lock to compact schedule view  
- `rot=15` — auto-rotate every N seconds (if `view` is not locked)

**Compactness (vertical density)**
- `dense=1` — tight rows (~25–30% shorter)  
- `ultra=1` — even tighter than dense (another ~15–20% vertical savings)  
  > If both appear, **ultra** wins.

**Sizing & layout fit**
- `fit=16x9` — locks the schedule view to a 16:9 stage, centered and scaled to fit
- `safe=24` — optional safe padding in pixels around the 16:9 stage (defaults to `24`)
- `scale=0.95` — scales the **entire schedule view** (fine-tuning for TVs)
- `colw=700` — per-column width in pixels (wider columns show longer names)
- `gap=5` — gap between the two columns (pixels). **Default is `5`.**

**Debug**
- `debug=1` — tiny HUD (bottom-right) with active settings

**Best preset for your TV**
- `?ultra=1&scale=0.90&gap=2`  
  Full: `https://hyst16.github.io/MBB_Schedule_Nebraska/?ultra=1&scale=0.90&gap=2`

> Tip: If opponent names clip, increase `colw` a bit (e.g., `colw=720`) and/or slightly reduce `scale` (e.g., `0.94`). Lowering `gap` (e.g., `gap=2`) also helps.

## Arena images
Add JPEGs to `images/arenas/` (or `docs/images/arenas/` if serving from `/docs`) using the `arena_key` from `data/arena_manifest.json`. Example: images/arenas/chi-health-center.jpg


If an arena image exists, it’s used as the **hero background** for the next game.

## Notes / roadmap
- If you later want to include **non-Nebraska matches** at NU invitationals (e.g., *California vs Wright State*), the scraper can be extended to capture those neutral blocks.
- TV logos: you can keep text pills, or switch to local PNGs/SVGs and point the TV chip to your own `images/networks/` assets.
- Results already color as **green for wins**, **red for losses**, **gray for ties**.
- Rankings are shown as **tiny white dots** on the bottom-right of each team’s logo (not inside the opponent name text).

## Updating data (day-to-day)
1. Let the scheduled Action run, or trigger it manually from **Actions**.
2. It updates `data/mbb_schedule_normalized.json` (and `data/arena_manifest.json` if needed).
3. GitHub Pages serves the fresh files immediately; the app cache-busts JSON fetches with `?v=timestamp`.
