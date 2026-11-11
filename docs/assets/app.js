/* =========================================================
   MEN'S BASKETBALL SCHEDULE UI SCRIPT
   - Loads normalized data and optional arena manifest
   - Renders the hero (face-off card for the next game) and
     the 2-column schedule
   - Everything sits on a fixed 1920x1080 stage that is scaled
     to fit the screen, so TVs need no sizing parameters
   ========================================================= */

/* ---------------- Fit the 1920x1080 stage to the screen ----------------
   TV browsers don't agree on how big the screen is: some report the panel's
   pixels in window.innerWidth/innerHeight (e.g. 1920x1080) while laying the
   page out in a smaller CSS viewport (e.g. 1280x720), which would leave the
   stage at full size and crop its edges. So we take the SMALLEST size any of
   the usual measures reports; at worst that adds thin black bars.
   ?tvscale=0.67 forces a fixed scale if a TV still gets it wrong.            */
const STAGE_W = 1920, STAGE_H = 1080;
const forcedScale = parseFloat(new URLSearchParams(location.search).get("tvscale"));

function viewportSize() {
  const de = document.documentElement;
  const vv = window.visualViewport;
  const pick = (vals) => {
    const ok = vals.filter(v => typeof v === "number" && v > 0);
    return ok.length ? Math.min.apply(null, ok) : 0;
  };
  return {
    w: pick([window.innerWidth, de && de.clientWidth, vv && vv.width]),
    h: pick([window.innerHeight, de && de.clientHeight, vv && vv.height]),
  };
}

