/* =========================================================
   VOLLEYBALL SCHEDULE UI SCRIPT
   - Loads normalized data and optional arena manifest
   - Renders the hero (next game) and the 2-column schedule
   - Supports lots of URL knobs (scale, fit=16x9, colw, gap,
     dense, ultra, view, rot, debug) for TVs vs laptops
   ========================================================= */

(async function () {
  // Small DOM helper (like jQuery's $)
  const $ = (sel, el = document) => el.querySelector(sel);

  /* ---------------------------------------------------------
     DATA ENDPOINTS
     These are set by index.html with cache-busting; we fall
     back to default paths if those globals are missing.
     --------------------------------------------------------- */
  const DATA_URL = window.DATA_URL || "data/mbb_schedule_normalized.json";
  const MANIFEST_URL = window.MANIFEST_URL || "data/arena_manifest.json";
  const UI = window.UI || {
    rotateSeconds: 15,
    showDividerLiteral: true,
    showCityOnly: true
  };

  /* ---------------------------------------------------------
     URL PARAMETERS (all optional)
     - view=next|all       : lock to a specific view
     - rot=15              : seconds between view rotations
     - scale=0.95          : global scale for schedule (fine-tune fit)
     - colw=700            : override per-column width (px)
     - gap=5               : column gap in px for the 2-col schedule
     - dense=1             : tighter vertical layout
     - ultra=1             : extra-tight vertical layout (overrides dense)
     - fit=16x9            : enable 16:9 stage scaling for TVs
     - safe=1              : add a bit of safe padding inside stage
     - debug=1             : show a tiny HUD for diagnostics
     --------------------------------------------------------- */
  const params = new URLSearchParams(location.search);

  // Rotation override
  const rot = parseInt(params.get("rot"), 10);
  if (!isNaN(rot) && rot > 0) UI.rotateSeconds = rot;

  // View lock
  const lockView = params.get("view"); // "next" | "all"

  // Global scale (applied to the schedule content)
  const scaleParam = parseFloat(params.get("scale"));
  const globalScale = !isNaN(scaleParam) && scaleParam > 0 ? scaleParam : 1;

  // Column width override (?colw=640)
  const colwParam = parseInt(params.get("colw"), 10);
  if (!isNaN(colwParam) && colwParam > 300) {
    document.documentElement.style.setProperty("--col-width", `${colwParam}px`);
  }

  // Column gap override (?gap=5)
  const gapParam = parseInt(params.get("gap"), 10);
  if (!isNaN(gapParam) && gapParam >= 0) {
    document.documentElement.style.setProperty("--cols-gap", `${gapParam}px`);
  } else {
    // default to 5px if not provided (as requested)
    document.documentElement.style.setProperty("--cols-gap", `5px`);
  }

  // Dense vs Ultra-dense; ultra wins if both provided
  const dense = params.get("dense") === "1";
  const ultra = params.get("ultra") === "1";
  if (ultra) {
    document.body.classList.add("ultra");
    document.body.classList.remove("dense");
  } else if (dense) {
    document.body.classList.add("dense");
  }

  // 16:9 stage controls
  const fit = (params.get("fit") || "").toLowerCase(); // "16x9"
  const useStage = (fit === "16x9" || fit === "16/9");
  const safe = params.get("safe") === "1"; // extra safe padding (if you want it)
  const debug = params.get("debug") === "1";

  /* ---------------------------------------------------------
     FETCH DATA
     - Schedule JSON (normalized)
     - Arena manifest (optional background images)
     --------------------------------------------------------- */
  const sched = await fetch(DATA_URL).then(r => r.json()).then(d => d.items || []).catch(() => []);
  const manifest = await fetch(MANIFEST_URL).then(r => r.json()).catch(() => ({}));
  const arenas = Object.fromEntries(((manifest && manifest.arenas) || []).map(a => [a.arena_key, a]));

  /* ---------------------------------------------------------
     HELPERS
     --------------------------------------------------------- */

  // "vs" for home, "at" for away/neutral (no dot in the schedule row)
  const dividerFor = (han) => (han === "A" ? "at" : "vs");

  // CSS class for home/away coloring
  const homeClass = (han) => (han === "H" ? "is-home" : "is-away");

  // Extract a W/L/T token for the result pill CSS
  const rowResult = (g) => (g.result ? (g.result.split(" ")[0] || "") : "");

  // Abbreviate time strings to save space on schedule chips
  function abbrevTime(s) {
    if (!s || typeof s !== "string") return s;
    s = s.replace(/\s+/g, " ").trim();

    // "8:00 OR 9:00 PM CST" -> "8 or 9 PM CST"
    const orMatch = s.match(/^(\d{1,2})(?::00)?\s*OR\s*(\d{1,2})(?::00)?\s*(AM|PM)\s+([A-Z]{3})$/i);
    if (orMatch) {
      const h1 = String(+orMatch[1]);
      const h2 = String(+orMatch[2]);
      return `${h1} or ${h2} ${orMatch[3].toUpperCase()} ${orMatch[4].toUpperCase()}`;
    }

    // "6:00 PM CDT" -> "6 PM CDT"
    const fullMatch = s.match(/^(\d{1,2})(?::(\d{2}))\s*(AM|PM)\s+([A-Z]{3})$/i);
    if (fullMatch) {
      const hour = String(+fullMatch[1]);
      const mins = fullMatch[2];
      const ampm = fullMatch[3].toUpperCase();
      const tz = fullMatch[4].toUpperCase();
      return mins === "00" ? `${hour} ${ampm} ${tz}` : `${hour}:${mins} ${ampm} ${tz}`;
    }

    // "6:00 PM"
    const noTZ = s.match(/^(\d{1,2})(?::(\d{2}))\s*(AM|PM)$/i);
    if (noTZ) {
      const hour = String(+noTZ[1]);
      const mins = noTZ[2];
      const ampm = noTZ[3].toUpperCase();
      return mins === "00" ? `${hour} ${ampm}` : `${hour}:${mins} ${ampm}`;
    }

    return s; // leave TBA or anything else alone
  }

  // Format date/time for the hero card line
  const fmtHero = (iso, time) => {
    if (!iso) return time ? abbrevTime(time) : "";
    const d = new Date(iso + "T00:00:00");
    const weekday = d.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
    const mon = d.toLocaleDateString("en-US", { month: "short" });
    const day = d.getDate();
    return [weekday, `${mon} ${day}`, abbrevTime(time || "")].filter(Boolean).join(" • ");
  };

  // Short date for the left cap
  const fmtDay = (iso) =>
    new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
    });

  /* ---------------------------------------------------------
     CHOOSE "NEXT" GAME
     - First non-final with a date; else last item
     --------------------------------------------------------- */
  const upcoming = sched.filter(g => g.status !== "final" && g.date).sort((a,b) => a.date.localeCompare(b.date));
  const nextGame = upcoming[0] || sched[sched.length - 1];

  /* ---------------------------------------------------------
     HERO RENDER
     --------------------------------------------------------- */
  const nextBg = $("#next-bg");
  const neLogo = $("#ne-logo");
  const oppLogo = $("#opp-logo");
  const nextOpp = $("#next-opponent");
  const nextDT  = $("#next-datetime");
  const nextVenue = $("#next-venue");
  const nextTV  = $("#next-tv");

  if (nextGame) {
    // Background image (if present in your images/arenas folder)
    if (nextGame.arena_key) {
      nextBg.style.backgroundImage = `url(images/arenas/${nextGame.arena_key}.jpg)`;
    }

    // Logos
    if (nextGame.nu_logo)  neLogo.src  = nextGame.nu_logo;
    if (nextGame.opp_logo) oppLogo.src = nextGame.opp_logo;

    // Divider text in hero (with a dot)
    const divider = dividerFor(nextGame.home_away);
    $("#divider").textContent = UI.showDividerLiteral ? (divider + ".") : "";

    // Headline: "Nebraska at Opponent" or "Nebraska vs. Opponent"
    const headline =
      (nextGame.home_away === "A" ? "Nebraska at " : "Nebraska vs. ") +
      (nextGame.title || nextGame.opponent || "");
    nextOpp.textContent = headline;

    // Date/time line
    nextDT.textContent = fmtHero(nextGame.date, nextGame.time_local);

    // Location line (city or city + arena)
    const city  = nextGame.city  || "";
    const arena = nextGame.arena || "";
    nextVenue.textContent = UI.showCityOnly || !arena ? city : `${city} • ${arena}`;

    // TV chip (prefer logo)
    nextTV.innerHTML = "";
    if (nextGame.tv_logo) {
      const chip = document.createElement("span");
      chip.className = "tv-chip";
      const img = new Image();
      img.src = nextGame.tv_logo; img.alt = "TV";
      img.onerror = () => chip.remove();
      chip.appendChild(img);
      nextTV.appendChild(chip);
    } else if (Array.isArray(nextGame.tv) && nextGame.tv.length) {
      const chip = document.createElement("span");
      chip.className = "tv-chip";
      chip.textContent = nextGame.tv.join(" • ");
      nextTV.appendChild(chip);
    }

    // Ranking pills (white for both in hero)
    const neRankEl  = $("#ne-rank");
    const oppRankEl = $("#opp-rank");
    const setRank = (el, rank) => {
      if (rank && Number(rank) > 0) {
        el.textContent = `#${rank}`;
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    };
    setRank(neRankEl, nextGame.nu_rank);
    setRank(oppRankEl, nextGame.opp_rank);
  }

  /* ---------------------------------------------------------
     SCHEDULE (VIEW-ALL) RENDER
     - Builds a 2-column layout
     - Opponent logo + rank dot is placed before the name
     - Keeps your chips/logos/result logic
     --------------------------------------------------------- */

  // If you’re using the 16:9 stage in index.html, we scale the stage-content.
  // Otherwise, we scale the .all-wrap directly (older setup).
  const allWrap = $("#view-all .all-wrap");
  if (useStage) {
    // Apply scale to the stage content (so everything inside scales together)
    const stageContent = $("#stage .stage-content");
    if (stageContent) {
      stageContent.style.transform = `scale(${globalScale})`;
      stageContent.style.transformOrigin = "center center";
    }
  } else {
    // No stage -> scale the schedule wrap directly
    allWrap.style.transform = `scale(${globalScale})`;
    allWrap.style.transformOrigin = "top center";
  }

  // Build the two columns container
  const cols = document.createElement("div");
  cols.className = "cols";
  const colA = document.createElement("div");
  const colB = document.createElement("div");
  colA.className = "col";
  colB.className = "col";
  cols.appendChild(colA);
  cols.appendChild(colB);
  allWrap.appendChild(cols);

  // Small helper: build a tiny logo with an optional rank dot
  function buildMark(url, rank) {
    const wrap = document.createElement("span");
    wrap.className = "mark-wrap";
    const img = new Image();
    img.className = "mark";
    img.src = url || "";
    img.alt = "";
    wrap.appendChild(img);

    if (rank && Number(rank) > 0) {
      const dot = document.createElement("span");
      dot.className = "rank-dot";
      dot.textContent = `#${rank}`;
      wrap.appendChild(dot);
    }
    return wrap;
  }

  // Build a single schedule row
  const makeRow = (g) => {
    const row = document.createElement("div");
    row.className = `game-row ${homeClass(g.home_away)}`;

    // Left date stack
    const when = document.createElement("div");
    when.className = "when";
    const dayStr = g.date ? fmtDay(g.date) : "";
    const [dow, mmmdd] = dayStr ? [dayStr.split(", ")[0], dayStr.split(", ")[1]] : ["",""];
    when.innerHTML = `<div class="date">${mmmdd || ""}</div><div class="dow">${dow || ""}</div>`;

    // Sentence line: N logo, divider, OPP logo, Opponent name
    const line = document.createElement("div");
    line.className = "line";

    const neWrap = buildMark(g.nu_logo, g.nu_rank);

    const divEl = document.createElement("span");
    divEl.className = "divider";
    divEl.textContent = UI.showDividerLiteral ? dividerFor(g.home_away) : "";

    const oppWrap = buildMark(g.opp_logo, g.opp_rank);

    const oppSpan = document.createElement("span");
    oppSpan.className = "opp-name";
    // Ensure name text is clean (ranking stays in the dot, not in the string)
    oppSpan.textContent = g.opponent || g.title || "";

    line.appendChild(neWrap);
    line.appendChild(divEl);
    line.appendChild(oppWrap);
    line.appendChild(oppSpan);

    // Chips cluster (result, time, city, tv)
    const chips = document.createElement("div");

    if (g.status === "final" && g.result) {
      const res = document.createElement("span");
      res.className = `result ${rowResult(g)}`;
      res.textContent = g.result;
      chips.appendChild(res);
    }

    if (g.time_local) {
      const t = document.createElement("span");
      t.className = "chip";
      t.textContent = abbrevTime(g.time_local);
      chips.appendChild(t);
    }

    const city = g.city || "";
    const arena = g.arena || "";
    if (city) {
      const c = document.createElement("span");
      c.className = "chip city";
      c.textContent = UI.showCityOnly || !arena ? city : `${city} • ${arena}`;
      chips.appendChild(c);
    }

    if (g.tv_logo) {
      const tv = document.createElement("span");
      tv.className = "chip tv";
      const img = new Image();
      img.src = g.tv_logo; img.alt = "TV";
      img.onerror = () => tv.remove();
      tv.appendChild(img);
      chips.appendChild(tv);
    } else if (Array.isArray(g.tv) && g.tv.length) {
      const tv = document.createElement("span");
      tv.className = "chip tv";
      tv.textContent = g.tv[0]; // keep short; logos are preferred anyway
      chips.appendChild(tv);
    }

    // Assemble row
    row.appendChild(when);
    row.appendChild(line);
    row.appendChild(chips);
    return row;
  };

  // Fill Column 1 completely (top-down), then Column 2 (top-down)
  const split = Math.ceil(sched.length / 2);
  sched.slice(0, split).forEach(g => colA.appendChild(makeRow(g)));
  sched.slice(split).forEach(g => colB.appendChild(makeRow(g)));

  /* ---------------------------------------------------------
     VIEW TOGGLING + DEBUG HUD
     --------------------------------------------------------- */
  const vNext = $("#view-next");
  const vAll  = $("#view-all");
  const dbg   = $("#debug");

  function show(which) {
    vNext.classList.toggle("hidden", which !== "next");
    vAll.classList.toggle("hidden", which !== "all");
  }

  if (lockView === "next") show("next");
  else if (lockView === "all") show("all");
  else {
    let mode = "next"; show(mode);
    setInterval(() => {
      mode = mode === "next" ? "all" : "next";
      show(mode);
    }, (UI.rotateSeconds || 15) * 1000);
  }

  if (debug) {
    dbg.classList.remove("hidden");
    dbg.textContent = [
      `games: ${sched.length}`,
      `next: ${nextGame ? (nextGame.opponent || "") : "n/a"}`,
      `scale: ${globalScale}`,
      `colw: ${isNaN(colwParam) ? "default" : colwParam + "px"}`,
      `gap: ${isNaN(gapParam) ? "5px (default)" : gapParam + "px"}`,
      `mode: ${ultra ? "ultra" : (dense ? "dense" : "normal")}`,
      `fit: ${useStage ? "16:9" : "none"}`
    ].join(" • ");
  }
})();
