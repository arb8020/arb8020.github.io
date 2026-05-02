// BGM proxy: searches khinsider album pages for tracks matching a route slug,
// returns ranked candidates, and resolves a chosen track to its MP3 URL.
//
// Endpoints:
//   GET /bgm/search?slug=<slug>&version=<version>
//     -> { album, candidates: [{ title, trackUrl, score }, ...] }
//   GET /bgm/resolve?trackUrl=<url>
//     -> { mp3Url, title }
//
// Caches album track lists and resolved MP3 URLs in memory + on disk.

import express from "express";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const KHINSIDER = "https://downloads.khinsider.com";
const CACHE_DIR = path.join(__dirname, ".cache");
const UA = "Mozilla/5.0 (compatible; pokemon-soundscape/0.1)";

await fs.mkdir(CACHE_DIR, { recursive: true });

const albums = JSON.parse(
  await fs.readFile(path.join(__dirname, "albums.json"), "utf8")
);

// --- caching ---

const memCache = new Map();

async function cacheGet(key) {
  if (memCache.has(key)) return memCache.get(key);
  const file = path.join(CACHE_DIR, encodeURIComponent(key) + ".json");
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    memCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

async function cacheSet(key, value) {
  memCache.set(key, value);
  const file = path.join(CACHE_DIR, encodeURIComponent(key) + ".json");
  await fs.writeFile(file, JSON.stringify(value));
}

// --- khinsider scraping ---

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`khinsider ${url} -> HTTP ${res.status}`);
  return res.text();
}

async function getAlbumTracks(albumSlug) {
  const cacheKey = `album:${albumSlug}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${KHINSIDER}/game-soundtracks/album/${albumSlug}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // Track table rows have anchors to /game-soundtracks/album/<albumSlug>/<file>.mp3
  const tracks = [];
  $(`a[href^="/game-soundtracks/album/${albumSlug}/"]`).each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().trim();
    if (!href || !title) return;
    if (!/\.mp3$/i.test(href)) return;
    // Dedupe — multiple anchors per row.
    if (tracks.some((t) => t.trackUrl === href)) return;
    tracks.push({ title, trackUrl: KHINSIDER + href });
  });

  if (tracks.length === 0) {
    throw new Error(`No tracks parsed from ${url} (album may not exist or page format changed)`);
  }

  await cacheSet(cacheKey, tracks);
  return tracks;
}

async function resolveMp3(trackUrl) {
  const cacheKey = `track:${trackUrl}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const html = await fetchHtml(trackUrl);
  const $ = cheerio.load(html);
  // Track page has an <audio> with the mp3, and/or download links.
  let mp3 = $('audio source[src$=".mp3"]').attr("src")
    || $('audio[src$=".mp3"]').attr("src")
    || $('a[href$=".mp3"]').filter((_, el) => /click here to download/i.test($(el).text())).attr("href")
    || $('a[href$=".mp3"]').first().attr("href");
  if (!mp3) throw new Error(`No mp3 found on ${trackUrl}`);
  if (mp3.startsWith("//")) mp3 = "https:" + mp3;
  const title = $("h2, #pageContent h2").first().text().trim() || "";
  const result = { mp3Url: mp3, title };
  await cacheSet(cacheKey, result);
  return result;
}

// --- ranking ---

// Pull search terms from slug. "sinnoh-route-201-area" -> ["route", "201"]
function tokensFromSlug(slug) {
  const drop = new Set([
    "area",
    "kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea",
  ]);
  return slug
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter((t) => t && !drop.has(t));
}

