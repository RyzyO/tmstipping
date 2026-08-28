import { describe, it, expect } from 'vitest';
import {
  decodeHtmlEntities,
  horseNameKeys,
  extractRASilkEntries,
  buildSilkIndex,
  lookupSilkId,
  raKeyDateFromISO,
  parseRaceNameParts,
} from '../ra-silks.js';

// Trimmed from a real racingaustralia.horse Form.aspx response (Rosehill, 29 Aug 2026),
// keeping the exact tab/newline padding and quoting RA emits.
const RA_MEETING_HTML = `
  <a name="Race1"></a><div class="race-title-spacer"></div>
  <table class="race-title"><tr><th><span class='raceNum'>Race 1</span> - 11:45AM MIDWAY HANDICAP (1800 METRES)</th></tr></table>
  <table class="horse-form-table"><tr><td colspan="5">
    <div class='Silks'>
      <img src="https://racingaustralia.horse/JockeySilks/74159.png" width="46" height="60">
    </div>
    <div class='horse-info'>
      <span class="horse-number">1</span>
      <span class="horse-name"><a class='GreenLink' href="../InteractiveForm/HorseFullForm.aspx?horsecode=AAA" target="_blank">FEDERAL RESERVE</a></span>
      <span class="horse-gear">(Blks)</span>
  </td></tr></table>
  <table class="horse-form-table"><tr><td colspan="5">
    <div class='Silks'>
      <img src="https://racingaustralia.horse/JockeySilks/92940.png" width="46" height="60">
    </div>
    <div class='horse-info'>
      <span class="horse-number">2</span>
      <span class="horse-name"><a class='GreenLink' href="../InteractiveForm/HorseFullForm.aspx?horsecode=BBB" target="_blank">FABRICE (NZ)</a></span>
  </td></tr></table>

  <a name="Race2"></a>
  <table class="race-title"><tr><th><span class='raceNum'>Race 2</span> - 12:20PM MAIDEN PLATE (1200 METRES)</th></tr></table>
  <table class="horse-form-table"><tr><td colspan="5">
    <div class='Silks'>
      <img src="https://racingaustralia.horse/JockeySilks/55501.png" width="46" height="60">
    </div>
    <div class='horse-info'>
      <span class="horse-number">1</span>
      <span class="horse-name"><a class='GreenLink' href="../InteractiveForm/HorseFullForm.aspx?horsecode=CCC" target="_blank">FAY&rsquo;S ANGELS</a></span>
  </td></tr></table>
`;

describe('decodeHtmlEntities', () => {
  it('decodes the named and numeric entities RA emits in horse names', () => {
    expect(decodeHtmlEntities('FAY&rsquo;S ANGELS')).toBe('FAY’S ANGELS');
    expect(decodeHtmlEntities('B&#39;s &amp; C&#x27;s')).toBe("B's & C's");
  });

  it('leaves unknown entities untouched rather than mangling them', () => {
    expect(decodeHtmlEntities('A &notreal; B')).toBe('A &notreal; B');
  });
});

describe('horseNameKeys', () => {
  it('matches a name with or without its country of origin', () => {
    expect(horseNameKeys('FABRICE (NZ)')).toContain('fabrice');
    expect(horseNameKeys('FABRICE')).toContain('fabrice');
  });

  it('collapses punctuation so the two spellings of an apostrophe agree', () => {
    expect(horseNameKeys('FAY’S ANGELS')).toEqual(horseNameKeys("FAY'S ANGELS"));
  });
});

describe('extractRASilkEntries', () => {
  it('pulls silk id, number and name for every runner, tagged with its race', () => {
    const entries = extractRASilkEntries(RA_MEETING_HTML);

    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ silksId: '74159', number: '1', name: 'FEDERAL RESERVE', raceNum: 1 });
    expect(entries[1]).toEqual({ silksId: '92940', number: '2', name: 'FABRICE (NZ)', raceNum: 1 });
    expect(entries[2]).toEqual({ silksId: '55501', number: '1', name: 'FAY’S ANGELS', raceNum: 2 });
  });

  it('is re-runnable — the module-level regexes do not carry lastIndex between calls', () => {
    expect(extractRASilkEntries(RA_MEETING_HTML)).toHaveLength(3);
    expect(extractRASilkEntries(RA_MEETING_HTML)).toHaveLength(3);
  });

  it('returns nothing for a page with no silks (e.g. Jina markdown or Acceptances.aspx)', () => {
    expect(extractRASilkEntries('| 1 | [FEDERAL RESERVE](https://x/HorseFullForm.aspx) |')).toEqual([]);
  });
});

