// Silk extraction for Racing Australia meeting pages.
//
// Every silk in a meeting is already on that meeting's Form.aspx page, so one fetch
// covers the whole card. RA renders each runner as:
//
//   <div class='Silks'><img src=".../JockeySilks/74159.png"></div>
//   <div class='horse-info'>
//     <span class="horse-number">1</span>
//     <span class="horse-name"><a ...>FEDERAL RESERVE</a></span>
//
// so the silk id, the saddlecloth number and the horse name all come out of one block,
// and the enclosing <a name="RaceN"> anchor says which race it belongs to.
//
// This only works on RAW html. Jina's markdown rendering of the same page contains no
// silk images at all, and its rendering of an individual horse page drops the silk for
// a sizeable, reproducible share of horses — which is why the caller must fetch raw.

export function normalizeHorseName(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function normalizeHorseNumber(value) {
  const match = (value || '').toString().trim().match(/^(\d+)([a-z])?/i);
  if (!match) {
    return '';
  }
  return `${match[1]}${match[2] ? match[2].toLowerCase() : ''}`;
}

// RA writes apostrophes as &rsquo; ("FAY&rsquo;S ANGELS"). Leaving entities in place is
// actively harmful here: normalizeHorseName strips punctuation but keeps digits, so an
// undecoded "&#39;" would become "39" inside the key and never match the same horse
// coming from a page that spells it "FAY’S ANGELS".
const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…',
};

export function decodeHtmlEntities(text) {
  return (text || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = HTML_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : match;
  });
}

// Horse names carry a country of origin on some pages but not others — "FABRICE (NZ)"
// on the form page is "FABRICE" once the acceptances parser has trimmed it. Return a
// key for each spelling so either one matches.
export function horseNameKeys(name) {
  const raw = (name || '').trim();
  const stripped = raw.replace(/\s*\((?:[A-Z]{2,3})\)\s*/gi, ' ').trim();
  const keys = new Set();
  for (const variant of [raw, stripped]) {
    const key = normalizeHorseName(variant);
    if (key) keys.add(key);
  }
  return [...keys];
}

const RA_KEY_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// "2026-08-29" → "2026Aug29", the date half of an RA meeting Key.
export function raKeyDateFromISO(isoDate) {
  const m = (isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const month = RA_KEY_MONTHS[parseInt(m[2], 10) - 1];
  if (!month) return '';
  return `${m[1]}${month}${m[3]}`;
}

// The importer writes race names as "Race 3 - Rosehill Gardens - MIDWAY HANDICAP", so
// the venue needed to rebuild an RA key can be recovered from a saved race. Older rows
// may be "Race 3 - MIDWAY HANDICAP" or free text, which yields a null venue.
export function parseRaceNameParts(raceName) {
  const name = (raceName || '').trim();
  const raceNumMatch = name.match(/\bRace\s+(\d+)/i);
  const raceNum = raceNumMatch ? parseInt(raceNumMatch[1], 10) : null;

  const segments = name.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
  // "Race N" / venue / race title — the venue is the middle segment when there is one.
  const venue = segments.length >= 3 && /^Race\s+\d+$/i.test(segments[0]) ? segments[1] : null;

  return { raceNum, venue };
}

const SILK_BLOCK_RE = /class=['"]?Silks['"]?[^>]*>\s*<img[^>]*JockeySilks\/(\d+)\.png[^>]*>[\s\S]{0,600}?horse-number['"]?[^>]*>\s*(\d+)\s*<[\s\S]{0,600}?horse-name['"]?[^>]*>([\s\S]{0,300}?)<\/span>/gi;
const RACE_ANCHOR_RE = /<a\s+name=["']?Race(\d+)["']?\s*>|class=['"]?raceNum['"]?[^>]*>\s*Race\s+(\d+)/gi;

// → [{ silksId, number, name, raceNum }] for every runner on the meeting page.
export function extractRASilkEntries(html) {
  // Offsets where each race section starts, so a silk block can be attributed to a race.
  const raceStarts = [];
  RACE_ANCHOR_RE.lastIndex = 0;
  let anchor;
  while ((anchor = RACE_ANCHOR_RE.exec(html))) {
    const num = parseInt(anchor[1] || anchor[2], 10);
    if (!Number.isFinite(num)) continue;
    if (!raceStarts.length || raceStarts[raceStarts.length - 1].raceNum !== num) {
      raceStarts.push({ raceNum: num, index: anchor.index });
    }
  }
  const raceNumAt = (index) => {
    let found = null;
    for (const start of raceStarts) {
      if (start.index <= index) found = start.raceNum;
      else break;
    }
    return found;
  };

  const entries = [];
  SILK_BLOCK_RE.lastIndex = 0;
  let block;
  while ((block = SILK_BLOCK_RE.exec(html))) {
    const name = decodeHtmlEntities(block[3].replace(/<[^>]*>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    entries.push({ silksId: block[1], number: block[2], name, raceNum: raceNumAt(block.index) });
  }
  return entries;
}

// Index the entries for lookup, optionally narrowed to one race on the card.
export function buildSilkIndex(entries, raceNum) {
  let scoped = entries;
  if (raceNum) {
    const forRace = entries.filter(entry => entry.raceNum === raceNum);
    // Only narrow if we actually recognised race boundaries.
    if (forRace.length) scoped = forRace;
  }

  const byNumber = new Map();
  const byName = new Map();
  for (const entry of scoped) {
    const numKey = normalizeHorseNumber(entry.number);
    if (numKey && !byNumber.has(numKey)) byNumber.set(numKey, entry.silksId);
    for (const key of horseNameKeys(entry.name)) {
      if (!byName.has(key)) byName.set(key, entry.silksId);
    }
  }
  return { byNumber, byName, count: scoped.length };
}

// Name is the trustworthy key — saddlecloth numbers shift with scratchings — so the
// number is only a fallback.
export function lookupSilkId(index, horse) {
  if (!index) return null;
  for (const key of horseNameKeys(horse?.name)) {
    if (index.byName.has(key)) return index.byName.get(key);
  }
  const numKey = normalizeHorseNumber(horse?.number);
  if (numKey && index.byNumber.has(numKey)) return index.byNumber.get(numKey);
  return null;
}