function scoreTrack(title, tokens, timeBand) {
  const t = title.toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    // Exact whole-word match weighs more than substring.
    const wordRe = new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`);
    if (wordRe.test(t)) score += /^\d+$/.test(tok) ? 5 : 2;
    else if (t.includes(tok)) score += 1;
  }
  // Mild penalty for "battle"/"trainer" tracks when a route slug is searched —
  // they often share numbers but aren't ambient walking music.
  if (/battle|trainer|gym|champion|elite/i.test(t)) score -= 1;
  // Day/Night preference. Tracks are commonly titled "Route 201 (Day)" / "Route 201 (Night)".
  // Boost the matching band, mildly penalize the opposite band so the right one wins ties.
  if (timeBand === "day" || timeBand === "morning") {
    if (/\bday\b|\bmorning\b/i.test(t)) score += 3;
    if (/\bnight\b/i.test(t)) score -= 2;
  } else if (timeBand === "night") {
    if (/\bnight\b/i.test(t)) score += 3;
    if (/\bday\b|\bmorning\b/i.test(t)) score -= 2;
  }
  return score;
}

function rankCandidates(tracks, tokens, timeBand, n = 5) {
  return tracks
    .map((tr) => ({ ...tr, score: scoreTrack(tr.title, tokens, timeBand) }))
    .filter((tr) => tr.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

// --- server ---

const app = express();
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// Map a Pokémon-version slug ("diamond"/"pearl"/"platinum") to the badge texts
// Bulbapedia uses in the Music table ("D"/"P"/"Pt").
const VERSION_BADGES = {
  diamond: "D", pearl: "P", platinum: "Pt",
  red: "R", blue: "B", yellow: "Y",
  gold: "G", silver: "S", crystal: "C",
  ruby: "Ru", sapphire: "Sa", emerald: "E",
  firered: "FR", leafgreen: "LG",
  heartgold: "HG", soulsilver: "SS",
  black: "B", white: "W", "black-2": "B2", "white-2": "W2",
  x: "X", y: "Y", "omega-ruby": "OR", "alpha-sapphire": "AS",
  sun: "S", moon: "M", "ultra-sun": "US", "ultra-moon": "UM",
  sword: "Sw", shield: "Sh",
  scarlet: "Sc", violet: "V",
};

app.get("/bgm/search", async (req, res) => {
  try {
    const slug = String(req.query.slug || "").trim();
    const version = String(req.query.version || "").trim();
    if (!slug || !version) return res.status(400).json({ error: "slug and version required" });
    const albumSlug = albums[version];
    if (!albumSlug) return res.status(404).json({ error: `no album mapped for version "${version}"` });

    const tracks = await getAlbumTracks(albumSlug);
    const timeBand = String(req.query.timeBand || "").trim() || null; // "day" | "night" | "morning" | null

    // Try Bulbapedia music section first: it tells us the exact track title
    // for this slug+version+timeBand, even when the slug doesn't appear in any track name.
    let bulbaTrackTitle = null;
    let bulbaTrace = { source: "bulbapedia", title: null, matchedRow: null, allRows: [], pickReason: null, error: null };
    try {
      // Prefer the PokéAPI-declared parent location name (handles sub-area floors
      // like "wayward-cave-b1f" -> parent "wayward-cave" -> Bulbapedia "Wayward_Cave").
      const parent = await getPokeapiParentLocation(slug);
      const title = parent ? locationToBulbaTitle(parent) : slugToBulbaTitle(slug);
      const info = await fetchBulbaLocation(title);
      bulbaTrace.title = info.title;
      bulbaTrace.allRows = info.music || [];
      if (info.music && info.music.length > 0) {
        const wantBadge = VERSION_BADGES[version];
        const wantSit = timeBand === "night" ? /night/i
                      : timeBand === "morning" ? /morning|day/i
                      : timeBand === "day" ? /day/i
                      : null;
        const matches = info.music.filter((m) => {
          const verOk = !wantBadge || m.games.includes(wantBadge);
          const sitOk = !wantSit || wantSit.test(m.situation);
          return verOk && sitOk;
        });
        let pick, reason;
        if (matches[0]) { pick = matches[0]; reason = `version badge "${wantBadge}" + situation /${wantSit?.source || "any"}/`; }
        else {
          const verOnly = info.music.find((m) => !wantBadge || m.games.includes(wantBadge));
          if (verOnly) { pick = verOnly; reason = `version badge "${wantBadge}" only (no situation match)`; }
          else { pick = info.music[0]; reason = "first row (no version match)"; }
        }
        if (pick) {
          bulbaTrackTitle = pick.trackTitle;
          bulbaTrace.matchedRow = pick;
          bulbaTrace.pickReason = reason;
        }
      } else {
        bulbaTrace.pickReason = "no music rows on Bulbapedia page";
      }
    } catch (e) {
      bulbaTrace.error = e.message;
    }

    let tokens, candidates;
    if (bulbaTrackTitle) {
      // Bulbapedia gave us an authoritative title. Exact-match wins; the day/night
      // bias is already baked into the row Bulbapedia returned (it picked the
      // matching-band row), so don't re-apply it here.
      const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
      const target = norm(bulbaTrackTitle);
      candidates = tracks
        .map((tr) => {
          const t = norm(tr.title);
          let score = 0;
          if (t === target) score = 100;
          else if (t.startsWith(target + " ") || t.endsWith(" " + target)) score = 50;
          else if (t.includes(target)) score = 25;
          else {
            // Last-ditch: token overlap on the bulba title.
            const toks = target.split(/[\s()-]+/).filter(Boolean);
            for (const tok of toks) if (t.includes(tok)) score += 1;
          }
          return { ...tr, score };
        })
        .filter((tr) => tr.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
      tokens = [bulbaTrackTitle];
    } else {
      tokens = tokensFromSlug(slug);
      candidates = rankCandidates(tracks, tokens, timeBand, 8);
    }
    res.json({ album: albumSlug, tokens, timeBand, bulbaTrackTitle, bulbaTrace, candidates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/bgm/resolve", async (req, res) => {
  try {
    const trackUrl = String(req.query.trackUrl || "").trim();
    if (!trackUrl.startsWith(KHINSIDER)) {
      return res.status(400).json({ error: "trackUrl must be a khinsider URL" });
    }
    const result = await resolveMp3(trackUrl);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stream an MP3 through the proxy with CORS headers, so the browser can use
// Web Audio decodeAudioData (which requires CORS, unlike <audio> playback).
app.get("/bgm/stream", async (req, res) => {
  try {
    const url = String(req.query.url || "").trim();
    if (!url.startsWith("http")) return res.status(400).json({ error: "url required" });
    const upstream = await fetch(url, { headers: { "User-Agent": UA } });
    if (!upstream.ok) return res.status(upstream.status).json({ error: `upstream HTTP ${upstream.status}` });
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    res.setHeader("Cache-Control", "public, max-age=86400");
    // Stream the body through.
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Bulbapedia location info ---

const BULBA = "https://bulbapedia.bulbagarden.net";

// Map a PokéAPI location-area slug (e.g. "sinnoh-route-201-area") to a Bulbapedia
// page title (e.g. "Sinnoh_Route_201"). We strip "-area", title-case words.
function slugToBulbaTitle(slug) {
  let s = slug.replace(/-area$/, "");
  // "sinnoh-route-201" -> ["sinnoh", "route", "201"] -> "Sinnoh_Route_201"
  return s
    .split("-")
    .map((w) => w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w)
    .join("_");
}

// PokéAPI's location-area resource has a .location.name pointing to the parent
// location. Bulbapedia hosts info per *location*, not per sub-area floor — so
// "wayward-cave-b1f" should map to Bulbapedia's "Wayward_Cave" page, not a
// nonexistent "Wayward_Cave_B1f". We fetch the area resource once and cache
// the parent location name.
const POKEAPI = "https://pokeapi.co/api/v2";

async function getPokeapiParentLocation(slug) {
  const cacheKey = `pokeapi-parent:${slug}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached.parent || null;
  try {
    const r = await fetch(`${POKEAPI}/location-area/${slug}`);
    if (!r.ok) {
      await cacheSet(cacheKey, { parent: null });
      return null;
    }
    const data = await r.json();
    const parent = data.location?.name || null;
    await cacheSet(cacheKey, { parent });
    return parent;
  } catch {
    return null;
  }
}

