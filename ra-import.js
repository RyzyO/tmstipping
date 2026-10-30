// Racing Australia scraping, extracted from admin-dark-script.js so the sweep admin can
// reuse the exact same meeting browser, field parsing and silk/form enrichment.
//
// DOM-free apart from DOMParser. admin-dark-script.js still carries its own copy of
// this code; if you change a parser here, change it there too (or point admin-dark at
// this module).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';
import {
  normalizeHorseName,
  normalizeHorseNumber,
  extractRASilkEntries,
  buildSilkIndex,
  lookupSilkId,
} from './ra-silks.js';

// Our own Supabase edge function (supabase/functions/ra-proxy). Returns the origin's
// bytes untouched, so silk <img> tags survive — unlike r.jina.ai, which renders to
// markdown and drops the silk image on a large share of horse pages. Always tried
// first; the public proxies stay as fallbacks in case the function isn't deployed.
const SELF_PROXY_BASE = `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/ra-proxy`;

function buildSelfProxyUrl(targetUrl) {
  return `${SELF_PROXY_BASE}?url=${encodeURIComponent(targetUrl)}`;
}

// The edge function sits behind Supabase's gateway, so it needs the project key.
function proxyRequestHeaders(proxyUrl) {
  if (!proxyUrl.startsWith(SELF_PROXY_BASE)) return undefined;
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
}

function buildProxyUrls(targetUrl, preferRaw = false) {
  const selfUrl       = buildSelfProxyUrl(targetUrl);
  const jinaUrl       = `https://r.jina.ai/${targetUrl}`;
  // allorigins needs the full target URL encoded so its own ?url= param isn't split
  // by any ? or & in the target. encodeURIComponent handles already-encoded sequences
  // safely: %2C in the target becomes %252C in the outer URL, which allorigins decodes
  // back to %2C before forwarding — RA then decodes that to the actual comma.
  const allOriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
  const codeTabsUrl   = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;

  if (preferRaw) {
    return [selfUrl, allOriginsUrl, codeTabsUrl, jinaUrl];
  }
  return [selfUrl, jinaUrl, allOriginsUrl, codeTabsUrl];
}

// Fetch with an AbortController timeout so hung requests don't block forever.
async function fetchWithTimeout(url, timeoutMs = 25000, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal, cache: 'no-store', headers });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`Timed out after ${timeoutMs / 1000}s`);
    throw err;
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Walks the proxy list, then walks it again (twice more, with backoff) before giving
// up. Public proxies fail transiently often enough that a single pass through them was
// the main reason silk scraping only landed some of the time.
export async function fetchHtmlViaProxy(targetUrl, contextLabel, preferRaw = false, validator = null) {
  const proxyUrls = buildProxyUrls(targetUrl, preferRaw);
  const ATTEMPTS = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    for (const proxyUrl of proxyUrls) {
      try {
        console.log(`[${contextLabel}] Trying proxy (attempt ${attempt}):`, proxyUrl);
        const response = await fetchWithTimeout(proxyUrl, 45000, proxyRequestHeaders(proxyUrl));
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        console.log(`[${contextLabel}] Got response (${html.length} chars) from:`, proxyUrl);
        if (!html || html.length < 200) {
          throw new Error('Response too small / empty');
        }

        // A proxy can return 200 with content that's missing the bit we actually came
        // for (Jina strips silk images from some horse pages). Treat that as a failure
        // so the next proxy gets a turn instead of us accepting a useless response.
        if (typeof validator === 'function' && !validator(html)) {
          throw new Error('Response missing required content');
        }

        return html;
      } catch (error) {
        console.warn(`[${contextLabel}] Proxy failed:`, proxyUrl, error.message || error);
        lastError = error;
      }
    }
    if (attempt < ATTEMPTS) await sleep(700 * attempt);
  }

  throw new Error(`All proxy fetch attempts failed for ${targetUrl}. Last error: ${lastError?.message || 'Unknown error'}`);
}