describe('buildSilkIndex / lookupSilkId', () => {
  const entries = extractRASilkEntries(RA_MEETING_HTML);

  it('narrows to a single race so duplicate saddlecloth numbers do not collide', () => {
    const race1 = buildSilkIndex(entries, 1);
    const race2 = buildSilkIndex(entries, 2);

    // Number 1 exists in both races and must resolve to a different silk in each.
    expect(lookupSilkId(race1, { number: '1', name: '' })).toBe('74159');
    expect(lookupSilkId(race2, { number: '1', name: '' })).toBe('55501');
  });

  it('matches by name even when the country suffix differs between pages', () => {
    const index = buildSilkIndex(entries, 1);
    // The acceptances parser strips "(NZ)" before we ever get here.
    expect(lookupSilkId(index, { number: '99', name: 'FABRICE' })).toBe('92940');
  });

  it('matches names whose apostrophe arrived as an HTML entity', () => {
    const index = buildSilkIndex(entries, 2);
    expect(lookupSilkId(index, { number: '99', name: "FAY'S ANGELS" })).toBe('55501');
  });

  it('prefers the name over the number, since scratchings renumber the field', () => {
    const index = buildSilkIndex(entries, 1);
    // Number says 1 (FEDERAL RESERVE) but the name says FABRICE — trust the name.
    expect(lookupSilkId(index, { number: '1', name: 'FABRICE (NZ)' })).toBe('92940');
  });

  it('falls back to the whole meeting when the requested race has no entries', () => {
    const index = buildSilkIndex(entries, 7);
    expect(index.count).toBe(3);
  });

  it('returns null for a horse that has no silk rather than guessing', () => {
    const index = buildSilkIndex(entries, 1);
    expect(lookupSilkId(index, { number: '44', name: 'AIRHAWK' })).toBeNull();
    expect(lookupSilkId(null, { number: '1', name: 'FEDERAL RESERVE' })).toBeNull();
  });
});

// ── Retrospective backfill: rebuilding an RA meeting key from a saved race ──────

describe('raKeyDateFromISO', () => {
  it('converts a stored ISO date to the RA key format', () => {
    expect(raKeyDateFromISO('2026-08-29')).toBe('2026Aug29');
    expect(raKeyDateFromISO('2026-01-05')).toBe('2026Jan05');
    expect(raKeyDateFromISO('2026-12-31')).toBe('2026Dec31');
  });

  it('keeps the zero-padded day, which RA keys use', () => {
    expect(raKeyDateFromISO('2026-08-01')).toBe('2026Aug01');
  });

  it('tolerates a full timestamp', () => {
    expect(raKeyDateFromISO('2026-08-29T00:00:00Z')).toBe('2026Aug29');
  });

  it('returns empty for anything it cannot parse', () => {
    expect(raKeyDateFromISO('29/08/2026')).toBe('');
    expect(raKeyDateFromISO('')).toBe('');
    expect(raKeyDateFromISO(null)).toBe('');
    expect(raKeyDateFromISO('2026-13-01')).toBe('');
  });
});

describe('parseRaceNameParts', () => {
  it('pulls the race number and venue out of an imported race name', () => {
    expect(parseRaceNameParts('Race 3 - Rosehill Gardens - MIDWAY HANDICAP'))
      .toEqual({ raceNum: 3, venue: 'Rosehill Gardens' });
  });

  it('handles venues that contain their own words and sponsors', () => {
    expect(parseRaceNameParts('Race 2 - Ladbrokes Pioneer Park - MAIDEN PLATE'))
      .toEqual({ raceNum: 2, venue: 'Ladbrokes Pioneer Park' });
  });

  it('still finds the race number when the name carries no venue', () => {
    expect(parseRaceNameParts('Race 6 - MIDWAY HANDICAP'))
      .toEqual({ raceNum: 6, venue: null });
  });

  it('returns nulls for a name it cannot read, so the caller skips rather than guesses', () => {
    expect(parseRaceNameParts('The Big One')).toEqual({ raceNum: null, venue: null });
    expect(parseRaceNameParts('')).toEqual({ raceNum: null, venue: null });
  });
});