// Convert a PokéAPI location name (e.g. "wayward-cave") to a Bulbapedia title
// candidate (e.g. "Wayward_Cave"). Same casing rule as slugToBulbaTitle minus
// the "-area" stripping.
function locationToBulbaTitle(loc) {
  return loc.split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join("_");
}

const ARROWS = { "←": "west", "→": "east", "↑": "north", "↓": "south" };

// Bulbapedia uses periods in some titles ("Mt._Coronet", "St._Anne"). Slugs strip
// punctuation, so we have to try a few variants. Returns the title that resolved.
function titleVariants(title) {
  const variants = [title];
  const REGION_RE = /^(Sinnoh|Hoenn|Kanto|Johto|Unova|Kalos|Alola|Galar|Paldea)_(.+)$/;
  const ABBREV_RE = /^((?:Sinnoh|Hoenn|Kanto|Johto|Unova|Kalos|Alola|Galar|Paldea)_)?((?:Mt|Mts|St|Sgt|Dr|Mr|Ms|Mrs|Jr|Sr))_(.+)$/;

  // Variant: insert period after Mt/St/etc abbreviation.
  const ab = title.match(ABBREV_RE);
  if (ab) {
    const [, region = "", abbrev, rest] = ab;
    variants.push(`${region}${abbrev}._${rest}`);
  }
  // Variant: drop region prefix or move it to "(Region)" disambig form.
  const rg = title.match(REGION_RE);
  if (rg) {
    const [, region, rest] = rg;
    variants.push(rest);
    // Disambig form: e.g. Sinnoh_Battle_Frontier -> Battle_Frontier_(Sinnoh)
    variants.push(`${rest}_(${region})`);
    // Combined: drop region AND insert period (e.g. Sinnoh_Mt_Coronet -> Mt._Coronet).
    const ab2 = rest.match(/^((?:Mt|Mts|St|Sgt|Dr|Mr|Ms|Mrs|Jr|Sr))_(.+)$/);
    if (ab2) variants.push(`${ab2[1]}._${ab2[2]}`);
  }
  return variants;
}