function parseDateFromRAKey(dateStr) {
  // "2026Jun26" → "2026-06-26"
  const m = dateStr.match(/^(\d{4})([A-Za-z]{3})(\d{1,2})$/);
  if (m) {
    const mo = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                 jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' }[m[2].toLowerCase()] || '01';
    return `${m[1]}-${mo}-${m[3].padStart(2,'0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return '';
}

function parseTimeFrom12h(str) {
  const m = (str || '').match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  if (m[3].toLowerCase() === 'pm' && h < 12) h += 12;
  if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2,'0')}:${m[2]}`;
}

// Parses Jina AI plain-text output for a Racing Australia form page.
//
// Actual format (tab-separated, NOT markdown pipe tables):
//   Race 1 - 11:45AM RACE NAME (1000 METRES)
//   Of $30,000.1st $15,000, ...
//   No\tLast 10\tHorse\tTrainer\tJockey\tBarrier\tWeight\t...
//   1\t14\tSWEET LEAF          ← horse number, last10, name on one line
//   \tTrainer Name\tJockey (a2/55kg)\t10\t58.5kg\t...  ← continuation with tab prefix
//   2\t2x\tBIG LON
//   \tDavid Hatch\tGrody Spokes\t6\t57.5kg\t...
// Parses Acceptances.aspx markdown, which Jina renders as a pipe table:
//   | Race 1 - 4:15PM NAME (1800 METRES)... |
//   | No | Last 10 | Horse | Trainer | Jockey | Barrier | Weight | ... |
//   | 1 | 82 | [BON RIVIERE](url HorseFullForm.aspx?...) | [Tom Dougall](url) | ... |
// Horse names are links to HorseFullForm, so horseHref comes straight from here.
function parseRAAcceptancesFromMarkdown(md, meetingUrl) {
  const keyMatch = meetingUrl.match(/Key=([^&#]+)/i);
  const keyDecoded = decodeURIComponent(keyMatch?.[1] || '');
  const meetingDate = parseDateFromRAKey(keyDecoded.split(',')[0] || '');

  const RACE_HDR = /Race\s+(\d+)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s+(.*)/i;

  // Strip [text](url) → capture both; href is the full HorseFullForm URL when present
  const parseCell = (cell) => {
    const m = cell.match(/\[([^\]]*)\]\(([^)]*)\)/);
    if (m) {
      const url = m[2].trim();
      const isHorse = /HorseFullForm\.aspx/i.test(url);
      return { text: m[1].trim(), href: isHorse ? url : '' };
    }
    return { text: cell.trim(), href: '' };
  };

  const splitPipeRow = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

  const races = [];
  const lines = md.split('\n');
  let current = null;       // race being built
  let cols = null;          // header column index map

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = splitPipeRow(line);

    // Race heading row (single meaningful cell containing "Race N - TIME ...")
    const headText = cells.find(c => RACE_HDR.test(c));
    if (headText) {
      const hm = headText.match(RACE_HDR);
      if (hm) {
        if (current && current.horses.length) races.push(current);
        const raceNum = parseInt(hm[1], 10);
        const timeStr = hm[2].trim();
        let rest = hm[3].replace(/Times displayed.*$/i, '').trim();
        const distM = rest.match(/\((\d{3,5})\s*METRES?\)/i) || rest.match(/\b(\d{3,5})\s*m\b/i);
        const distance = distM ? distM[1] + 'm' : '';
        const name = rest.replace(/\s*\(\d{3,5}\s*METRES?\)\s*/i, '').trim();
        current = {
          raceNum, name: name || `Race ${raceNum}`, date: meetingDate,
          time: parseTimeFrom12h(timeStr), distance, prize: '',
          horses: [], sourceUrl: meetingUrl,
        };
        cols = null;
      }
      continue;
    }

    // Column header row
    if (/(^|\|)\s*No\s*(\||$)/i.test(line) && /Horse/i.test(line)) {
      cols = {};
      cells.forEach((c, i) => {
        const t = c.toLowerCase();
        if (t === 'no') cols.no = i;
        else if (t.includes('last')) cols.last10 = i;
        else if (t === 'horse') cols.horse = i;
        else if (t === 'trainer') cols.trainer = i;
        else if (t === 'jockey') cols.jockey = i;
        else if (t.includes('barrier')) cols.barrier = i;
        else if (t === 'weight') cols.weight = i;
      });
      continue;
    }

    // Data row — first cell is a runner number, and we have a race + columns
    if (current && cols && /^\d+[a-z]?$/i.test(cells[cols.no] || '')) {
      const number = (cells[cols.no] || '').trim();
      const horseCell = parseCell(cells[cols.horse] || '');
      const name = horseCell.text.replace(/\s*\(NZ\)\s*/gi, '').replace(/\s+/g, ' ').trim();
      if (!name) continue;
      const last10Raw = (cells[cols.last10] || '').trim();
      const last10 = /^[0-9xX.\s-]{1,12}$/.test(last10Raw) ? last10Raw : '';
      const trainer = parseCell(cells[cols.trainer] || '').text;
      const jockey = parseCell(cells[cols.jockey] || '').text.replace(/\s*\([^)]*\)\s*/g, '').trim();
      const barrier = ((cells[cols.barrier] || '').match(/\d+/) || [''])[0];
      const weight = (cells[cols.weight] || '').replace(/\s*kg\s*/gi, '').trim();
      current.horses.push({ number, name, last10, trainer, jockey, barrier, weight, horseHref: horseCell.href });
    }
  }

  if (current && current.horses.length) races.push(current);
  return races.sort((a, b) => a.raceNum - b.raceNum);
}

