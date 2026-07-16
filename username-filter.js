import { SLURS, PROFANITY } from './blocked-words.js';

// Whole-word matching, not substring matching. This is deliberate: substring
// matching would flag "Assassin" (contains "ass") and "Cummings" (contains
// "cum") as blocked, which are legitimate names/words. Instead we split the
// input into words and only block when an ENTIRE word (after normalizing
// leetspeak/repeats) equals a blocklist entry.
//
// This also catches deliberate evasion within a single word — "fuk", "fvck",
// "sh1t", "fuuuck" — because normalization happens before the exact-match
// check. It also catches letter-by-letter spacing ("f u c k") by joining runs
// of single-character words back together before checking.
//
// Trade-off (accepted deliberately, see feedback above): a blocked word
// glued onto other letters with no separator at all, e.g. "xXfuckboyXx" or
// "fuckboy123", will NOT be caught, because "fuckboy" is a different whole
// word than "fuck". If that turns out to be a real problem in practice, the
// fix is a curated substring list of only the highest-confidence long words,
// not a blanket substring scan — ask before broadening this.

const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', 'v': 'u' };
// Characters treated as letter substitutes rather than word separators —
// tokenizing must NOT split on these, or "sh!t" splits into "sh" + "t"
// before deleet() ever gets a chance to turn "!" into "i".
const LEET_CHARS = Object.keys(LEET_MAP).filter((c) => !/[a-z]/.test(c)); // '0','1','3','4','5','7','@','$','!'

function stripAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function deleet(str) {
  return str.replace(/[013457@$!v]/g, (c) => LEET_MAP[c] ?? c);
}

function collapseRepeats(str) {
  // "fuuuuck" -> "fuck", but don't collapse legitimate double letters away
  // entirely — just cap runs at 2 so "cool" and "class" survive untouched
  // while "fuuuuck" and "shiiiit" still normalize down to the blocklist form.
  return str.replace(/(.)\1{2,}/g, '$1$1');
}

function normalizeWord(word) {
  let w = stripAccents(word.toLowerCase());
  w = deleet(w);
  w = collapseRepeats(w);
  // A single collapseRepeats pass leaves doubled letters (see above), but the
  // blocklist words are single-letter forms ("fuck" not "fuuck"), so also
  // produce a fully-collapsed variant for comparison.
  const fullyCollapsed = w.replace(/(.)\1+/g, '$1');
  return { normal: w, collapsed: fullyCollapsed };
}

function buildLookup(words) {
  const set = new Set();
  for (const entry of words) {
    for (const w of entry.split(/\s+/)) {
      set.add(w.toLowerCase());
    }
    // Multi-word entries (e.g. "porch monkey") also get a joined form so
    // "porchmonkey" (no space) is caught as a single glued-together word.
    if (entry.includes(' ')) {
      set.add(entry.replace(/\s+/g, '').toLowerCase());
    }
  }
  return set;
}

const SLUR_SET = buildLookup(SLURS);
const PROFANITY_SET = buildLookup(PROFANITY);

function wordMatches(word, blockedSet) {
  if (!word) return false;
  const { normal, collapsed } = normalizeWord(word);
  return blockedSet.has(normal) || blockedSet.has(collapsed);
}

// Splits on anything that isn't a letter/number, then re-joins consecutive
// single-character tokens (e.g. ["f","u","c","k"] from "f u c k") so
// letter-by-letter spacing evasion still normalizes to one word.
function tokenize(input) {
  // Split on anything that's neither alphanumeric nor a leet-substitution
  // symbol (0 1 3 4 5 7 @ $ !), so "sh!t" and "fu$$y" stay one token instead
  // of being split apart before deleet() can decode them.
  const splitPattern = new RegExp(`[^a-zA-Z0-9${LEET_CHARS.map((c) => `\\${c}`).join('')}]+`);
  const raw = input.split(splitPattern).filter(Boolean);
  const tokens = [];
  let buffer = '';
  for (const piece of raw) {
    if (piece.length === 1) {
      buffer += piece;
    } else {
      if (buffer) { tokens.push(buffer); buffer = ''; }
      tokens.push(piece);
    }
  }
  if (buffer) tokens.push(buffer);
  return tokens;
}

// Returns { blocked: boolean, category: 'slur' | 'profanity' | null, word: string | null }
export function checkDisplayName(input) {
  if (!input || typeof input !== 'string') return { blocked: false, category: null, word: null };

  const tokens = tokenize(input);
  for (const token of tokens) {
    if (wordMatches(token, SLUR_SET)) return { blocked: true, category: 'slur', word: token };
  }
  for (const token of tokens) {
    if (wordMatches(token, PROFANITY_SET)) return { blocked: true, category: 'profanity', word: token };
  }
  return { blocked: false, category: null, word: null };
}