async function fetchBulbaLocation(title) {
  const cacheKey = `bulba:${title}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  let html, resolvedTitle;
  for (const v of titleVariants(title)) {
    const url = `${BULBA}/wiki/${encodeURIComponent(v)}`;
    try {
      html = await fetchHtml(url);
      resolvedTitle = v;
      break;
    } catch (e) {
      if (!/HTTP 404/.test(e.message)) throw e;
    }
  }
  if (!html) throw new Error(`khinsider ${BULBA}/wiki/${encodeURIComponent(title)} -> HTTP 404`);
  title = resolvedTitle;
  const $ = cheerio.load(html);

  // Find "Connecting locations" header td, then the table that follows.
  const result = { title, connections: [], mapImageUrl: null };

  // Connections: each connecting location is a /wiki/ anchor inside a small 2-cell
  // table (nested under the "Connecting locations" infobox section), paired with an
  // arrow glyph in a sibling cell of the *same* innermost table. Pairing per-link
  // (not per-row of the outer table) is what gets directions right — the outer row
  // contains both west and east links and naïvely picking "any arrow in the row"
  // makes the west link inherit the east arrow.
  const connHeader = $('td').filter((_, el) => $(el).text().trim().startsWith("Connecting locations")).first();
  if (connHeader.length) {
    connHeader.find('a[href^="/wiki/"]').each((_, a) => {
      const $a = $(a);
      const href = $a.attr("href");
      const name = $a.text().trim();
      if (!name || !href) return;
      const bulbaTitle = href.replace("/wiki/", "");
      if (bulbaTitle === title) return;
      // Skip the literal "Connecting locations" header link (which points to /wiki/Route).
      if (bulbaTitle === "Route" && /Connecting locations/i.test($a.text())) return;
      // Find arrow in the innermost <table> ancestor that contains this link.
      const innermost = $a.closest("table");
      let dir = null;
      if (innermost.length) {
        const text = innermost.text();
        for (const arrowChar of Object.keys(ARROWS)) {
          if (text.includes(arrowChar)) { dir = ARROWS[arrowChar]; break; }
        }
      }
      result.connections.push({
        direction: dir,
        name,
        bulbaTitle,
        slug: bulbaTitleToPokeapiSlug(bulbaTitle),
      });
    });
    // Dedupe by bulbaTitle, keep first occurrence (which has the most-local arrow).
    const seen = new Set();
    result.connections = result.connections.filter((c) => {
      if (seen.has(c.bulbaTitle)) return false;
      seen.add(c.bulbaTitle);
      return true;
    });
  }

  // Fallback: if no Connecting locations table parsed (interiors like Fuego Ironworks),
  // look for the infobox "Location:" row whose <td> contains anchors to nearby places.
  if (result.connections.length === 0) {
    $('th').filter((_, el) => /^Location:?\s*$/i.test($(el).text().trim())).each((_, th) => {
      const td = $(th).parent().find('td').first();
      if (!td.length) return;
      td.find('a[href^="/wiki/"]').each((_, a) => {
        const href = $(a).attr("href");
        const name = $(a).text().trim();
        if (!name || !href) return;
        const bulbaTitle = href.replace("/wiki/", "");
        if (bulbaTitle === title) return;
        // Skip non-location pages: project links, regions themselves, generic terms.
        // Skip the region page itself (just "Sinnoh") and meta pages, but keep
        // route titles like "Sinnoh_Route_205".
        if (/^(Sinnoh|Hoenn|Kanto|Johto|Unova|Kalos|Alola|Galar|Paldea|Hisui)$/i.test(bulbaTitle)) return;
        if (/^(Region|Pok%C3%A9mon_world|List_of)/i.test(bulbaTitle)) return;
        // Skip game-version pages: titles begin with "Pokémon_" (URL-encoded
        // "Pok%C3%A9mon_") and anchor text is often a short version badge.
        if (/^Pok%C3%A9mon[_:]/i.test(bulbaTitle)) return;
        // Skip badge-shaped anchor text (1-4 chars, mostly uppercase). Real
        // place names ("Sandgem Town", "Mount Coronet") are longer and not all-caps.
        if (/^[A-Z][A-Z0-9]{0,3}$/.test(name)) return;
        result.connections.push({
          direction: "near",
          name,
          bulbaTitle,
          slug: bulbaTitleToPokeapiSlug(bulbaTitle),
        });
      });
    });
    // Dedupe.
    const seen = new Set();
    result.connections = result.connections.filter((c) => {
      if (seen.has(c.bulbaTitle)) return false;
      seen.add(c.bulbaTitle);
      return true;
    });
  }

  // Map image: try several signals in order of trust.
  // (1) An infobox row whose header is "Location" (containing a "Location of X in Y" caption)
  //     usually has the canonical map image as its first <img>. Most robust.
  // (2) An <img> with alt containing "Map" and the page title (loose match).
  // (3) Any <img> whose filename matches "<normalized-title>_Map.png".
  // Strip "/thumb/.../<size>px-Foo.png" thumbnails to the original; preserves filename match.
  const norm = (s) => s.toLowerCase().replace(/[._\s()]+/g, "");
  const altWanted = norm(title);
  const stripThumb = (src) => src.replace(/\/thumb(\/[a-f0-9]\/[a-f0-9]{2}\/[^/]+)\/[^/]+$/i, "$1");

  // (1) Infobox "Location" row.
  const locHeader = $('td, th').filter((_, el) => {
    const t = $(el).text().trim();
    return /^Location$/i.test(t) && $(el).find('a[href="/wiki/Region"]').length > 0;
  }).first();
  if (locHeader.length) {
    const img = locHeader.find('img').first();
    const src = img.attr("src");
    if (src && /Map\.png/i.test(src)) {
      const full = stripThumb(src.startsWith("//") ? "https:" + src : src);
      result.mapImageUrl = full;
    }
  }

  // (2) alt-based.
  if (!result.mapImageUrl) {
    $('img[alt]').each((_, el) => {
      const alt = $(el).attr("alt") || "";
      const src = $(el).attr("src") || "";
      if (norm(alt) === altWanted && /Map\.png|_Map\.png/i.test(src)) {
        result.mapImageUrl = stripThumb(src.startsWith("//") ? "https:" + src : src);
      }
    });
  }

  // (3) Filename-based.
  if (!result.mapImageUrl) {
    $('img').each((_, el) => {
      const src = $(el).attr("src") || "";
      const filename = (src.split("/").pop() || "").replace(/^\d+px-/, "");
      if (norm(filename).includes(altWanted) && /map\.png/i.test(filename)) {
        result.mapImageUrl = stripThumb(src.startsWith("//") ? "https:" + src : src);
      }
    });
  }

  // (4) Caption-based. Find a "Location of X in Y" caption and grab the nearest
  // preceding _Map.png image. Catches pages like Battle Frontier where the map
  // file is named after a sublocation (Sinnoh_Battle_Park_Map.png).
  if (!result.mapImageUrl) {
    $('small, figcaption').each((_, el) => {
      if (result.mapImageUrl) return;
      const text = $(el).text().trim();
      if (!/^Location of .+ in .+\.?$/i.test(text)) return;
      // Walk back to the nearest <img> with src ending _Map.png within the same cell.
      const td = $(el).closest("td, figure");
      const img = td.find('img').filter((_, im) => /_Map\.png/i.test($(im).attr("src") || "")).first();
      if (img.length) {
        const src = img.attr("src");
        result.mapImageUrl = stripThumb(src.startsWith("//") ? "https:" + src : src);
      }
    });
  }

  // Music section. Column ordering varies by region/gen — Sinnoh has
  // Games|Situation|Japanese|English|Composition|Arrangement; Kanto has
  // Games|Song name|Composition|Arrangement (no Situation, no Japanese, single
  // "Song name" column with the track linked to the album page). We detect
  // columns by header text rather than fixed positions.
  result.music = [];
  const musicHeadline = $('span#Music').first();
  if (musicHeadline.length) {
    const musicTable = musicHeadline.closest("h2, h3, h4").nextAll("table").first();
    if (musicTable.length) {
      const rows = musicTable.find("tr").toArray();
      if (rows.length >= 2) {
        // Header row: read column titles in order.
        const headerCells = $(rows[0]).children("th, td").toArray();
        const colNames = headerCells.map((c) => $(c).text().trim().toLowerCase());
        const findCol = (...patterns) => {
          for (const p of patterns) {
            const idx = colNames.findIndex((n) => p.test(n));
            if (idx >= 0) return idx;
          }
          return -1;
        };
        const gamesIdx = findCol(/^games$/);
        const situationIdx = findCol(/^situation$/, /^location$/);
        const trackIdx = findCol(
          /^song name \(english\)/,
          /^song name \(english translation\)/,
          /^song name$/,
          /^english/,
          /^title$/
        );
        if (gamesIdx < 0 || trackIdx < 0) {
          // Unrecognized table shape; skip music parsing rather than emit garbage.
        } else {
          let lastGames = [];
          for (let r = 1; r < rows.length; r++) {
            const cells = $(rows[r]).children("th, td").toArray();
            if (cells.length === 0) continue;
            // Determine if this row carries its own games cell or inherits via rowspan.
            // Heuristic: if cell[0] is a <th>, it's a fresh games cell; otherwise inherit.
            let games = lastGames;
            let off = 0;
            if (cells[0] && cells[0].tagName?.toLowerCase?.() === "th") {
              const badges = [];
              $(cells[0]).find("span, a").each((_, el) => {
                const t = $(el).text().trim();
                if (/^[A-Z][A-Za-z0-9]{0,3}$/.test(t)) badges.push(t);
              });
              games = [...new Set(badges)];
              lastGames = games;
              off = 0; // gamesIdx is 0; cells indexed normally
            } else {
              // Inherited row — cells correspond to columns starting at gamesIdx+1.
              off = -1; // shift cell indexing left by one
            }
            const cellAt = (colIdx) => cells[colIdx + off];
            const situation = situationIdx >= 0 ? $(cellAt(situationIdx)).text().trim() : "";
            const trackCell = cellAt(trackIdx);
            if (!trackCell) continue;
            const trackAnchor = $(trackCell).find('a').first();
            const trackTitle = (trackAnchor.text().trim() || $(trackCell).text().trim()).replace(/\s+/g, " ");
            if (!trackTitle) continue;
            result.music.push({ games, situation, trackTitle });
          }
        }
      }
    }
  }

  // Layout section. Different pages use different table shapes (Sinnoh: versions in
  // column headers + images in row below; Hoenn: versions as row labels + images
  // beside them). The filename suffix is the most reliable signal — Bulbapedia
  // names layout files like "Hoenn_Route_134_RS.png" / "_E.png" / "_ORAS.png" /
  // "Sinnoh_Route_208_DP.png" / "_Pt.png". We walk every <img> in the layout section
  // and assign it to versions based on the filename suffix.
  //
  // Suffix -> versions mapping. Order matters: longer suffixes first so e.g. "ORAS"
  // doesn't accidentally match as "OR" + "AS".
  const SUFFIX_TO_VERSIONS = [
    ["RGBY",  ["red", "blue", "yellow"]],         // sometimes Green too but PokéAPI doesn't
    ["GSC",   ["gold", "silver", "crystal"]],
    ["RSE",   ["ruby", "sapphire", "emerald"]],
    ["FRLG",  ["firered", "leafgreen"]],
    ["HGSS",  ["heartgold", "soulsilver"]],
    ["ORAS",  ["omega-ruby", "alpha-sapphire"]],
    ["BW2",   ["black-2", "white-2"]],
    ["B2W2",  ["black-2", "white-2"]],
    ["BDSP",  ["brilliant-diamond", "shining-pearl"]],
    ["LGPE",  ["lets-go-pikachu", "lets-go-eevee"]],
    ["PE",    ["lets-go-pikachu", "lets-go-eevee"]],
    ["USUM",  ["ultra-sun", "ultra-moon"]],
    ["SwSh",  ["sword", "shield"]],
    ["RG",    ["red", "blue"]],                    // sometimes used for Red+Green/Blue
    ["RB",    ["red", "blue"]],
    ["GS",    ["gold", "silver"]],
    ["RS",    ["ruby", "sapphire"]],
    ["DP",    ["diamond", "pearl"]],
    ["BW",    ["black", "white"]],
    ["XY",    ["x", "y"]],
    ["SM",    ["sun", "moon"]],
    ["SV",    ["scarlet", "violet"]],
    ["Y",     ["yellow"]],
    ["E",     ["emerald"]],
    ["C",     ["crystal"]],
    ["Pt",    ["platinum"]],
  ];

  result.layouts = {};
  const layoutHeadline = $('span#Layout').first();
  let sectionImgs = [];
  if (layoutHeadline.length) {
    // Layout-section path: collect <img>s within the Layout heading's section.
    const startEl = layoutHeadline.closest("h2, h3, h4");
    const startIsH3 = startEl[0]?.tagName?.toLowerCase?.() === "h3";
    startEl.nextAll().each((_, el) => {
      const tag = el.tagName?.toLowerCase?.();
      if (tag === "h2") return false;
      if (startIsH3 && tag === "h3") return false;
      $(el).find("img").each((_, im) => sectionImgs.push(im));
    });
  } else {
    // Fallback: pages without a Layout section (older Kanto/Kalos pages, where
    // layouts live in per-generation subsections). Sweep all images on the page
    // and rely on the title-prefix + suffix pattern in the filename.
    $('img').each((_, im) => sectionImgs.push(im));
  }

  // Restrict to images whose filename starts with this page's title — keeps us
  // from grabbing icons, banners, neighbor-route layouts that happen to appear.
  const titlePrefix = title.replace(/^.*?_/, ""); // drop region prefix; e.g. Sinnoh_Route_208 -> Route_208
  const titleFull = title;
  sectionImgs = sectionImgs.filter((im) => {
    const src = $(im).attr("src") || "";
    const filename = (src.split("/").pop() || "").replace(/^\d+px-/, "");
    return filename.startsWith(titleFull + "_") || filename.startsWith(titlePrefix + "_");
  });

  sectionImgs.forEach((img) => {
      const src = $(img).attr("src") || "";
      const filename = (src.split("/").pop() || "").replace(/^\d+px-/, "");
      // Skip non-layout images (warning icons, banner sprites, etc).
      if (!/\.png$/i.test(filename)) return;
      // Skip alt-view images: "underwater", "interior", "back", "alt" etc. We want
      // the canonical surface layout per version. Bulbapedia commonly inserts
      // these as separate columns/rows alongside the main layout.
      if (/_(underwater|interior|inside|back|alt|night|cave|sky)_/i.test(filename)) return;
      // Match suffix: "<basename>_<SUFFIX>.png" — single-char codes like "_E.png"
      // (Emerald), "_C.png" (Crystal), "_Y.png" (Yellow) must be allowed.
      const m = filename.match(/_([A-Z][A-Za-z0-9]*)\.png$/);
      if (!m) return;
      const suffix = m[1];
      const found = SUFFIX_TO_VERSIONS.find(([s]) => s === suffix);
      if (!found) return;
      const full = stripThumb(src.startsWith("//") ? "https:" + src : src);
      for (const v of found[1]) {
        // First image wins — usually the surface/main view appears before underwater/alt views.
        if (!result.layouts[v]) result.layouts[v] = full;
      }
    });

  await cacheSet(cacheKey, result);
  return result;
}

// Reverse of slugToBulbaTitle for connection slugs. Adds "-area" back.
function bulbaTitleToPokeapiSlug(title) {
  return title.toLowerCase().replace(/_/g, "-") + "-area";
}

app.get("/location/info", async (req, res) => {
  try {
    const slug = String(req.query.slug || "").trim();
    if (!slug) return res.status(400).json({ error: "slug required" });
    const parent = await getPokeapiParentLocation(slug);
    const title = parent ? locationToBulbaTitle(parent) : slugToBulbaTitle(slug);
    const data = await fetchBulbaLocation(title);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Image passthrough (CORS) so the browser can load the map into a canvas
// and read pixels for highlight detection.
app.get("/location/image", async (req, res) => {
  try {
    const url = String(req.query.url || "").trim();
    if (!url.startsWith("http")) return res.status(400).json({ error: "url required" });
    const upstream = await fetch(url, { headers: { "User-Agent": UA } });
    if (!upstream.ok) return res.status(upstream.status).json({ error: `upstream HTTP ${upstream.status}` });
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`bgm-proxy listening on http://localhost:${PORT}`);
});