function parseRAMeetingFromMarkdown(md, meetingUrl) {
  const keyMatch = meetingUrl.match(/Key=([^&#]+)/i);
  const keyDecoded = decodeURIComponent(keyMatch?.[1] || '');
  const meetingDate = parseDateFromRAKey(keyDecoded.split(',')[0] || '');

  const races = [];
  const lines = md.split('\n');

  // Race heading: "Race N - HH:MMam NAME (DISTm)"
  // Note: navigation line "Race 1 Race 2 Race 3..." has no dash so won't match
  const RACE_HDR = /^Race\s+(\d+)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s+(.*)/i;
  const COL_HDR  = /^No\t/i;
  // Data row: starts with a number (possibly followed by letter), then tab
  const DATA_ROW = /^(\d+[a-z]?)\t([^\t]*)\t(.+)/i;
  // Continuation row: starts with a tab (trainer / jockey / barrier / weight)
  const CONT_ROW = /^\t(.+)/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const raceM = line.match(RACE_HDR);

    if (!raceM) { i++; continue; }

    // ── Found a race heading ──────────────────────────────────────────
    const raceNum  = parseInt(raceM[1], 10);
    const timeStr  = raceM[2].trim();
    const restHead = raceM[3].trim();

    // Distance: "(1000 METRES)" or "1000m" at the end of the heading
    const distM    = restHead.match(/\((\d{3,5})\s*METRES?\)/i) || restHead.match(/\b(\d{3,5})\s*m\b/i);
    const distance = distM ? distM[1] + 'm' : '';

    // Race name: everything in heading before the distance paren
    const raceName = restHead.replace(/\s*\(\d{3,5}\s*METRES?\)\s*/i, '').trim();

    // Prize: scan next ~6 lines for "Of $NN,NNN"
    let prize = '';
    for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
      const pm = lines[j].match(/Of\s+\$([\d,]+)/i);
      if (pm) { prize = '$' + pm[1]; break; }
    }

    // Scan forward to find the column header row
    let tableStart = -1;
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      if (COL_HDR.test(lines[j])) { tableStart = j + 1; break; }
    }

    const horses = [];

    if (tableStart >= 0) {
      let j = tableStart;
      while (j < lines.length) {
        const dataM = lines[j].match(DATA_ROW);

        if (dataM) {
          const number  = dataM[1].trim();
          const last10  = dataM[2].trim();
          const namePart = dataM[3].trim()
            .replace(/\s*\(NZ\)\s*/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

          // Look ahead for the continuation line (starts with tab)
          let trainer = '', jockey = '', barrier = '', weight = '';
          let k = j + 1;
          // Skip any blank lines between the name line and the continuation
          while (k < lines.length && lines[k] === '') k++;
          const contM = k < lines.length ? lines[k].match(CONT_ROW) : null;
          if (contM) {
            const parts = contM[1].split('\t');
            // parts: [trainer, jockey, barrier, weight, probable_weight?, ...]
            trainer = (parts[0] || '').trim();
            const jockeyRaw = (parts[1] || '').trim();
            jockey  = jockeyRaw.replace(/\s*\([^)]*\)\s*/g, '').trim();
            barrier = ((parts[2] || '').match(/\d+/) || [''])[0];
            weight  = (parts[3] || '').replace(/\s*kg\s*/gi, '').trim();
            j = k + 1; // advance past the continuation line
          } else {
            j++;
          }

          if (namePart) {
            horses.push({ number, name: namePart, last10, trainer, jockey, barrier, weight, horseHref: '' });
          }
        } else if (RACE_HDR.test(lines[j])) {
          // Hit the next race heading — stop parsing this race's horses
          break;
        } else {
          // Check for a horse detail card header (e.g. "1SWEET LEAF ..." — digit immediately followed by uppercase)
          const cardM = lines[j].match(/^(\d+[a-z]?)([A-Z])/);
          if (cardM) {
            const cardNum = cardM[1];
            for (let k = j + 1; k < Math.min(j + 15, lines.length); k++) {
              if (RACE_HDR.test(lines[k])) break;
              const pm = lines[k].match(/Prizemoney:\s*\$([\d,]+)/i);
              if (pm) {
                const h = horses.find(hh => hh.number === cardNum);
                if (h) h.prizemoney = '$' + pm[1];
                break;
              }
            }
          }
          j++;
        }
      }
      i = j; // resume outer loop from where inner loop stopped
    } else {
      i++;
    }

    if (horses.length) {
      races.push({
        raceNum,
        name: raceName || `Race ${raceNum}`,
        date: meetingDate,
        time: parseTimeFrom12h(timeStr),
        distance,
        prize,
        horses,
        sourceUrl: meetingUrl
      });
    }
  }

  return races.sort((a, b) => a.raceNum - b.raceNum);
}

// Some parse strategies can emit more than one entry for the same race
// (e.g. a heading matched twice, or two fallback strategies both firing).
// Collapse those into a single race, keyed by race number — not name, since
// two distinct races on the same card can legitimately share a generic name
// like "Maiden Plate". Keeps the fullest horse list of the duplicates.
function mergeRacesByName(races) {
  const byName = new Map();
  const order = [];

  for (const race of races) {
    const key = race.raceNum != null ? `#${race.raceNum}` : (race.name || '').trim().toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, race);
      order.push(key);
      continue;
    }
    // Keep whichever copy has more horses; merge in any horses the other has that it's missing.
    const [keep, other] = existing.horses.length >= race.horses.length ? [existing, race] : [race, existing];
    const seen = new Set(keep.horses.map(h => `${h.number}|${h.name}`.toLowerCase()));
    for (const h of other.horses) {
      const k = `${h.number}|${h.name}`.toLowerCase();
      if (!seen.has(k)) { keep.horses.push(h); seen.add(k); }
    }
    byName.set(key, keep);
  }

  return order.map(key => byName.get(key));
}