let stageScale = 1;
function fitStage() {
  const stage = document.getElementById("stage");
  if (!stage) return;
  if (!isNaN(forcedScale) && forcedScale > 0) {
    stageScale = forcedScale;
  } else {
    const vp = viewportSize();
    if (!vp.w || !vp.h) return;           // not laid out yet; try again later
    stageScale = Math.min(vp.w / STAGE_W, vp.h / STAGE_H);
  }
  stage.style.transform = `translate(-50%, -50%) scale(${stageScale})`;
}
fitStage();
window.addEventListener("resize", fitStage);
window.addEventListener("orientationchange", fitStage);
window.addEventListener("load", fitStage);
if (window.visualViewport) window.visualViewport.addEventListener("resize", fitStage);
// Some players settle their viewport late without firing resize
[500, 2000, 5000].forEach(ms => setTimeout(fitStage, ms));
setInterval(fitStage, 60000);

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
     - view=next|all : lock to a specific view
     - rot=15        : seconds between view rotations
     - debug=1       : show a tiny HUD for diagnostics
     - tvscale=0.67  : force the stage scale (read at the top of
                       this file; only if a TV mis-reports its size)
     --------------------------------------------------------- */
  const params = new URLSearchParams(location.search);

  const rot = parseInt(params.get("rot"), 10);
  if (!isNaN(rot) && rot > 0) UI.rotateSeconds = rot;

  const lockView = params.get("view"); // "next" | "all"
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

  // "vs" for home/neutral, "at" for away
  const dividerFor = (han) => (han === "A" ? "at" : "vs");

  // CSS class for home/away coloring
  const homeClass = (han) => (han === "H" ? "is-home" : "is-away");

  // Extract a W/L/T token for the result pill CSS
  const rowResult = (g) => (g.result ? (g.result.split(" ")[0] || "") : "");

  // A real clock time (not "TBA"/"TBD"/empty)
  const isTimeKnown = (s) => !!s && /\d/.test(s) && !/\bTB[AD]\b/i.test(s);

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

  // Hero date line: "Thu, Nov 12 · 6:00 PM CST" ("Time TBA" when unknown)
  const fmtHero = (iso, time) => {
    const day = iso
      ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      : "";
    return [day, isTimeKnown(time) ? time : "Time TBA"].filter(Boolean).join(" · ");
  };

  // Short date for the left cap
  const fmtDay = (iso) =>
    new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
    });

  /* ---------------------------------------------------------
     CHOOSE "NEXT" GAME
     - First non-final game whose date hasn't passed yet
       (guards against games that were postponed/cancelled and
        never got a result, which would otherwise get "stuck"
        as the next game once their date is in the past)
     - Else the last game of the season
     (The Opening Night scrimmage is already dropped by the normalizer.)
     --------------------------------------------------------- */
  // Today's date in Central time (matches how the scraper stamps game dates)
  const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  const upcoming = sched
    .filter(g => g.status !== "final" && g.date && g.date >= todayISO)
    .sort((a,b) => a.date.localeCompare(b.date));
  const nextGame = upcoming[0] || sched[sched.length - 1];

  // Calculate record (excluding exhibitions, which huskers.com marks "(Exh.)")
  const isExhibition = (g) => g.is_exhibition || /\(Exh\.?\)/i.test(g.opponent || "");
  const wins = sched.filter(g => g.status === "final" && g.result_css === "W" && !isExhibition(g)).length;
  const losses = sched.filter(g => g.status === "final" && g.result_css === "L" && !isExhibition(g)).length;
  const record = `${wins}-${losses}`;

  /* ---------------------------------------------------------
     HERO RENDER (face-off card)
     --------------------------------------------------------- */
  $("#next-record").textContent = `RECORD ${record}`;

  if (nextGame) {
    // Background image (if present in images/arenas)
    if (nextGame.arena_key) {
      $("#next-bg").style.backgroundImage = `url(images/arenas/${nextGame.arena_key}.jpg)`;
    }

    // Logos
    if (nextGame.nu_logo)  $("#ne-logo").src  = nextGame.nu_logo;
    if (nextGame.opp_logo) $("#opp-logo").src = nextGame.opp_logo;

    // Divider between the two teams
    const divider = dividerFor(nextGame.home_away);
    $("#divider").textContent = UI.showDividerLiteral ? (divider + ".") : "";

    // Opponent name under its logo
    $("#next-opponent").textContent = nextGame.title || nextGame.opponent || "TBD";

    // Date/time line
    $("#next-datetime").textContent = fmtHero(nextGame.date, nextGame.time_local);

    // Location line (city, or city · arena)
    const city  = nextGame.city  || "";
    const arena = nextGame.arena || "";
    $("#next-venue").textContent = (UI.showCityOnly || !arena ? city : `${city} · ${arena}`) || "—";

    // TV chip (prefer logo)
    const nextTV = $("#next-tv");
    nextTV.innerHTML = "";
    const tvTbd = () => {
      const tbd = document.createElement("span");
      tbd.className = "tv-tbd";
      tbd.textContent = "TV: TBD";
      nextTV.appendChild(tbd);
    };
    if (nextGame.tv_logo) {
      const chip = document.createElement("span");
      chip.className = "tv-chip";
      const img = new Image();
      img.src = nextGame.tv_logo; img.alt = "TV";
      img.onerror = () => { chip.remove(); tvTbd(); };
      chip.appendChild(img);
      nextTV.appendChild(chip);
    } else if (Array.isArray(nextGame.tv) && nextGame.tv.length) {
      const chip = document.createElement("span");
      chip.className = "tv-chip";
      chip.textContent = nextGame.tv.join(" • ");
      nextTV.appendChild(chip);
    } else {
      tvTbd();
    }

    // Ranking pills on the logos
    const setRank = (el, rank) => {
      if (rank && Number(rank) > 0) {
        el.textContent = `#${rank}`;
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    };
    setRank($("#ne-rank"), nextGame.nu_rank);
    setRank($("#opp-rank"), nextGame.opp_rank);
  }

  /* ---------------------------------------------------------
     SCHEDULE (VIEW-ALL) RENDER
     - 2 columns that fill the stage
     - One line per game: matchup left, details right
     --------------------------------------------------------- */
  const allWrap = $("#view-all .all-wrap");

  const cols = document.createElement("div");
  cols.className = "cols";
  const colA = document.createElement("div");
  const colB = document.createElement("div");
  colA.className = "col";
  colB.className = "col";
  cols.appendChild(colA);
  cols.appendChild(colB);
  allWrap.appendChild(cols);

  // Small logo with an optional rank dot
  function buildMark(url, rank) {
    const wrap = document.createElement("span");
    wrap.className = "mark-wrap";
    const img = new Image();
    img.className = "mark";
    img.alt = "";
    // Keep the slot but hide the broken-image icon (e.g. "Big Ten Tournament")
    img.onerror = () => { img.style.visibility = "hidden"; };
    if (url) img.src = url; else img.style.visibility = "hidden";
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

    const line = document.createElement("div");
    line.className = "line";
    const matchup = document.createElement("div");
    matchup.className = "matchup";
    const meta = document.createElement("div");
    meta.className = "meta";

    // Result pill (finals only)
    if (g.status === "final" && g.result) {
      const res = document.createElement("span");
      res.className = `result ${rowResult(g)}`;
      res.textContent = g.result;
      matchup.appendChild(res);
    }

    // N logo, divider, opponent logo, opponent name
    matchup.appendChild(buildMark(g.nu_logo, g.nu_rank));
    const divEl = document.createElement("span");
    divEl.className = "divider";
    divEl.textContent = UI.showDividerLiteral ? dividerFor(g.home_away) : "";
    matchup.appendChild(divEl);
    matchup.appendChild(buildMark(g.opp_logo, g.opp_rank));
    const oppSpan = document.createElement("span");
    oppSpan.className = "opp-name";
    oppSpan.textContent = g.opponent || g.title || "";
    matchup.appendChild(oppSpan);

    // Details: time (upcoming only), city, TV
    if (g.status !== "final" && g.time_local) {
      const t = document.createElement("span");
      t.className = "chip";
      t.textContent = abbrevTime(g.time_local);
      meta.appendChild(t);
    }

    const city = g.city || "";
    const arena = g.arena || "";
    if (city) {
      const c = document.createElement("span");
      c.className = "chip city";
      c.textContent = UI.showCityOnly || !arena ? city : `${city} · ${arena}`;
      meta.appendChild(c);
    }

    if (g.tv_logo) {
      const tv = document.createElement("span");
      tv.className = "chip tv";
      const img = new Image();
      img.src = g.tv_logo; img.alt = "TV";
      img.onerror = () => tv.remove();
      tv.appendChild(img);
      meta.appendChild(tv);
    } else if (Array.isArray(g.tv) && g.tv.length) {
      const tv = document.createElement("span");
      tv.className = "chip tv";
      tv.textContent = g.tv[0];
      meta.appendChild(tv);
    }

    line.appendChild(matchup);
    line.appendChild(meta);
    row.appendChild(when);
    row.appendChild(line);
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
    const de = document.documentElement;
    const vv = window.visualViewport;
    const renderHud = () => {
      dbg.textContent = [
        `games: ${sched.length}`,
        `next: ${nextGame ? (nextGame.opponent || "") : "n/a"}`,
        `inner: ${window.innerWidth}x${window.innerHeight}`,
        `client: ${de.clientWidth}x${de.clientHeight}`,
        `visual: ${vv ? Math.round(vv.width) + "x" + Math.round(vv.height) : "n/a"}`,
        `dpr: ${window.devicePixelRatio}`,
        `scale: ${stageScale.toFixed(3)}${!isNaN(forcedScale) && forcedScale > 0 ? " (forced)" : ""}`
      ].join(" • ");
    };
    renderHud();
    setInterval(renderHud, 2000);
  }
})();