function parseRAMeetingPage(html, meetingUrl) {
  // Jina AI proxy returns markdown, not HTML. Detect by absence of <html> tag.
  if (!/<html[\s>]/i.test(html)) {
    // Form.aspx renders as tab-separated markdown; Acceptances.aspx as a pipe table.
    let races = parseRAMeetingFromMarkdown(html, meetingUrl);
    if (!races.length) races = parseRAAcceptancesFromMarkdown(html, meetingUrl);
    return mergeRacesByName(races);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const keyMatch = meetingUrl.match(/Key=([^&]+)/i);
  const keyDecoded = decodeURIComponent(keyMatch?.[1] || '');
  const meetingDate = parseDateFromRAKey(keyDecoded.split(',')[0] || '');

  const races = [];

  // Heading text looks like: "Race 1 - 1:18PM BRYANT'S PIES COUNTRY BOOSTED
  // MAIDEN PLATE (1100 METRES) Times displayed in local time of Race Meeting"
  const RACE_HDR = /^Race\s+(\d+)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s+(.*)/i;

  function parseRaceHeadingText(headingText) {
    const text = headingText.replace(/\s+/g, ' ').trim();
    const m = text.match(RACE_HDR);
    if (!m) return null;
    const raceNum = parseInt(m[1], 10);
    const restHead = m[3].replace(/Times displayed.*$/i, '').trim();
    const distM = restHead.match(/\((\d{3,5})\s*METRES?\)/i) || restHead.match(/\b(\d{3,5})\s*m\b/i);
    const distance = distM ? distM[1] + 'm' : '';
    const pm = restHead.match(/\$([\d,]+)/);
    const name = restHead.replace(/\s*\(\d{3,5}\s*METRES?\)\s*/i, '').replace(/\$[\d,]+.*/,'').trim();
    return { raceNum, time: parseTimeFrom12h(m[2].trim()), distance, prize: pm ? '$' + pm[1] : '', name };
  }

  // Strategy 1: the real Form.aspx layout — each race is a
  // <table class="race-title"> heading immediately followed (a couple of
  // siblings later, after a <br>) by the runner table
  // (<table class="race-strip-fields">, or historically without that class).
  const titleTables = Array.from(doc.querySelectorAll('table.race-title'));
  for (const titleTable of titleTables) {
    const headingText = titleTable.querySelector('th')?.textContent || titleTable.textContent || '';
    const parsed = parseRaceHeadingText(headingText);
    if (!parsed || !parsed.raceNum) continue;

    // Find the next table sibling after the heading table — that's the runner list.
    let table = null;
    let el = titleTable.nextElementSibling;
    let steps = 0;
    while (el && steps < 10) {
      if ((el.tagName || '').toLowerCase() === 'table' && el.querySelectorAll('tr').length >= 2) {
        table = el;
        break;
      }
      el = el.nextElementSibling;
      steps++;
    }
    if (!table) continue;

    const horses = parseRAHorsesFromTable(table);
    if (!horses.length) continue;

    races.push({
      raceNum: parsed.raceNum,
      name: parsed.name || `Race ${parsed.raceNum}`,
      date: meetingDate,
      time: parsed.time,
      distance: parsed.distance,
      prize: parsed.prize,
      horses,
      sourceUrl: meetingUrl
    });
  }

  // Strategy 1b: older/alternate markup — named anchors <a name="RaceN"> with
  // a heading found by scanning nearby text for the same "Race N - TIME NAME"
  // pattern, in case the site drops the race-title table class above.
  if (!races.length) {
    const raceAnchors = Array.from(doc.querySelectorAll('a[name], [id]'))
      .filter(el => /^Race\d+$/i.test(el.getAttribute('name') || el.id || ''));

    for (const anchor of raceAnchors) {
      const idStr = anchor.getAttribute('name') || anchor.id;
      const anchorRaceNum = parseInt(idStr.replace(/\D/g, ''), 10);
      if (!anchorRaceNum) continue;

      let parsed = null;
      let table = null;
      let el = anchor.nextElementSibling || anchor.parentElement?.nextElementSibling;
      let steps = 0;

      while (el && steps < 20) {
        const elId = el.getAttribute?.('name') || el.id || '';
        if (/^Race\d+$/i.test(elId) && elId !== idStr) break;

        if (!parsed) {
          const candidate = parseRaceHeadingText(el.textContent || '');
          if (candidate) parsed = candidate;
        }

        if ((el.tagName || '').toLowerCase() === 'table' && !table && el.querySelectorAll('tr').length >= 2) {
          table = el;
        }

        if (parsed && table) break;
        el = el.nextElementSibling;
        steps++;
      }

      if (!table) continue;
      const horses = parseRAHorsesFromTable(table);
      if (!horses.length) continue;

      races.push({
        raceNum: parsed?.raceNum || anchorRaceNum,
        name: parsed?.name || `Race ${anchorRaceNum}`,
        date: meetingDate,
        time: parsed?.time || '',
        distance: parsed?.distance || '',
        prize: parsed?.prize || '',
        horses,
        sourceUrl: meetingUrl
      });
    }
  }

  // Strategy 2: no anchors — scan all tables and infer race sections from
  // preceding headings.
  if (!races.length) {
    const tables = Array.from(doc.querySelectorAll('table'));
    for (const table of tables) {
      if (table.querySelectorAll('tr').length < 3) continue;

      let raceNum = races.length + 1;
      let raceTitle = '', raceTime = '', raceDistance = '', racePrize = '';
      let prev = table.previousElementSibling;
      let steps = 0;
      while (prev && steps < 6) {
        const txt = prev.textContent || '';
        const parsed = parseRaceHeadingText(txt);
        if (parsed) {
          raceNum = parsed.raceNum;
          raceTitle = parsed.name;
          raceTime = parsed.time;
          raceDistance = parsed.distance;
          racePrize = parsed.prize;
          break;
        }
        const rm = txt.match(/\bRace\s*(\d+)\b/i);
        if (rm) {
          raceNum = parseInt(rm[1], 10);
          const tm = txt.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i);
          if (tm) raceTime = parseTimeFrom12h(tm[1]);
          const dm = txt.match(/\b(\d{3,5})\s*[Mm]\b/);
          if (dm) raceDistance = dm[1] + 'm';
          const pm = txt.match(/\$([\d,]+)/);
          if (pm) racePrize = '$' + pm[1];
          break;
        }
        prev = prev.previousElementSibling;
        steps++;
      }

      const horses = parseRAHorsesFromTable(table);
      if (!horses.length) continue;

      races.push({ raceNum, name: raceTitle || `Race ${raceNum}`, date: meetingDate,
                   time: raceTime, distance: raceDistance, prize: racePrize,
                   horses, sourceUrl: meetingUrl });
    }
  }

  return mergeRacesByName(races.sort((a, b) => a.raceNum - b.raceNum));
}

function parseRAHorsesFromTable(table) {
  const horses = [];
  const rows = Array.from(table.querySelectorAll('tr'));

  // Detect header row
  const headerRow = rows.find(r => r.querySelectorAll('th').length > 0);
  const headers = headerRow
    ? Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase())
    : [];

  // Map headers to column indices; fall back to positional defaults for RA layout:
  // [0]=No, [1]=Last10, [2]=Horse, [3]=Trainer, [4]=Jockey, [5]=Barrier, [6]=Weight
  const col = (patterns, fallback) => {
    const idx = headers.findIndex(h => patterns.some(p => p.test(h)));
    return idx >= 0 ? idx : fallback;
  };
  const cNo      = col([/^no\.?$/, /^#$/, /^num/],              0);
  const cLast10  = col([/last\s*10/, /\bl10\b/, /^form$/],      1);
  const cHorse   = col([/horse/, /^name$/],                      2);
  const cTrainer = col([/trainer/],                              3);
  const cJockey  = col([/jockey/, /rider/],                      4);
  const cBarrier = col([/barrier/, /\bgate\b/, /\bbar\b/],      5);
  const cWeight  = col([/\bweight\b/, /\bwgt\b/, /^kg$/],       6);

  const dataRows = rows.filter(r => r.querySelectorAll('td').length >= 3);

  for (const row of dataRows) {
    const cells = Array.from(row.querySelectorAll('td'));

    const number = normalizeHorseNumber((cells[cNo]?.textContent || '').trim());
    if (!number) continue;

    const last10Raw = (cells[cLast10]?.textContent || '').trim();
    // last10 is a short alphanumeric form string, not a horse name
    const last10 = /^[0-9xX.\s-]{1,12}$/.test(last10Raw) ? last10Raw : '';

    // Horse name — find the cell with a link to HorseFullForm
    let horseName = '';
    let horseHref = '';
    const horseCell = cells[cHorse];
    if (horseCell) {
      const link = horseCell.querySelector('a');
      if (link) {
        horseName = (link.textContent || '').trim().replace(/\s*\(NZ\)\s*/gi, '').replace(/\s+/g, ' ').trim();
        const href    = link.getAttribute('href') || '';
        const onclick = link.getAttribute('onclick') || '';
        const hm = (href + '|' + onclick).match(/HorseFullForm\.aspx\?([^"'\s|]*)/i);
        if (hm) horseHref = hm[1];
      } else {
        horseName = (horseCell.textContent || '').trim().replace(/\s*\(NZ\)\s*/gi, '').trim();
      }
    }
    if (!horseName) continue;

    const trainer = (cells[cTrainer]?.textContent || '').replace(/\s+/g, ' ').trim();

    // Jockey: "Nick Palmer (a2/55kg)" → strip the parenthetical
    const jockeyRaw = (cells[cJockey]?.textContent || '').trim();
    const jockey = jockeyRaw.replace(/\s*\([^)]*\)\s*/g, '').trim();

    const barrier = ((cells[cBarrier]?.textContent || '').match(/\d+/) || [''])[0];
    const weight  = (cells[cWeight]?.textContent || '').trim().replace(/\s*kg\s*/gi, '').trim();

    horses.push({ number, name: horseName, last10, trainer, jockey, barrier, weight, horseHref });
  }

  return horses;
}


function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fetchRAHorseHrefs(meetingUrl) {
  const map = new Map();
  const acceptancesUrl = meetingUrl.replace(/Form\.aspx/i, 'Acceptances.aspx');
  if (acceptancesUrl === meetingUrl) return map; // not a Form.aspx URL, nothing to swap

  const markdown = await fetchHtmlViaProxy(acceptancesUrl, 'ra-href-resolve-acceptances', false);
  const races = parseRAAcceptancesFromMarkdown(markdown, acceptancesUrl);

  for (const race of races) {
    for (const horse of race.horses) {
      if (!horse.horseHref) continue;
      const key = normalizeHorseName(horse.name);
      if (key && !map.has(key)) map.set(key, horse.horseHref);
    }
  }

  return map;
}

// Fetch the meeting page as raw HTML and index its silks by race + number + name.
// Parsing lives in ra-silks.js so it can be unit-tested against captured RA pages.
async function fetchRAMeetingSilkMap(meetingUrl, raceNum) {
  // Acceptances.aspx carries no silk images; Form.aspx is the page that has them.
  const formUrl = meetingUrl.replace(/Acceptances\.aspx/i, 'Form.aspx');
  const html = await fetchHtmlViaProxy(
    formUrl,
    'ra-silk-map',
    true,                                       // raw HTML — Jina's markdown drops silks
    (body) => /JockeySilks\/\d+\.png/i.test(body)
  );

  const index = buildSilkIndex(extractRASilkEntries(html), raceNum);
  console.log(`[ra-silk-map] ${index.count} silks indexed from ${formUrl}${raceNum ? ` (race ${raceNum})` : ''}`);
  return index;
}

// Writes a silk id straight into the matching row in the horses table.
function applySilkToRow(horse) {
  if (!horse.silksId) return false;
  const rows = Array.from(document.querySelectorAll('#horses-list .horse-row'));
  for (const row of rows) {
    const nameVal = row.querySelector('.horse-name')?.value || '';
    const noVal   = row.querySelector('.horse-no')?.value   || '';
    const nameMatch = normalizeHorseName(nameVal) === normalizeHorseName(horse.name);
    const noMatch   = normalizeHorseNumber(noVal) === normalizeHorseNumber(horse.number);
    if (!nameMatch && !noMatch) continue;
    const silkInput = row.querySelector('.horse-silk-id');
    if (silkInput) {
      silkInput.value = horse.silksId;
      return true;
    }
  }
  return false;
}

function parseRAHorseFormHistory(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const history = [];

  for (const table of doc.querySelectorAll('table')) {
    const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
    const hasDate = headers.some(h => h.includes('date'));
    const hasPos  = headers.some(h => /pos|place|fin|result/.test(h));
    if (!hasDate || !hasPos) continue;

    const dataRows = Array.from(table.querySelectorAll('tbody tr, tr'))
      .filter(r => r.querySelectorAll('td').length >= 4);

    for (const row of dataRows) {
      const cells = Array.from(row.querySelectorAll('td'));
      const entry = {};
      headers.forEach((h, i) => {
        const val = (cells[i]?.textContent || '').replace(/\s+/g, ' ').trim();
        if (h.includes('date'))                          entry.date    = val;
        else if (/venue|track|course/.test(h))          entry.track   = val;
        else if (h.includes('dist'))                     entry.dist    = val;
        else if (/pos|fin|place|result/.test(h))        entry.pos     = val;
        else if (/jockey|rider/.test(h))                entry.jockey  = val;
        else if (/weight|wgt/.test(h))                  entry.weight  = val;
        else if (/barrier|gate/.test(h))                entry.barrier = val;
        else if (h.includes('winner'))                  entry.winner  = val;
        else if (/margin|marg/.test(h))                 entry.margin  = val;
        else if (/class|grade/.test(h))                 entry.class   = val;
        else if (h.includes('prize') || h.includes('$')) entry.prize  = val;
      });
      if (entry.date) history.push(entry);
    }

    if (history.length) break;
  }

  return history.slice(0, 10);
}

// ── Retrospective silk backfill ──────────────────────────────────────────────
//
// Fills silksId on races that were saved before silk scraping worked reliably.
// Everything hangs off rebuilding the meeting's RA key from what we stored:
//   date "2026-08-29" + venue "Rosehill Gardens" → Key=2026Aug29,NSW,Rosehill Gardens
// The state isn't stored, so we probe the eight of them and keep whichever returns a
// page that actually has silks on it. Meetings stay up on RA for a while after they're
// run, so this works for past races until RA prunes them.
//
// raKeyDateFromISO and parseRaceNameParts live in ra-silks.js alongside the parser.

// The backfill probes up to 16 URLs per meeting to find the right state, so it goes
// straight at our own proxy rather than walking the public fallbacks each time. That
// makes the edge function a hard requirement here — check it once up front so an
function parseRAHomeMeetings(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const meetings = [];

  // Find the schedule table — has <th> links to Calendar.aspx for each state
  let table = null;
  for (const t of doc.querySelectorAll('table')) {
    if (t.querySelector('a[href*="Calendar.aspx?State="]')) { table = t; break; }
  }
  if (!table) return meetings;

  // Map column index → state from the header row
  const colState = {};
  const headerRow = table.querySelector('tr');
  if (headerRow) {
    headerRow.querySelectorAll('th,td').forEach((cell, i) => {
      const a = cell.querySelector('a[href*="State="]');
      if (a) {
        const m = a.href.match(/State=([A-Z]+)/);
        if (m) colState[i] = m[1];
      }
    });
  }

  // Walk data rows (class="rows")
  for (const row of table.querySelectorAll('tr.rows')) {
    const cells = Array.from(row.querySelectorAll('td'));
    if (!cells.length) continue;

    // First cell is the date
    const dateText = cells[0]?.querySelector('span')?.textContent?.trim() || cells[0]?.textContent?.trim() || '';
    if (!dateText) continue;

    // Each subsequent cell = one state column
    cells.slice(1).forEach((cell, idx) => {
      const colIdx = idx + 1;
      const state = colState[colIdx];
      if (!state) return;

      cell.querySelectorAll('a').forEach(a => {
        const venue = a.textContent.trim();
        if (!venue) return;
        // Use the href directly — already has the correct Form.aspx or Acceptances.aspx URL
        const href = a.getAttribute('href');
        const hasLink = href && (href.includes('Form.aspx') || href.includes('Acceptances.aspx'));
        const url = hasLink ? 'https://racingaustralia.horse' + href : null;
        const postponed = !hasLink;
        meetings.push({ date: dateText, state, venue, url, postponed });
      });
    });
  }

  return meetings;
}

function parseRAHomeMeetingsMarkdown(text) {
  // Jina returns markdown where links look like [VenueName](https://...Form.aspx?Key=...)
  // and state headers look like [NSW](/FreeFields/Calendar.aspx?State=NSW)
  const meetings = [];
  const lines = text.split(/\r?\n/);

  // Helper: extract text and URL from a markdown cell that may contain [text](url)
  const mdLinks = (cell) => {
    const results = [];
    const re = /\[([^\]]+)\]\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(cell)) !== null) results.push({ text: m[1].trim(), url: m[2].trim() });
    if (!results.length) {
      // plain text, no link
      const t = cell.trim();
      if (t) results.push({ text: t, url: null });
    }
    return results;
  };

  // Extract plain text from a cell (strip markdown links)
  const cellText = (cell) => cell.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

  const hasPipeTable = lines.some(l => l.trim().startsWith('|'));
  if (!hasPipeTable) return meetings;

  const dateRe = /([A-Z]+DAY)\s+(\d{1,2})\s+([A-Z]{3})/i;

  let colState = {};   // col index → state abbreviation
  let currentDate = null;

  for (const line of lines) {
    const isPipeRow = line.trim().startsWith('|');

    // A non-pipe line that contains a date is a standalone date header
    if (!isPipeRow) {
      const dm = line.match(dateRe);
      if (dm) currentDate = line.replace(/[|*_#]/g, '').trim();
      continue;
    }

    // Split pipe row into cells (drop leading/trailing empties from the split)
    const rawCells = line.split('|').slice(1, -1);
    if (!rawCells.length) continue;
    if (rawCells.every(c => /^[-:\s]+$/.test(c))) continue; // separator row

    const texts = rawCells.map(c => cellText(c));

    // Header row: cells whose plain text matches state codes
    if (RA_STATES.some(s => texts.includes(s))) {
      colState = {};
      texts.forEach((t, i) => { if (RA_STATES.includes(t)) colState[i] = t; });
      continue;
    }

    // Data row — the date lives in the FIRST cell of the same row as the venues
    const firstCellDate = texts[0]?.match(dateRe);
    if (firstCellDate) currentDate = texts[0].trim();

    if (!currentDate || !Object.keys(colState).length) continue;

    rawCells.forEach((cell, i) => {
      const state = colState[i];
      if (!state) return; // skips the date column (index not in colState)
      mdLinks(cell).forEach(({ text: venue, url }) => {
        if (!venue || venue === '\\' || venue.length < 2) return;
        // A real meeting links to Form.aspx / Acceptances.aspx; postponed ones link to home.aspx
        let resolvedUrl = null;
        if (url && (url.includes('Form.aspx') || url.includes('Acceptances.aspx'))) {
          resolvedUrl = url.startsWith('http') ? url : 'https://racingaustralia.horse' + url;
        }
        meetings.push({ date: currentDate, state, venue: venue.replace(/\\$/, '').trim(), url: resolvedUrl, postponed: !resolvedUrl });
      });
    });
  }

  return meetings;
}

function buildRADateKey(day, mon) {
  // Returns e.g. "2026Jun26" from day="26" mon="JUN"
  const now = new Date();
  const year = now.getFullYear();
  const monCap = mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase();
  return `${year}${monCap}${String(day).padStart(2, '0')}`;
}

function buildRAFormUrl(dateKey, state, venue) {
  // Key format: 2026Jun26,NSW,Tamworth  (comma-separated, URL-encoded)
  const key = `${dateKey},${state},${venue}`;
  return `https://racingaustralia.horse/FreeFields/Form.aspx?Key=${encodeURIComponent(key)}`;
}


/* ------------------------------------------------------------------
   Public API used by sweep-admin.html
------------------------------------------------------------------- */

export async function listRAMeetings() {
  const html = await fetchHtmlViaProxy('https://racingaustralia.horse/home.aspx', 'ra-browser', false);
  let meetings = parseRAHomeMeetings(html);
  if (!meetings.length) meetings = parseRAHomeMeetingsMarkdown(html);
  return meetings;
}

export async function loadRAMeetingRaces(meeting) {
  const url = meeting.url.split('#')[0];
  const html = await fetchHtmlViaProxy(url, 'ra-meeting-modal', false);
  return parseRAMeetingPage(html, meeting.url);
}

// Fills in silksId, prizemoney and formHistory on each horse (mutates), mirroring
// enrichRAHorsesInBackground in admin-dark-script.js without the DOM bookkeeping.
// onProgress(done, total, message) is called as it goes.
export async function enrichRAHorses(horses, sourceUrl, raceNum, onProgress = () => {}) {
  // Pass 1: one raw fetch of the meeting form page carries every silk on the card.
  if (sourceUrl) {
    onProgress(0, 0, 'Fetching silks for the meeting…');
    try {
      const silkMap = await fetchRAMeetingSilkMap(sourceUrl, raceNum);
      for (const horse of horses) {
        const silksId = lookupSilkId(silkMap, horse);
        if (silksId) horse.silksId = silksId;
      }
    } catch (err) {
      console.warn('[enrichRA] meeting silk map failed:', err.message);
    }
  }

  // Horse links aren't on the Form page, so resolve them from Acceptances.
  if (!horses.some(h => h.horseHref) && sourceUrl) {
    onProgress(0, 0, 'Resolving horse links…');
    try {
      const hrefByName = await fetchRAHorseHrefs(sourceUrl);
      for (const h of horses) {
        const key = normalizeHorseName(h.name);
        if (key && hrefByName.has(key)) h.horseHref = hrefByName.get(key);
      }
    } catch (err) {
      console.warn('[enrichRA] could not resolve horse hrefs:', err.message);
    }
  }

  const enrichable = horses.filter(h => h.horseHref);
  let done = 0;
  const total = enrichable.length;
  onProgress(0, total, total ? `Fetching form… (0 / ${total})` : 'No horse links found');

  const enrichOne = async (horse) => {
    try {
      const horseUrl = /^https?:\/\//i.test(horse.horseHref)
        ? horse.horseHref
        : new URL(`FreeFields/HorseFullForm.aspx?${horse.horseHref}`, 'https://www.racingaustralia.horse').href;
      const needsSilk = !horse.silksId;
      const horseHtml = await fetchHtmlViaProxy(
        horseUrl,
        `ra-enrich:${horse.name}`,
        true,
        needsSilk ? (body) => /JockeySilks\/\d+\.png/i.test(body) : null
      );
      const silkM = horseHtml.match(/JockeySilks\/(\d+)\.png/i);
      if (silkM) horse.silksId = silkM[1];
      const prizeM = horseHtml.match(/total\s+prize\s*money[^$\d]*\$([\d,]+)/i)
                  || horseHtml.match(/\$([\d,]+)\s+total\s+prize\s*money/i);
      if (prizeM) horse.prizemoney = '$' + prizeM[1].replace(/,/g, '');
      horse.formHistory = parseRAHorseFormHistory(horseHtml);
    } catch (err) {
      console.warn(`[enrichRA] ${horse.name}:`, err.message);
    }
    done++;
    onProgress(done, total, `Fetching form… (${done} / ${total})`);
  };

  const queue = [...enrichable];
  await Promise.all(Array.from(
    { length: Math.min(3, queue.length) },
    async () => { while (queue.length) await enrichOne(queue.shift()); }
  ));

  return { silks: horses.filter(h => h.silksId).length, total: horses.length };
}

export { parseRAMeetingPage, parseRAHomeMeetings, parseRAHomeMeetingsMarkdown, escHtml };
